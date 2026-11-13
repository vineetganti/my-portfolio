"""Public feed for vineetganti.com: JSON Feed 1.1 and RSS 2.0, built ONLY from items the user marked "Publish on my site".

This writes local files and uploads nothing. The public contract is a strict whitelist: the original article's title and link,
the source name, the date, a short summary grounded in the article text, the category and badges, and the model's "why it
matters" line explicitly labelled as AI-written. Never included: article body text, raw emails, the user's notes and decisions,
relevance scores, unverified-figure flags, tokens or any private field.
"""
import json
from datetime import datetime, timedelta, timezone
from email.utils import format_datetime
from pathlib import Path
from xml.sax.saxutils import escape

from newsletter_brief.brief.build import DigestItem, buckets
from newsletter_brief.brief.goodreads import HOLD_HOURS
from newsletter_brief.db.store import TIME_FORMAT

SITE = "https://www.vineetganti.com"
TITLE = "Vineet Ganti: Engineering and AI reading list"
DESCRIPTION = ("Articles picked from company engineering and AI research blogs. Summaries are generated from the article text "
               "and checked automatically; follow each link for the original.")


SCHEMA_VERSION = 1  # the site rejects a file whose schema it does not know


def public_items(items: list[DigestItem]) -> list[DigestItem]:
    """Published, not skipped, once each, in the order of the digest's buckets. A good read is left out: it is shown in the
    Good reads list, and an article is never listed twice."""
    groups, _ = buckets(items)
    return [i for _, rows in groups for i in rows if i.publish and i.decision != "skip" and not i.good_read]


def public_good_reads(shelf: list[DigestItem], now: datetime | None = None) -> list[DigestItem]:
    """The shelf as visitors may see it, newest first. A good read the model added becomes public only after HOLD_HOURS on
    the shelf, so a bad batch can be removed before anyone sees it; one you added is public at once; a skipped one never is."""
    ref = (now or datetime.now()).replace(tzinfo=None)
    out = []
    for i in shelf:
        if i.decision == "skip" or not i.good_read:
            continue
        if i.good_read_origin == "model" and (not i.good_read_added
                                              or datetime.strptime(i.good_read_added, TIME_FORMAT) > ref - timedelta(hours=HOLD_HOURS)):
            continue
        out.append(i)
    return sorted(out, key=lambda i: i.good_read_added, reverse=True)


def _tags(i: DigestItem) -> list[str]:
    tags = [i.category] if i.category else []
    tags += [t for t, on in (("open-source", i.open_source), ("breakthrough", i.breakthrough), ("top-learning", i.top_learning)) if on]
    return tags + ([i.tag] if i.tag else [])


def _json_feed(rows: list[DigestItem], site: str, title: str, anchor: str, feed_file: str, now: datetime | None = None) -> dict:
    return {
        "version": "https://jsonfeed.org/version/1.1", "title": title, "home_page_url": f"{site}/second-brain{anchor}",
        "feed_url": f"{site}/second-brain/{feed_file}", "description": DESCRIPTION, "language": "en",
        "_schema": SCHEMA_VERSION, "_generated_at": (now or datetime.now(timezone.utc)).isoformat(), "_count": len(rows),
        "items": [{
            "id": i.doc_id, "url": f"{site}/second-brain#{i.doc_id}", "external_url": i.url, "title": i.title,
            "content_text": i.summary,
            "date_published": (i.published or datetime.now(timezone.utc)).isoformat(),
            "tags": _tags(i), "authors": [{"name": i.source_name}],
            "_ai_note": {"label": "Written by an AI model, not the article's author", "why_it_matters": i.why},
        } for i in rows],
    }


def to_json_feed(items: list[DigestItem], site: str = SITE, now: datetime | None = None) -> dict:
    return _json_feed(public_items(items), site, TITLE, "", "feed.json", now)


def to_good_reads_json(shelf: list[DigestItem], site: str = SITE, now: datetime | None = None) -> dict:
    return _json_feed(public_good_reads(shelf, now), site, f"{TITLE} (Good reads)", "#good-reads", "good-reads.json", now)


def _rss(public: list[DigestItem], site: str, title: str) -> str:
    rows = []
    for i in public:
        pub = format_datetime(i.published or datetime.now(timezone.utc))
        desc = f"{i.summary}\n\nAI-written note on why it matters: {i.why}\n\nSource: {i.source_name}"
        rows.append(f"    <item>\n      <title>{escape(i.title)}</title>\n      <link>{escape(i.url)}</link>\n"
                    f"      <guid isPermaLink=\"false\">{escape(i.doc_id)}</guid>\n      <pubDate>{pub}</pubDate>\n"
                    + "".join(f"      <category>{escape(t)}</category>\n" for t in _tags(i))
                    + f"      <description>{escape(desc)}</description>\n    </item>")
    return ("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<rss version=\"2.0\">\n  <channel>\n"
            f"    <title>{escape(title)}</title>\n    <link>{site}/second-brain</link>\n    <description>{escape(DESCRIPTION)}</description>\n"
            + "\n".join(rows) + "\n  </channel>\n</rss>\n")


def to_rss(items: list[DigestItem], site: str = SITE) -> str:
    return _rss(public_items(items), site, TITLE)


def to_good_reads_rss(shelf: list[DigestItem], site: str = SITE, now: datetime | None = None) -> str:
    return _rss(public_good_reads(shelf, now), site, f"{TITLE} (Good reads)")


PUBLIC_FILES = ("feed.json", "feed.xml", "good-reads.json", "good-reads.xml", "status.json")  # all signed; the site verifies each


def to_status(enabled: bool = True, note: str = "", now: datetime | None = None) -> dict:
    """The kill switch the site reads: `enabled: false` makes the page show a short "paused" notice instead of the lists.
    It is signed like every other file, so nobody else can switch the page on or off."""
    return {"_schema": SCHEMA_VERSION, "_generated_at": (now or datetime.now(timezone.utc)).isoformat(),
            "enabled": bool(enabled), "note": note.strip()[:200]}


def write_public_feed(items: list[DigestItem], out_dir: Path, site: str = SITE, shelf: list[DigestItem] | None = None,
                      now: datetime | None = None, enabled: bool = True, note: str = "") -> int:
    """Write the public files; returns how many daily items were written. Good reads files are written when `shelf` is given.
    `status.json` is always written; pass enabled=False to pause the page."""
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "status.json").write_text(json.dumps(to_status(enabled, note, now), indent=1, ensure_ascii=False), encoding="utf-8")
    (out_dir / "feed.json").write_text(json.dumps(to_json_feed(items, site, now), indent=1, ensure_ascii=False), encoding="utf-8")
    (out_dir / "feed.xml").write_text(to_rss(items, site), encoding="utf-8")
    if shelf is not None:
        (out_dir / "good-reads.json").write_text(json.dumps(to_good_reads_json(shelf, site, now), indent=1, ensure_ascii=False), encoding="utf-8")
        (out_dir / "good-reads.xml").write_text(to_good_reads_rss(shelf, site, now), encoding="utf-8")
    return len(public_items(items))
