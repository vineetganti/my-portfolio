"""SEC EDGAR adapter: new filings (Atom feed), company SIC lookup, energy/tech filter, main-document fetch.

Fair-access rules (SEC): declare a contact in the User-Agent, stay under 10 requests/second, download only what is
needed. The contact comes from SEC_CONTACT in .env (the user approved using their own address); without it nothing
is sent.
"""
import hashlib
import json
import re
import time
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import datetime, timezone
from urllib.parse import urljoin

import httpx
from bs4 import BeautifulSoup

from newsletter_brief.config import ROOT, settings
from newsletter_brief.parse.html_to_text import html_to_text
from newsletter_brief.schemas import Document

ATOM_URL = "https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type={form}&company=&dateb=&owner=include&start=0&count={count}&output=atom"
SUBMISSIONS_URL = "https://data.sec.gov/submissions/CIK{cik:010d}.json"
ATOM = "{http://www.w3.org/2005/Atom}"
PAUSE_S = 0.2  # about 5 requests per second, half the SEC's limit
MAX_DOC_BYTES = 3 * 1024 * 1024
CACHE = ROOT / "data" / "cache" / "edgar_companies.json"

# Verified against the SEC's own SIC code list on 2026-11-02.
ENERGY_SIC = {"1311", "1381", "1382", "1389", "2911", "3533", "4911", "4922", "4923", "4924", "4931"}
TECH_SIC = {"3570", "3571", "3572", "3576", "3577", "3674", "7370", "7371", "7372", "7373", "7374"}


@dataclass
class Filing:
    form: str
    company: str
    cik: int
    accession: str
    index_url: str
    updated: datetime | None


def user_agent() -> str:
    if not settings.sec_contact:
        raise RuntimeError("SEC_CONTACT is not set in .env; EDGAR requests must declare a contact.")
    return f"newsletter-brief (personal research) {settings.sec_contact}"


def new_client() -> httpx.Client:
    return httpx.Client(headers={"User-Agent": user_agent()}, timeout=30, follow_redirects=True)


def classify(sic: str | None) -> str | None:
    if sic in ENERGY_SIC:
        return "energy"
    if sic in TECH_SIC:
        return "tech"
    return None


TITLE = re.compile(r"^(?P<form>[\w\-/]+) - (?P<company>.+?) \((?P<cik>\d{10})\) \(.*\)$")
ACCESSION = re.compile(r"/(\d{10}-\d{2}-\d{6})-index")


def parse_current_filings(xml_bytes: bytes) -> list[Filing]:
    out: dict[str, Filing] = {}
    for en in ET.fromstring(xml_bytes).findall(f"{ATOM}entry"):
        m = TITLE.match((en.findtext(f"{ATOM}title") or "").strip())
        link = next((l.get("href") for l in en.findall(f"{ATOM}link")), "")
        acc = ACCESSION.search(link or "")
        if not (m and acc):
            continue
        try:
            updated = datetime.fromisoformat((en.findtext(f"{ATOM}updated") or "").replace("Z", "+00:00"))
        except ValueError:
            updated = None
        out.setdefault(acc.group(1), Filing(m["form"], m["company"], int(m["cik"]), acc.group(1), link, updated))
    return list(out.values())  # the feed repeats a filing once per party; keep one per accession number


def new_filings(client: httpx.Client, form: str = "S-1", count: int = 40) -> list[Filing]:
    resp = client.get(ATOM_URL.format(form=form, count=count))
    resp.raise_for_status()
    return parse_current_filings(resp.content)


def lookup_company(client: httpx.Client, cik: int, cache: dict | None = None) -> dict:
    """{'name', 'sic', 'sic_description'} from the submissions API, cached on disk (SIC rarely changes)."""
    cache = cache if cache is not None else load_cache()
    key = str(cik)
    if key not in cache:
        time.sleep(PAUSE_S)
        r = client.get(SUBMISSIONS_URL.format(cik=cik))
        if r.status_code != 200:
            return {"name": "", "sic": None, "sic_description": ""}
        j = r.json()
        cache[key] = {"name": j.get("name", ""), "sic": j.get("sic") or None, "sic_description": j.get("sicDescription", "")}
        save_cache(cache)
    return cache[key]


def load_cache() -> dict:
    return json.loads(CACHE.read_text(encoding="utf-8")) if CACHE.exists() else {}


def save_cache(cache: dict) -> None:
    CACHE.parent.mkdir(parents=True, exist_ok=True)
    CACHE.write_text(json.dumps(cache, indent=1), encoding="utf-8")


def primary_document_url(index_html: str, form: str, base: str) -> str | None:
    """The main filing document listed in the filing index (inline-XBRL viewer links are unwrapped)."""
    for tr in BeautifulSoup(index_html, "html.parser").find_all("tr"):
        cells = tr.find_all("td")
        if len(cells) >= 4 and cells[3].get_text(strip=True).upper() == form.upper():
            a = cells[2].find("a", href=True)
            if a:
                href = a["href"]
                if href.startswith("/ix?doc="):
                    href = href.split("doc=", 1)[1]
                return urljoin(base, href)
    return None


def filing_to_document(client: httpx.Client, filing: Filing, company: dict) -> tuple[Document | None, str]:
    time.sleep(PAUSE_S)
    idx = client.get(filing.index_url)
    idx.raise_for_status()
    doc_url = primary_document_url(idx.text, filing.form, filing.index_url)
    if not doc_url:
        return None, "no_primary_document"
    time.sleep(PAUSE_S)
    with client.stream("GET", doc_url) as resp:
        resp.raise_for_status()
        data = b""
        for chunk in resp.iter_bytes():
            data += chunk
            if len(data) >= MAX_DOC_BYTES:  # the business summary is near the front; do not download a 20 MB filing
                break
    text = html_to_text(data.decode("utf-8", errors="replace"))
    if len(text) < 500:
        return None, "no_text"
    label = company.get("sic_description") or "unknown industry"
    return Document(
        id=f"edgar:{hashlib.sha1(filing.accession.encode()).hexdigest()[:12]}", source_id="edgar", source_type="page",
        title=f"{filing.form}: {filing.company} ({label})", url=doc_url,
        published=filing.updated or datetime.now(timezone.utc), body_text=text, full_text=True,
    ), f"ok ({len(data)//1024} KB read)"
