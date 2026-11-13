"""Fetch the full text of an article page, for feeds that only carry a summary.

Rules (user's): paywalled articles are skipped, not summarised from a teaser. Also never evade blocks:
a 403/429, a robots.txt disallow or a captcha means "skip", not "try harder".
"""
import re
from dataclasses import dataclass
from urllib.parse import urlsplit
from urllib.robotparser import RobotFileParser

import httpx
import trafilatura

from newsletter_brief.schemas import Document

USER_AGENT = "newsletter-brief/0.1 (personal feed reader)"
MIN_CHARS = 800  # shorter extractions are treated as a failed or partial extraction
# schema.org marker publishers put in JSON-LD for gated pages
NOT_FREE = re.compile(r'"isAccessibleForFree"\s*:\s*(?:false|"false")', re.I)
PAYWALL_PHRASES = ("subscribe to continue", "subscribers only", "sign in to read", "for subscribers",
                   "become a member to read", "member-only story", "subscribe to read")


@dataclass
class Fetched:
    text: str | None
    reason: str  # ok | paywalled | blocked | robots | too_short | error
    title: str = ""  # from the page itself; sitemap entries arrive without one


def _robots_ok(client: httpx.Client, url: str, cache: dict) -> bool:
    host = urlsplit(url).netloc
    if host not in cache:
        rp = RobotFileParser()
        try:
            r = client.get(f"{urlsplit(url).scheme}://{host}/robots.txt")
            rp.parse(r.text.splitlines() if r.status_code == 200 else [])  # no robots.txt means allowed
        except httpx.HTTPError:
            rp.parse([])
        cache[host] = rp
    return cache[host].can_fetch(USER_AGENT, url)


def fetch_article(url: str, client: httpx.Client | None = None, robots_cache: dict | None = None) -> Fetched:
    own = client is None
    client = client or httpx.Client(headers={"User-Agent": USER_AGENT}, timeout=25, follow_redirects=True)
    try:
        if not _robots_ok(client, url, robots_cache if robots_cache is not None else {}):
            return Fetched(None, "robots")
        resp = client.get(url)
        if resp.status_code in (401, 402):
            return Fetched(None, "paywalled")
        if resp.status_code in (403, 429):
            return Fetched(None, "blocked")
        resp.raise_for_status()
        if NOT_FREE.search(resp.text):
            return Fetched(None, "paywalled")
        text = trafilatura.extract(resp.text, include_comments=False, include_tables=True, favor_precision=True) or ""
        if len(text) < MIN_CHARS:
            gated = any(p in resp.text.lower() for p in PAYWALL_PHRASES)
            return Fetched(None, "paywalled" if gated else "too_short")
        meta = trafilatura.extract_metadata(resp.text)
        return Fetched(text, "ok", (meta.title or "").strip() if meta else "")
    except httpx.HTTPError:
        return Fetched(None, "error")
    finally:
        if own:
            client.close()


def ensure_full_text(doc: Document, client: httpx.Client | None = None) -> tuple[Document | None, str]:
    """Replace a summary-only document's body with the full article. None when it must be skipped."""
    if doc.full_text:
        return doc, "ok"
    got = fetch_article(doc.url, client)
    if got.text is None:
        return None, got.reason
    return doc.model_copy(update={"body_text": got.text, "full_text": True, "title": doc.title or got.title}), "ok"
