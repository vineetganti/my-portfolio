"""Page poller: find new articles on a site that has neither a feed nor a usable sitemap.

Same contract as the sitemap watcher (sitemap.py), so the daily run treats both the same way: one conditional GET of the
listing page (an unchanged page is a 304 and costs nothing), then only the same-site links that look like articles. It never
follows a link: a page is fetched later, once, only if the daily run decides to process it.

A listing page carries no dates, so entries have `date=None`: they can be NEW (never seen) but never "updated". Which links
are articles is the source's call: `include` path prefixes plus `depth`, the exact number of path segments an article URL
has (category and pagination pages sit at other depths). Links are read from the HTML as served; a listing that only exists
after JavaScript runs yields nothing, which shows up as an empty source rather than an error.
"""
from datetime import datetime, timezone
from urllib.parse import urljoin, urlsplit

import httpx
from bs4 import BeautifulSoup

from newsletter_brief.db.store import Store
from newsletter_brief.sources.registry import Source
from newsletter_brief.sources.rss import USER_AGENT, FeedEntry

BROWSER_UA = f"Mozilla/5.0 (compatible; {USER_AGENT})"  # some sites answer 403 to a bare library user agent


def extract_article_links(html: str, base_url: str, include: tuple[str, ...], depth: int = 0) -> list[str]:
    """Same-host links under an include prefix, query and fragment dropped, the listing itself excluded, in page order."""
    base = urlsplit(base_url)
    out: list[str] = []
    seen: set[str] = set()
    for a in BeautifulSoup(html, "html.parser").find_all("a", href=True):
        parts = urlsplit(urljoin(base_url, a["href"]))
        if parts.scheme not in ("http", "https") or parts.netloc != base.netloc:
            continue
        path = parts.path
        segments = [s for s in path.split("/") if s]
        if path.rstrip("/") == base.path.rstrip("/") or not any(path.startswith(p) for p in include):
            continue
        if depth and len(segments) != depth:
            continue
        link = f"{parts.scheme}://{parts.netloc}{path.rstrip('/')}"  # /a and /a/ are one page
        if link not in seen:
            seen.add(link)
            out.append(link)
    return out


def fetch_page_entries(src: Source, store: Store, now: datetime | None = None, client: httpx.Client | None = None) -> list[FeedEntry]:
    """Entries (no title, no date, no body) for the article links on the source's listing page.
    An empty list when the page has not changed since the last run."""
    if not src.include:  # an unfiltered page is every link on the site: refuse rather than pull it
        raise ValueError(f"{src.id}: a page source needs include prefixes")
    own = client is None
    client = client or httpx.Client(headers={"User-Agent": BROWSER_UA}, timeout=30, follow_redirects=True)
    try:
        etag, modified = store.http_validators(src.url)
        headers = {**({"If-None-Match": etag} if etag else {}), **({"If-Modified-Since": modified} if modified else {})}
        resp = client.get(src.url, headers=headers)
        if resp.status_code == 304:
            return []
        resp.raise_for_status()
        store.set_http_validators(src.url, resp.headers.get("etag"), resp.headers.get("last-modified"))
        return [FeedEntry(title="", link=link, date=None, body_html="")
                for link in extract_article_links(resp.text, str(resp.url), src.include, src.depth)]
    finally:
        if own:
            client.close()
