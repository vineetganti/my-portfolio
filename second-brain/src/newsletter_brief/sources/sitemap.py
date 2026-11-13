"""Sitemap watcher: find new AND updated pages on a site without a feed, cheaply.

One request per site (conditional GET, so an unchanged sitemap is a 304 and costs nothing), then only the URLs whose path
matches the source's include prefixes. It never follows links: the sitemap names the pages, and a page is fetched once,
only if the daily run decides to process it (per-source caps apply). A sitemap index is refused instead of descended, so
the cost of one source is bounded: configure the child sitemap URL you want.

`lastmod` is not trusted as "the content changed" (sites re-save templates and bulk-touch pages); the daily run compares a
hash of the extracted text before spending a model call.
"""
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from urllib.parse import urlsplit

import httpx

from newsletter_brief.db.store import Store
from newsletter_brief.sources.registry import Source
from newsletter_brief.sources.rss import USER_AGENT, FeedEntry, parse_date


def parse_sitemap(xml_bytes: bytes) -> list[tuple[str, datetime | None]]:
    root = ET.fromstring(xml_bytes)
    if root.tag.endswith("sitemapindex"):
        raise ValueError("sitemap index: point the source at one child sitemap instead (no extra hops)")
    ns = root.tag[: root.tag.index("}") + 1] if "}" in root.tag else ""
    out = []
    for u in root.findall(f"{ns}url"):
        loc = (u.findtext(f"{ns}loc") or "").strip()
        if loc:
            out.append((loc, parse_date(u.findtext(f"{ns}lastmod"))))
    return out


def include_prefixes(include: tuple[str, ...], now: datetime) -> tuple[str, ...]:
    """Path prefixes; `{year}` stands for this year and last year, so a site that files news under /news/2026/ keeps working."""
    out: list[str] = []
    for p in include:
        out += [p.format(year=y) for y in (now.year, now.year - 1)] if "{year}" in p else [p]
    return tuple(out)


def fetch_sitemap_entries(src: Source, store: Store, now: datetime | None = None, client: httpx.Client | None = None) -> list[FeedEntry]:
    """Entries (no title, no body: the page is fetched later) for the URLs that match the source's include prefixes.
    An empty list when the sitemap has not changed since the last run."""
    now = now or datetime.now(timezone.utc)
    if not src.include:  # an unfiltered sitemap is a whole website: refuse rather than pull it
        raise ValueError(f"{src.id}: a sitemap source needs include prefixes")
    own = client is None
    client = client or httpx.Client(headers={"User-Agent": USER_AGENT}, timeout=30, follow_redirects=True)
    try:
        etag, modified = store.http_validators(src.url)
        headers = {**({"If-None-Match": etag} if etag else {}), **({"If-Modified-Since": modified} if modified else {})}
        resp = client.get(src.url, headers=headers)
        if resp.status_code == 304:
            return []
        resp.raise_for_status()
        store.set_http_validators(src.url, resp.headers.get("etag"), resp.headers.get("last-modified"))
        prefixes = include_prefixes(src.include, now)
        return [FeedEntry(title="", link=loc, date=lastmod, body_html="")
                for loc, lastmod in parse_sitemap(resp.content)
                if any(urlsplit(loc).path.startswith(p) for p in prefixes)]
    finally:
        if own:
            client.close()
