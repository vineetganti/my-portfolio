"""Render the digest: a VIEW over the stored items for the window, so re-running never empties it.

Layout rules (from the user): every article appears exactly ONCE; breakthrough tech and open-source contributions are
highlighted; vendor product announcements go in a low-priority section at the end, not hidden. Each item is placed in
the first bucket it qualifies for, so it cannot repeat. Near-duplicate stories are dropped, keeping the first.

The user's own labels beat the model: a skipped item is left out, "top learning" forces the Top picks section, and
"not a vendor announcement" overrides the model's promotional flag. Labels live in their own table, so re-triaging
never erases them.

Everything else is the model's triage of other people's articles. The summary is grounded in the article text;
"why it matters" is the model's own opinion and is labelled as such. Nothing is published from here.
"""
import difflib
import json
import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from urllib.parse import urlsplit

from newsletter_brief.daily import ARCHIVE_SECTION, CONFIDENCE_RANK, Report
from newsletter_brief.db.store import Store
from newsletter_brief.sources.registry import ENGINEERING_SECTIONS, FEEDS, SOURCES

GOOD_READS = "Good reads"  # the permanent shelf: the best learning posts, chosen by the user (or by the model, then vetoable)
HIGHLIGHTS = "Breakthroughs and open source"
TOP = "Top picks: LLM internals, distributed systems, core engineering, AI"
LOW_PRIORITY = "Product announcements and vendor news (low priority)"
OTHER = "Other"
ARCHIVE = ARCHIVE_SECTION  # old posts resurfaced from dormant blogs
CORE_CATEGORIES = {"llm_internals", "distributed_systems", "core_engineering", "ai_research"}  # the user's top-tier learning areas
ARROW = {1: "SKIP", 2: "MEH", 3: "GOOD", 4: "GREAT", 5: "TOP LEARNING"}  # the reader's rating, as shown in the digest
HIGHLIGHT_MIN_RELEVANCE = 3  # a flagged item below this stays in its normal section (still badged)


@dataclass
class DigestItem:
    doc_id: str
    source_id: str
    source_name: str
    section: str
    title: str
    url: str
    published: datetime | None
    relevance: int
    type: str
    summary: str
    why: str
    topics: list[str]
    confidence: str
    is_promotional: bool
    breakthrough: bool = False
    open_source: bool = False
    highlight_note: str = ""
    category: str = ""
    url_key: str = ""
    decision: str = ""  # "", "approve" or "skip": the user's label
    top_learning: bool = False  # user label
    publish: bool = False  # user label: may appear on the public feed
    tag: str = ""
    rating: int = 0  # the reader's 1 to 5 rating, 0 = unrated
    unverified: list[str] = field(default_factory=list)
    duplicate_of: str | None = None
    good_read: bool = False  # on the shelf
    good_read_origin: str = ""  # "you" or "model"
    good_read_added: str = ""  # local time it joined the shelf


STOP = set("this that with from have has had were was are for and the its their into over about which also than then them they will would "
           "using used use new can how what when where while more most such these those been being not but all any each".split())


def _words(text: str) -> set[str]:
    return {w for w in re.findall(r"[a-z0-9][a-z0-9\-]{3,}", text.lower()) if w not in STOP}


def _slug(url: str) -> tuple[str, str]:
    p = urlsplit(url)
    return (p.hostname or "").removeprefix("www."), p.path.rstrip("/").rsplit("/", 1)[-1].lower()


def same_story(a: "DigestItem", b: "DigestItem") -> bool:
    """True when two items are plausibly the same article: near-identical titles, the same final URL slug on the same host,
    or summaries that share most of their distinctive words (the same story on two sites with different titles)."""
    if difflib.SequenceMatcher(None, a.title.lower(), b.title.lower()).ratio() >= 0.9:
        return True
    if _slug(a.url) == _slug(b.url) and _slug(a.url)[1]:
        return True
    wa, wb = _words(a.summary), _words(b.summary)
    shared = wa & wb
    return len(shared) >= 6 and len(shared) / max(1, len(wa | wb)) >= 0.45


