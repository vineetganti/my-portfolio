"""Turn email tracking links into their real destination, safely.

Two steps, cheapest first:
1. unwrap_offline: some wrappers carry the real URL inside the link (TLDR, Amazon SES click tracking).
   No network needed. This covers most links in practice.
2. Resolver: for opaque wrappers (SendGrid, Substack, Seeking Alpha, ...) follow the redirect chain.

Safety rules for step 2, because opening a link in a newsletter can have side effects
(an unsubscribe link may unsubscribe you; a click is reported to the sender):
- never request a link whose text says unsubscribe, preferences, view-in-browser, or is a social icon
- only ever request hosts that are known click trackers; once a Location header points at any other
  host, that URL is the answer and the destination site is never contacted
- redirects are followed by hand, and the chain stops before any hop that looks like unsubscribe/opt-out
- no cookies, a plain identifying User-Agent, a pause between requests, results cached in SQLite
"""
import re
import sqlite3
import time
from pathlib import Path
from urllib.parse import unquote, urljoin, urlsplit

import httpx

from newsletter_brief.config import settings
from newsletter_brief.parse.canonicalize import NON_CONTENT_URL_PARTS, canonicalize, is_content_link

# Real URL embedded, percent-encoded, in the path: /CL0/<target>/1/<id>/<sig> (TLDR) or /L0/... (SES)
EMBEDDED = re.compile(r"^/(?:CL0|L0)/(?P<target>https?(?::|%3A)%2F%2F[^/]+)/\d+/", re.I)

# (host regex, path prefix) of opaque click trackers worth following. Anything else is never requested.
TRACKER_RULES: list[tuple[re.Pattern, str]] = [
    (re.compile(r"(^|\.)ct\.sendgrid\.net$"), "/ls/click"),
    (re.compile(r"(^|\.)substack\.com$"), "/redirect/"),
    (re.compile(r"^email-st\.seekingalpha\.com$"), "/"),
    (re.compile(r"^nltrack\.indiatimes\.com$"), "/tracking/"),
    (re.compile(r"^nl\.nytimes\.com$"), "/f/"),
    (re.compile(r"(^|\.)sparkpost\.com$"), "/f/"),  # second hop behind nl.nytimes.com
    (re.compile(r"(^|\.)list-manage\.com$"), "/track/click"),
    (re.compile(r"^links\.tldrnewsletter\.com$"), "/"),
    (re.compile(r"(^|\.)awstrack\.me$"), "/"),
    (re.compile(r"^tracking\.tldrnewsletter\.com$"), "/"),
]
USER_AGENT = "newsletter-brief/0.1 (personal link resolver)"


def unwrap_offline(url: str) -> str | None:
    """Return the destination embedded in a known wrapper link, or None."""
    parts = urlsplit(url)
    m = EMBEDDED.match(parts.path)
    if not m:
        return None
    target = unquote(m.group("target"))
    # the target's query string follows the encoded host/path in the same segment only when encoded;
    # TLDR encodes the whole thing, so what we have is complete.
    return target if target.startswith(("http://", "https://")) else None


def is_tracker(url: str) -> bool:
    parts = urlsplit(url)
    host = (parts.hostname or "").lower()
    return any(h.search(host) and parts.path.startswith(prefix) for h, prefix in TRACKER_RULES)


def _looks_unsafe(url: str) -> bool:
    low = url.lower()
    return any(p in low for p in NON_CONTENT_URL_PARTS)


def resolve_offline(url: str, text: str = "") -> str | None:
    """Network-free resolver: unwrap embedded wrappers, strip tracking, filter. Opaque trackers are kept as-is."""
    if not is_content_link(url, text):
        return None
    for _ in range(5):
        inner = unwrap_offline(url)
        if inner is None:
            break
        url = inner
    final = canonicalize(url)
    return final if is_content_link(final, text) else None


class Resolver:
    """Callable (url, text) -> final canonical URL, or None to drop the link and keep only its text."""

    def __init__(
        self,
        cache_path: Path | None = None,
        client: httpx.Client | None = None,
        delay_s: float = 0.3,
        max_hops: int = 8,
        timeout_s: float = 10.0,
        sleep=time.sleep,
    ):
        self.client = client or httpx.Client(
            headers={"User-Agent": USER_AGENT}, timeout=timeout_s, follow_redirects=False, cookies=None
        )
        self.delay_s, self.max_hops, self.sleep = delay_s, max_hops, sleep
        self.requests_made = 0
        path = cache_path or settings.redirect_cache
        path.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(path)
        self.db.execute("CREATE TABLE IF NOT EXISTS redirect_cache (url TEXT PRIMARY KEY, final TEXT NOT NULL)")

    def __call__(self, url: str, text: str = "") -> str | None:
        if not is_content_link(url, text):  # unsubscribe/preferences/social: never touch these
            return None
        cached = self.db.execute("SELECT final FROM redirect_cache WHERE url = ?", (url,)).fetchone()
        if cached is not None and not (cached[0] and is_tracker(cached[0])):  # stale: rules learned a new tracker
            return cached[0] or None
        final, definite = self._follow(url)
        if final is not None:
            final = canonicalize(final)
            if not is_content_link(final, text):
                final = None  # e.g. the wrapper pointed at a social site
                definite = True
        if definite:  # cache real answers and deliberate refusals, not transient network errors
            self.db.execute("INSERT OR REPLACE INTO redirect_cache VALUES (?, ?)", (url, final or ""))
            self.db.commit()
        return final

    def _follow(self, url: str) -> tuple[str | None, bool]:
        """Returns (final_url_or_None, definite). Only requests known tracker hosts."""
        current = url
        for _ in range(self.max_hops):
            inner = unwrap_offline(current)
            if inner:
                current = inner
                continue
            if not is_tracker(current):
                return current, True  # not a tracker: this is the destination; do not contact it
            nxt, ok = self._next_hop(current)
            if not ok:
                return None, False  # network problem: try again another day
            if nxt is None:
                return None, True  # tracker did not redirect (JS/meta refresh page): cannot resolve safely
            if _looks_unsafe(nxt):
                return None, True  # chain leads to unsubscribe/opt-out: stop before touching it
            current = nxt
        return None, True

    def _next_hop(self, url: str) -> tuple[str | None, bool]:
        """One request to a tracker host. Returns (location_or_None, request_succeeded)."""
        self.sleep(self.delay_s)
        for method in ("HEAD", "GET"):
            try:
                self.requests_made += 1
                with self.client.stream(method, url) as resp:  # stream: never download the body
                    if resp.status_code == 405 and method == "HEAD":
                        continue
                    if 300 <= resp.status_code < 400 and resp.headers.get("location"):
                        return urljoin(url, resp.headers["location"]), True
                    return None, True
            except httpx.InvalidURL:
                return None, True  # tracker sent a malformed Location: deterministic, not worth retrying
            except httpx.HTTPError:
                return None, False
        return None, True
