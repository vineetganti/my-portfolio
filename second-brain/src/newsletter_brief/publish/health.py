"""Quality checks for the live beta: is what visitors can get correct, fresh, safe and the same as what you meant to publish?

Run after every publish and upload (`nb health`). It looks at the LIVE files, not the local ones, because the failure it exists
to catch is "what I published is not what is live". It reads from the outside, like a visitor would, plus your local database to
know what should be there. Nothing here writes to the site or the database.

Levels: PASS, INFO, WARN (look at it), FAIL (do not leave it live; `nb publish --pause` and fix).
"""
import json
import re
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from html import unescape
from pathlib import Path
from typing import Callable
from urllib.parse import urlsplit

from newsletter_brief.db.store import TIME_FORMAT, Store
from newsletter_brief.publish import sign
from newsletter_brief.publish.feed import PUBLIC_FILES, SCHEMA_VERSION

WARN_AGE_HOURS = 36  # one missed day is a warning, a week is a failure
FAIL_AGE_DAYS = 7
BROKEN_LINK_WARN_RATE = 0.05
RETRACTION_WARN_RATE = 0.10
RETRACTION_WINDOW_DAYS = 14
LEAK_PATTERNS = [  # keys and strings that exist only in the private database; none may ever be in a public file
    (re.compile(r'"(url_key|relevance|unverified_numbers|decision|rating|confidence|is_promotional|top_learning|not_vendor|highlight_note)"\s*:'), "a private field name"),
    (re.compile(r"[A-Za-z]:\\+Users"), "a Windows user path"),
    (re.compile(r"/(Users|home)/[a-z][a-z0-9_.-]{2,}/"), "a home-directory path"),
    (re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"), "a private key"),
]


@dataclass
class Finding:
    level: str  # PASS | INFO | WARN | FAIL
    check: str
    message: str


def _age(doc: dict, now: datetime) -> timedelta | None:
    try:
        return now - datetime.fromisoformat(doc["_generated_at"])
    except (KeyError, TypeError, ValueError):
        return None


def run_health(
    base_url: str, *, key_dir: Path | None = None, expected_good_ids: set[str], expected_daily_ids: set[str],
    fetch: Callable[[str], bytes], now: datetime | None = None, site_url: str | None = None,
    fetch_page: Callable[[str], str] | None = None, link_check: Callable[[str], tuple[int | None, str]] | None = None,
) -> list[Finding]:
    """Check the live files at `base_url` (current/<file> and .sig).
    `fetch(url)` returns bytes or raises; `fetch_page(url)` returns HTML; `link_check(url)` returns (status or None, final host).
    Pass None for fetch_page / link_check to skip those checks."""
    now = now or datetime.now(timezone.utc)
    base = base_url.rstrip("/")
    out: list[Finding] = []

    # 1. every file is fetchable and signed by YOUR key
    live: dict[str, bytes] = {}
    for name in PUBLIC_FILES:
        try:
            data = fetch(f"{base}/current/{name}")
            sig = fetch(f"{base}/current/{name}.sig").decode("ascii")
        except Exception as ex:  # noqa: BLE001 - any failure to fetch is the finding
            out.append(Finding("FAIL", "files", f"{name}: could not be fetched ({type(ex).__name__}: {str(ex)[:80]})"))
            continue
        if not sign.verify_bytes(data, sig, key_dir):
            out.append(Finding("FAIL", "signature", f"{name}: the live file's signature does not verify against your key (edited, swapped or signed by another key)"))
            continue
        live[name] = data
    if len(live) == len(PUBLIC_FILES):
        out.append(Finding("PASS", "signature", f"all {len(PUBLIC_FILES)} live files verify against your key"))

    # 2. schema, freshness, status
    docs: dict[str, dict] = {}
    for name in (n for n in PUBLIC_FILES if n.endswith(".json") and n in live):
        try:
            docs[name] = json.loads(live[name])
        except ValueError:
            out.append(Finding("FAIL", "format", f"{name}: not valid JSON"))
            continue
        if docs[name].get("_schema") != SCHEMA_VERSION:
            out.append(Finding("FAIL", "format", f"{name}: schema {docs[name].get('_schema')!r}, the site expects {SCHEMA_VERSION}"))
    newest = [a for d in docs.values() if (a := _age(d, now)) is not None]
    if newest:
        age = min(newest)
        level = "FAIL" if age > timedelta(days=FAIL_AGE_DAYS) else "WARN" if age > timedelta(hours=WARN_AGE_HOURS) else "PASS"
        out.append(Finding(level, "freshness", f"the live snapshot is {age.total_seconds() / 3600:.0f} hours old (warn over {WARN_AGE_HOURS}, fail over {FAIL_AGE_DAYS * 24})"))
    status = docs.get("status.json")
    if status is not None:
        out.append(Finding("WARN" if not status.get("enabled") else "PASS", "status",
                           "the page is PAUSED (status.json enabled=false)" + (f": {status.get('note')}" if status.get("note") else "") if not status.get("enabled") else "the page is enabled"))

    # 3. what is live is what you meant to publish
    for name, expected, label in (("good-reads.json", expected_good_ids, "Good reads"), ("feed.json", expected_daily_ids, "daily list")):
        if name not in docs:
            continue
        got = {i.get("id") for i in docs[name].get("items", [])}
        if got == expected:
            out.append(Finding("PASS", "matches local", f"{label}: {len(got)} live items, the same as your database says is public"))
        else:
            out.append(Finding("FAIL", "matches local", f"{label}: {len(expected - got)} expected item(s) not live, {len(got - expected)} live item(s) not expected (a stale or partial upload?)"))

    # 4. nothing private in any public file
    leaks = [f"{name}: {why}" for name, data in live.items() for rx, why in LEAK_PATTERNS if rx.search(data.decode("utf-8", "replace"))]
    out.append(Finding("FAIL", "no leaks", "; ".join(leaks)) if leaks else Finding("PASS", "no leaks", "no private field, path or key in any live file"))

    # 5. links
    urls = sorted({i.get("external_url") for n in ("good-reads.json", "feed.json") for i in docs.get(n, {}).get("items", []) if i.get("external_url")})
    if link_check and urls:
        broken, moved = [], []
        for url in urls:
            status_code, final_host = link_check(url)
            if status_code is None or status_code >= 400:
                broken.append(f"{url} ({status_code or 'no answer'})")
            elif final_host and final_host != urlsplit(url).hostname:
                moved.append(url)
        rate = len(broken) / len(urls)
        out.append(Finding("WARN" if rate > BROKEN_LINK_WARN_RATE else "PASS", "links",
                           f"{len(broken)} of {len(urls)} links broken ({rate:.0%})" + (": " + "; ".join(broken[:5]) if broken else "")))
        if moved:
            out.append(Finding("INFO", "links", f"{len(moved)} link(s) now redirect to another host, e.g. {moved[0]}"))

    # 6. the rendered page really shows it
    if fetch_page and site_url:
        try:
            page = unescape(fetch_page(site_url.rstrip("/") + "/second-brain"))
        except Exception as ex:  # noqa: BLE001
            out.append(Finding("FAIL", "page", f"the page could not be fetched ({type(ex).__name__}: {str(ex)[:80]})"))
        else:
            items = docs.get("good-reads.json", {}).get("items", [])
            if "Temporarily unavailable" in page:
                out.append(Finding("FAIL", "page", "the page says 'Temporarily unavailable': the site could not verify the snapshot"))
            elif "Paused for now" in page:
                out.append(Finding("INFO", "page", "the page shows its pause notice"))
            elif items and not any(i["title"] in page for i in items[:3]):
                out.append(Finding("WARN", "page", "the page does not show the newest good reads yet (it caches for up to 15 minutes; check again)"))
            else:
                out.append(Finding("PASS", "page", "the rendered page shows the newest items"))
    return out


def scorecard(store: Store, now: datetime | None = None) -> list[Finding]:
    """Beta quality numbers from your local database: how much was published, how recently, and how often you took back
    what you had published (a published item you later removed is the clearest sign the model's pick was wrong)."""
    ref = (now or datetime.now()).replace(tzinfo=None)
    log = store.published_log()
    if not log:
        return [Finding("INFO", "scorecard", "nothing has been published yet")]
    last = store.get_setting("last_publish_at")
    findings = [Finding("INFO", "scorecard", f"{len(log)} articles published so far")]
    if last:
        days = (ref - datetime.strptime(last, TIME_FORMAT)).days
        findings.append(Finding("WARN" if days > FAIL_AGE_DAYS else "INFO", "scorecard", f"last publish {days} day(s) ago"))
    cutoff = ref - timedelta(days=RETRACTION_WINDOW_DAYS)
    recent = [k for k, at in log.items() if datetime.strptime(at, TIME_FORMAT) >= cutoff]
    states = store.good_read_states()
    skipped = {k for k, lab in store.labels().items() if lab.get("decision") == "skip"}
    retracted = [k for k in recent if states.get(k, {}).get("state") == "out" or k in skipped]
    if recent:
        rate = len(retracted) / len(recent)
        findings.append(Finding("WARN" if rate > RETRACTION_WARN_RATE else "PASS", "retraction",
                                f"{len(retracted)} of {len(recent)} articles published in the last {RETRACTION_WINDOW_DAYS} days were later removed or skipped ({rate:.0%}; warn over {RETRACTION_WARN_RATE:.0%})"))
    return findings


def worst(findings: list[Finding]) -> str:
    order = ["PASS", "INFO", "WARN", "FAIL"]
    return max((f.level for f in findings), key=order.index, default="PASS")


def format_report(findings: list[Finding], when: datetime | None = None) -> str:
    when = when or datetime.now()
    lines = [f"# Second brain health: {when:%Y-%m-%d %H:%M}", "", f"**Overall: {worst(findings)}**", "", "| Level | Check | Result |", "|---|---|---|"]
    lines += [f"| {f.level} | {f.check} | {f.message.replace('|', '/')} |" for f in findings]
    return "\n".join(lines) + "\n"


# --- real network ---------------------------------------------------------------------------------------------------------
def http_fetch(url: str) -> bytes:
    import httpx

    r = httpx.get(url, timeout=20, follow_redirects=True, headers={"User-Agent": "second-brain-health-check"})
    r.raise_for_status()
    return r.content


def http_page(url: str) -> str:
    return http_fetch(url).decode("utf-8", "replace")


def make_link_check(delay: float = 1.0) -> Callable[[str], tuple[int | None, str]]:
    """One polite request per `delay` seconds: HEAD first, GET if the server refuses HEAD. Never raises."""
    import httpx

    def check(url: str) -> tuple[int | None, str]:
        time.sleep(delay)
        headers = {"User-Agent": "Mozilla/5.0 (compatible; second-brain-health-check)"}
        try:
            r = httpx.head(url, timeout=15, follow_redirects=True, headers=headers)
            if r.status_code in (403, 405, 501):
                r = httpx.get(url, timeout=15, follow_redirects=True, headers=headers)
            return r.status_code, r.url.host or ""
        except httpx.HTTPError:
            return None, ""

    return check