def _digest_item(r: dict, labels: dict, names: dict, shelf: dict) -> DigestItem:
    lab = labels.get(r["url_key"], {})
    on = shelf.get(r["url_key"], {})
    return DigestItem(
        doc_id=r["doc_id"], source_id=r["source_id"], source_name=names.get(r["source_id"], r["source_id"]), section=r["section"],
        title=r["title"], url=r["url"], published=datetime.fromisoformat(r["published"]) if r["published"] else None,
        relevance=r["relevance"], type=r["type"], summary=r["summary"], why=r["why"], topics=json.loads(r["topics"] or "[]"),
        confidence=r["confidence"], unverified=json.loads(r["unverified_numbers"] or "[]"),
        is_promotional=bool(r["is_promotional"]) and not lab.get("not_vendor"),  # user label overrides the model
        breakthrough=bool(r["breakthrough"]), open_source=bool(r["open_source"]), highlight_note=r["highlight_note"] or "",
        category=r["category"] or "", url_key=r["url_key"], decision=lab.get("decision", ""), top_learning=bool(lab.get("top_learning")),
        publish=bool(lab.get("publish")), tag=lab.get("tag", ""), rating=int(lab.get("rating") or 0),
        good_read=on.get("state") == "in", good_read_origin=on.get("origin", "") if on.get("state") == "in" else "",
        good_read_added=on.get("added_at", "") if on.get("state") == "in" else "",
    )


def load_items(store: Store, feed: str, days: int, now: datetime | None = None) -> list[DigestItem]:
    now = now or datetime.now(timezone.utc)
    names = {s.id: s.name for s in SOURCES}
    since = (now - timedelta(days=days)).isoformat()
    labels, shelf = store.labels(), store.good_read_states()
    items = [_digest_item(r, labels, names, shelf) for r in store.items(feed, since)]
    for i, it in enumerate(items):  # oldest first, so the earlier item is the original
        for other in items[:i]:
            if other.duplicate_of is None and same_story(other, it):
                it.duplicate_of = other.doc_id  # lexical checks only; embedding-based dedupe is not built yet
                break
    return items


def load_good_reads(store: Store) -> list[DigestItem]:
    """The whole shelf, newest first, however old the articles are (the digest window does not apply to it)."""
    names = {s.id: s.name for s in SOURCES}
    labels, shelf = store.labels(), store.good_read_states()
    return [_digest_item(r, labels, names, shelf) for r in store.good_reads()]


def ranked(items: list[DigestItem]) -> list[DigestItem]:
    return sorted(items, key=lambda i: (-i.top_learning, -i.rating, -(i.decision == "approve"), -i.relevance, -CONFIDENCE_RANK[i.confidence],
                                        -(i.published.timestamp() if i.published else 0)))


def buckets(items: list[DigestItem]) -> tuple[list[tuple[str, list[DigestItem]]], int]:
    """([(label, items)], duplicates_dropped). Every kept item is in exactly one bucket; items the user skipped are left out."""
    visible = [i for i in items if i.duplicate_of is None and i.decision != "skip"]
    dropped = sum(1 for i in items if i.duplicate_of is not None and i.decision != "skip")
    placed: set[str] = set()
    out: list[tuple[str, list[DigestItem]]] = []

    def take(label: str, pred, pool: list[DigestItem]) -> None:
        rows = ranked([i for i in pool if i.doc_id not in placed and pred(i)])
        placed.update(i.doc_id for i in rows)
        if rows:
            out.append((label, rows))

    take(GOOD_READS, lambda i: i.good_read, visible)  # first, so a good read is never repeated in another bucket
    regular = [i for i in visible if not i.is_promotional]
    current = [i for i in regular if i.section != ARCHIVE or i.top_learning]  # archive picks stay in their own section unless the user promotes one
    take(HIGHLIGHTS, lambda i: (i.breakthrough or i.open_source) and i.relevance >= HIGHLIGHT_MIN_RELEVANCE, current)
    take(TOP, lambda i: i.top_learning or (i.category in CORE_CATEGORIES and i.relevance >= 3), current)
    for key, label in ENGINEERING_SECTIONS.items():
        take(label, lambda i, key=key: i.section == key, regular)
    take(OTHER, lambda i: True, regular)
    take(LOW_PRIORITY, lambda i: True, [i for i in visible if i.is_promotional])
    return out, dropped


