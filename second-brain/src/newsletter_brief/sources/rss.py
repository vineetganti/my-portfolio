"""RSS / Atom source adapter: feed XML -> FeedEntry -> Document.

Public company blogs only; one polite GET per feed. Paywalled items are skipped (user's rule).
"""
import hashlib
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime

import httpx

from newsletter_brief.parse.canonicalize import canonicalize
from newsletter_brief.parse.html_to_text import Resolver, html_to_text
from newsletter_brief.parse.links import extract_links
from newsletter_brief.parse.redirects import resolve_offline
from newsletter_brief.schemas import Document
from newsletter_brief.sources.registry import Source

USER_AGENT = "newsletter-brief/0.1 (personal feed reader)"
ATOM = "{http://www.w3.org/2005/Atom}"
CONTENT = "{http://purl.org/rss/1.0/modules/content/}encoded"
DC_DATE = "{http://purl.org/dc/elements/1.1/}date"
RSS1 = "{http://purl.org/rss/1.0/}"
FULL_TEXT_MIN_CHARS = 1500  # shorter bodies are treated as a summary, so the article page must be fetched for polishing


@dataclass
class FeedEntry:
    title: str
    link: str
    date: datetime | None
    body_html: str  # full article if the feed carries it, else the summary


def parse_date(text: str | None) -> datetime | None:
    if not text or not text.strip():
        return None
    text = text.strip()
    try:
        d = parsedate_to_datetime(text)
    except (TypeError, ValueError):
        try:
            d = datetime.fromisoformat(text.replace("Z", "+00:00"))
        except ValueError:
            return None
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


def parse_feed(xml_bytes: bytes) -> tuple[str, list[FeedEntry]]:
    root = ET.fromstring(xml_bytes)
    entries: list[FeedEntry] = []
    if root.tag.endswith("rss") or root.tag.endswith("RDF"):
        kind = "rss"
        # RSS 1.0 (RDF, e.g. Nature) puts its items in the rss/1.0 namespace, outside the channel
        for it in [*root.iter("item"), *root.iter(f"{RSS1}item")]:
            def text(name: str) -> str:
                return it.findtext(name) or it.findtext(RSS1 + name) or ""

            entries.append(FeedEntry(
                title=text("title").strip(), link=text("link").strip(),
                # Frontiers writes <pubdate> in lower case
                date=parse_date(text("pubDate") or text("pubdate") or it.findtext(DC_DATE)),
                body_html=it.findtext(CONTENT) or text("description"),
            ))
    elif root.tag == f"{ATOM}feed":
        kind = "atom"
        for en in root.findall(f"{ATOM}entry"):
            link = next((l.get("href") for l in en.findall(f"{ATOM}link") if l.get("rel") in (None, "alternate")), "")
            entries.append(FeedEntry(
                title=(en.findtext(f"{ATOM}title") or "").strip(), link=link or "",
                date=parse_date(en.findtext(f"{ATOM}published") or en.findtext(f"{ATOM}updated")),
                body_html=en.findtext(f"{ATOM}content") or en.findtext(f"{ATOM}summary") or "",
            ))
    else:
        raise ValueError(f"not RSS/Atom (root <{root.tag[:40]}>)")
    return kind, entries


def fetch_entries(feed_url: str, client: httpx.Client | None = None) -> list[FeedEntry]:
    own = client is None
    client = client or httpx.Client(headers={"User-Agent": USER_AGENT}, timeout=20, follow_redirects=True)
    try:
        resp = client.get(feed_url)
        resp.raise_for_status()
        return parse_feed(resp.content)[1]
    finally:
        if own:
            client.close()


def looks_paywalled(entry: FeedEntry) -> bool:
    """Heuristic, UNVERIFIED against a real member-only item: Medium-style feeds cut paywalled stories short and
    end them with a 'Continue reading on ...' link. Conservative: needs both a short body and that phrase."""
    return len(entry.body_html) < FULL_TEXT_MIN_CHARS and "continue reading on" in entry.body_html.lower()


def entry_to_document(source: Source, entry: FeedEntry, resolve: Resolver = resolve_offline) -> Document | None:
    """None when the item should be skipped (paywalled, or no link). An empty feed body is NOT a reason to skip:
    some feeds (Hugging Face, Vercel) send no text at all, so the document is returned with full_text=False and the
    article page is fetched later."""
    if not entry.link or looks_paywalled(entry):
        return None
    url = canonicalize(entry.link)
    text = html_to_text(entry.body_html, resolve)
    return Document(
        id=f"{source.id}:{hashlib.sha1(url.encode()).hexdigest()[:12]}",
        source_id=source.id, source_type="rss", title=entry.title, url=url, published=entry.date,
        body_text=text, links=extract_links(entry.body_html, resolve), full_text=len(text) >= FULL_TEXT_MIN_CHARS,
    )
