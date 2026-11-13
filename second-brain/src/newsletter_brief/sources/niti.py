"""NITI Aayog division reports: poll the listing page, download new PDFs, extract their text.

The listing links PDFs in monthly folders (/sites/default/files/2026-10/...); the report title is in the link's
`title` attribute and the date is month-level only.
"""
import hashlib
import io
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from urllib.parse import urljoin

import httpx
from bs4 import BeautifulSoup
from pypdf import PdfReader

from newsletter_brief.schemas import Document

LISTING_URL = "https://www.niti.gov.in/publications/division-reports"
USER_AGENT = "newsletter-brief/0.1 (personal research tool)"
MAX_PDF_BYTES = 30 * 1024 * 1024
MAX_PAGES = 80
MIN_TEXT_CHARS = 500  # less than this usually means a scanned PDF with no text layer
MONTH_FOLDER = re.compile(r"/(20\d\d)-(\d\d)/")


@dataclass
class Report:
    title: str
    url: str
    published: datetime | None  # first day of the month in the folder name; the real day is not given


def parse_listing(html: str, base: str = LISTING_URL) -> list[Report]:
    seen: dict[str, Report] = {}
    for a in BeautifulSoup(html, "html.parser").find_all("a", href=True):
        href = a["href"].strip()  # the live listing has hrefs ending in a space, which became %20 and a 404
        if ".pdf" not in href.lower():
            continue
        url = urljoin(base, href)
        title = (a.get("title") or a.get_text(" ", strip=True) or url.rsplit("/", 1)[-1]).strip()
        m = MONTH_FOLDER.search(url)
        published = datetime(int(m.group(1)), int(m.group(2)), 1, tzinfo=timezone.utc) if m else None
        seen.setdefault(url, Report(title=title, url=url, published=published))
    return list(seen.values())


def fetch_reports(client: httpx.Client | None = None) -> list[Report]:
    own = client is None
    client = client or httpx.Client(headers={"User-Agent": USER_AGENT}, timeout=30, follow_redirects=True)
    try:
        resp = client.get(LISTING_URL)
        resp.raise_for_status()
        return parse_listing(resp.text)
    finally:
        if own:
            client.close()


def pdf_to_text(data: bytes, max_pages: int = MAX_PAGES) -> tuple[str, int, bool]:
    """Returns (text, pages_read, truncated_by_page_cap)."""
    reader = PdfReader(io.BytesIO(data))
    pages = reader.pages[:max_pages]
    parts = [(p.extract_text() or "") for p in pages]
    text = "\n\n".join(parts)
    text = re.sub(r"-\n(?=[a-z])", "", text)  # re-join words hyphenated at line ends
    text = re.sub(r"[ \t]+", " ", text)
    return re.sub(r"\n{3,}", "\n\n", text).strip(), len(pages), len(reader.pages) > max_pages


def report_to_document(report: Report, client: httpx.Client | None = None) -> tuple[Document | None, str]:
    """(document, reason). Skips oversized or text-less (scanned) PDFs."""
    own = client is None
    client = client or httpx.Client(headers={"User-Agent": USER_AGENT}, timeout=60, follow_redirects=True)
    try:
        with client.stream("GET", report.url) as resp:
            resp.raise_for_status()
            if int(resp.headers.get("content-length", 0)) > MAX_PDF_BYTES:
                return None, "too_large"
            data = b"".join(resp.iter_bytes())
        if len(data) > MAX_PDF_BYTES:
            return None, "too_large"
        text, pages, truncated = pdf_to_text(data)
        if len(text) < MIN_TEXT_CHARS:
            return None, "no_text_layer"
        body = text + ("\n[TEXT TRUNCATED: page cap reached]" if truncated else "")
        return Document(
            id=f"niti:{hashlib.sha1(report.url.encode()).hexdigest()[:12]}", source_id="niti", source_type="page",
            title=report.title, url=report.url, published=report.published, body_text=body, full_text=True,
        ), f"ok ({pages} pages)"
    except httpx.HTTPError:
        return None, "error"
    except Exception as ex:  # a corrupt PDF should skip the report, not stop the run
        return None, f"pdf_error: {type(ex).__name__}"
    finally:
        if own:
            client.close()