def _line(it: DigestItem) -> str:
    day = (it.published.strftime("%b %Y" if it.section == ARCHIVE else "%b %d") if it.published else "date unknown")  # an old post needs its year
    badges = "".join(f"`{b}` " for b, on in (("TOP LEARNING", it.top_learning), ("BREAKTHROUGH", it.breakthrough),
                                              ("OPEN SOURCE", it.open_source), ("APPROVED", it.decision == "approve")) if on)
    badges += f"`GOOD READ ({it.good_read_origin})` " if it.good_read and it.good_read_origin else ""
    badges += f"`YOU: {ARROW.get(it.rating, str(it.rating) + '/5')}` " if it.rating else ""
    flags = []
    if it.unverified:
        flags.append(f"unverified figure(s) in summary: {', '.join(it.unverified)}")
    if it.confidence == "low":
        flags.append("low confidence")
    extra = ""
    if (it.breakthrough or it.open_source) and it.highlight_note:
        extra += f"\n  - *Highlight (from the text):* {it.highlight_note}"
    if flags:
        extra += f"\n  - flags: {'; '.join(flags)}"
    return (f"- {badges}**[{it.relevance}/5] [{it.title}]({it.url})** ({it.source_name}, {day}, {it.category or it.type})\n"
            f"  - {it.summary}\n  - *Why it matters (model's view):* {it.why}{extra}")


def render_markdown(items: list[DigestItem], report: Report | None = None, days: int = 3, generated: datetime | None = None) -> str:
    groups, dropped = buckets(items)
    shown = sum(len(rows) for _, rows in groups)
    skipped = sum(1 for i in items if i.decision == "skip")
    head = [
        f"# {FEEDS.get('engineering')}: daily digest",
        f"*Generated {(generated or datetime.now()).strftime('%Y-%m-%d %H:%M')}. Window: last {days} days. {shown} articles, each listed once"
        + (f" ({dropped} duplicate{'s' if dropped != 1 else ''} dropped)" if dropped else "")
        + (f" ({skipped} skipped by you)" if skipped else "") + ".*",
        "",
    ]
    if report:
        u = report.usage
        head += [f"This run: {report.sources_ok} feeds read ({len(report.feed_errors)} failed), {report.entries_in_window} entries in window, "
                 f"{report.already_seen} already seen, {len(report.items)} newly triaged, {report.over_cap} over the caps, "
                 f"{sum(report.skipped.values())} skipped ({dict(report.skipped) or 'none'}), {len(report.llm_errors)} model errors, "
                 f"{report.seconds:.0f}s"
                 + (f", {u.get('calls', 0)} model calls, {u.get('output_tokens', 0)} output tokens, logged cost {u.get('cost_usd', 0)}." if u else "."), ""]
    out = list(head)
    for label, rows in groups:
        out += [f"## {label} ({len(rows)})", ""] + [_line(i) for i in rows] + [""]
    return "\n".join(out)


def to_json(items: list[DigestItem], feed: str = "engineering", days: int = 3) -> str:
    groups, _ = buckets(items)
    rows = [{
        "doc_id": i.doc_id, "bucket": label, "low_priority": label == LOW_PRIORITY, "source": i.source_id, "section": i.section,
        "title": i.title, "url": i.url, "published": i.published.isoformat() if i.published else None, "relevance": i.relevance,
        "type": i.type, "category": i.category, "summary": i.summary, "why_it_matters": i.why, "topics": i.topics,
        "confidence": i.confidence, "breakthrough": i.breakthrough, "open_source": i.open_source, "highlight_note": i.highlight_note,
        "unverified_numbers": i.unverified, "rating": i.rating, "decision": i.decision, "top_learning": i.top_learning, "publish": i.publish, "tag": i.tag,
    } for label, group in groups for i in group]
    return json.dumps({"feed": feed, "days": days, "items": rows}, indent=1, ensure_ascii=False)
