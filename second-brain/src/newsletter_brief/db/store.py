"""SQLite store for the daily run: which URLs were already handled, and the triaged items (the future brief)."""
import json
import sqlite3
import threading
import time
from datetime import datetime, timedelta
from pathlib import Path

from newsletter_brief.config import settings

SCHEMA = """
CREATE TABLE IF NOT EXISTS seen_documents (
    url_key TEXT PRIMARY KEY, source_id TEXT, url TEXT, title TEXT, first_seen TEXT, outcome TEXT);
CREATE TABLE IF NOT EXISTS labels (
    url_key TEXT PRIMARY KEY, decision TEXT DEFAULT '', top_learning INTEGER DEFAULT 0, not_vendor INTEGER DEFAULT 0,
    publish INTEGER DEFAULT 0, tag TEXT DEFAULT '', note TEXT DEFAULT '', labeled_at TEXT, origin TEXT DEFAULT 'ui', rating INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS items (
    doc_id TEXT PRIMARY KEY, url_key TEXT, source_id TEXT, feed TEXT, section TEXT, title TEXT, url TEXT,
    published TEXT, relevance INTEGER, type TEXT, summary TEXT, why TEXT, topics TEXT, confidence TEXT,
    is_promotional INTEGER, unverified_numbers TEXT, triaged_at TEXT, status TEXT DEFAULT 'pending',
    breakthrough INTEGER DEFAULT 0, open_source INTEGER DEFAULT 0, highlight_note TEXT DEFAULT '', category TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS page_state (
    url_key TEXT PRIMARY KEY, lastmod TEXT, text_hash TEXT, checked_at TEXT);
CREATE TABLE IF NOT EXISTS http_validators (
    url TEXT PRIMARY KEY, etag TEXT, last_modified TEXT);
CREATE TABLE IF NOT EXISTS good_reads (
    url_key TEXT PRIMARY KEY, state TEXT, origin TEXT, added_at TEXT, decided_at TEXT);
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS published (
    url_key TEXT PRIMARY KEY, first_published_at TEXT);
"""
TIME_FORMAT = "%Y-%m-%dT%H:%M:%S"  # local time, as written by every table here
ITEM_COLUMNS = ("url_key, doc_id, source_id, section, title, url, published, relevance, type, summary, why, topics, confidence,"
                " is_promotional, unverified_numbers, breakthrough, open_source, highlight_note, category")
NEW_COLUMNS = {"breakthrough": "INTEGER DEFAULT 0", "open_source": "INTEGER DEFAULT 0", "highlight_note": "TEXT DEFAULT ''", "category": "TEXT DEFAULT ''"}


class Store:
    def __init__(self, path: Path | None = None):
        path = path or settings.db_path
        path.parent.mkdir(parents=True, exist_ok=True)
        # Gradio runs event handlers on worker threads, so the connection must be usable from any thread; writes are serialised by a lock.
        self.db = sqlite3.connect(path, check_same_thread=False)
        self._lock = threading.RLock()
        self.db.executescript(SCHEMA)
        have = {r[1] for r in self.db.execute("PRAGMA table_info(items)")}
        for col, ddl in NEW_COLUMNS.items():  # databases created before these columns existed
            if col not in have:
                self.db.execute(f"ALTER TABLE items ADD COLUMN {col} {ddl}")
        if "rating" not in {r[1] for r in self.db.execute("PRAGMA table_info(labels)")}:  # labels created before ratings
            self.db.execute("ALTER TABLE labels ADD COLUMN rating INTEGER DEFAULT 0")
        self.db.commit()

    def page_state(self, url_key: str) -> dict | None:
        """What was last seen of a watched page: the sitemap lastmod (ISO) and a hash of its extracted text."""
        row = self.db.execute("SELECT lastmod, text_hash FROM page_state WHERE url_key = ?", (url_key,)).fetchone()
        return {"lastmod": row[0], "text_hash": row[1]} if row else None

    def set_page_state(self, url_key: str, lastmod: str | None, text_hash: str | None) -> None:
        with self._lock:
            old = self.page_state(url_key) or {}
            self.db.execute("INSERT OR REPLACE INTO page_state VALUES (?, ?, ?, ?)",
                            (url_key, lastmod, text_hash or old.get("text_hash"), time.strftime("%Y-%m-%dT%H:%M:%S")))
            self.db.commit()

    def http_validators(self, url: str) -> tuple[str | None, str | None]:
        row = self.db.execute("SELECT etag, last_modified FROM http_validators WHERE url = ?", (url,)).fetchone()
        return (row[0], row[1]) if row else (None, None)

    def set_http_validators(self, url: str, etag: str | None, last_modified: str | None) -> None:
        with self._lock:
            self.db.execute("INSERT OR REPLACE INTO http_validators VALUES (?, ?, ?)", (url, etag, last_modified))
            self.db.commit()

    def seen(self, url_key: str) -> bool:
        return self.db.execute("SELECT 1 FROM seen_documents WHERE url_key = ?", (url_key,)).fetchone() is not None

    def mark_seen(self, url_key: str, source_id: str, url: str, title: str, outcome: str) -> None:
        with self._lock:
            self._mark_seen(url_key, source_id, url, title, outcome)

    def _mark_seen(self, url_key: str, source_id: str, url: str, title: str, outcome: str) -> None:
        self.db.execute(
            "INSERT OR REPLACE INTO seen_documents VALUES (?, ?, ?, ?, ?, ?)",
            (url_key, source_id, url, title, time.strftime("%Y-%m-%dT%H:%M:%S"), outcome),
        )
        self.db.commit()

    def save_item(self, *, url_key: str, feed: str, section: str, published: str | None, item, unverified: list[str]) -> None:
        self.db.execute(
            "INSERT OR REPLACE INTO items (doc_id, url_key, source_id, feed, section, title, url, published, relevance, type, summary, why,"
            " topics, confidence, is_promotional, unverified_numbers, triaged_at, breakthrough, open_source, highlight_note, category)"
            " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (item.doc_id, url_key, item.source, feed, section, item.title, item.url, published, item.relevance, item.type,
             item.summary_2_lines, item.why_it_matters, json.dumps(item.topics), item.confidence, int(item.is_promotional),
             json.dumps(unverified), time.strftime("%Y-%m-%dT%H:%M:%S"), int(item.breakthrough), int(item.open_source), item.highlight_note, item.category),
        )
        self.db.commit()

    def items(self, feed: str, since_iso: str) -> list[dict]:
        """Stored items for a feed whose date (published, else triaged) is on or after `since_iso`.
        An archive item (an old post resurfaced from a dormant blog) is dated by when it was picked, not when it was written,
        so it stays in the digest for the window like any new item; `published` is still returned for display."""
        shown = "CASE WHEN section = 'archive' THEN triaged_at ELSE COALESCE(published, triaged_at) END"
        cur = self.db.execute(
            f"SELECT {ITEM_COLUMNS} FROM items WHERE feed = ? AND {shown} >= ? ORDER BY {shown}",
            (feed, since_iso),
        )
        cols = [c[0] for c in cur.description]
        return [dict(zip(cols, row)) for row in cur.fetchall()]

    def set_label(self, url_key: str, *, decision: str = "", top_learning: bool = False, not_vendor: bool = False,
                  publish: bool = False, tag: str = "", note: str = "", origin: str = "ui", rating: int = 0) -> None:
        """The user's judgment about one article. Separate from the model's triage, so re-triaging never erases it."""
        if decision not in ("", "approve", "skip"):
            raise ValueError(f"decision must be '', 'approve' or 'skip', got {decision!r}")
        with self._lock:
            self._set_label(url_key, decision, top_learning, not_vendor, publish, tag, note, origin, rating)

    def _set_label(self, url_key, decision, top_learning, not_vendor, publish, tag, note, origin, rating) -> None:
        self.db.execute(
            "INSERT OR REPLACE INTO labels (url_key, decision, top_learning, not_vendor, publish, tag, note, labeled_at, origin, rating)"
            " VALUES (?,?,?,?,?,?,?,?,?,?)",
            (url_key, decision, int(top_learning), int(not_vendor), int(publish), tag.strip(), note.strip(),
             time.strftime("%Y-%m-%dT%H:%M:%S"), origin, int(rating)),
        )
        self.db.commit()

    def labels(self) -> dict[str, dict]:
        cur = self.db.execute("SELECT url_key, decision, top_learning, not_vendor, publish, tag, note, origin, rating FROM labels")
        cols = [c[0] for c in cur.description]
        return {row[0]: dict(zip(cols, row)) for row in cur.fetchall()}

    # --- settings -------------------------------------------------------------------------------------------------
    def get_setting(self, key: str, default: str = "") -> str:
        row = self.db.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
        return row[0] if row else default

    def set_setting(self, key: str, value: str) -> None:
        with self._lock:
            self.db.execute("INSERT OR REPLACE INTO settings VALUES (?, ?)", (key, value))
            self.db.commit()

    # --- good reads: the shelf. 'in' = on the shelf, 'out' = removed by the user (a veto the model never overrides) --------
    def set_good_read(self, url_key: str, state: str, origin: str) -> None:
        """Put an article on the shelf ('in') or veto it ('out'). Re-adding an item already 'in' keeps its added_at, and
        origin 'you' is never downgraded to 'model'."""
        if state not in ("in", "out") or origin not in ("you", "model"):
            raise ValueError(f"state must be 'in' or 'out' and origin 'you' or 'model', got {state!r}, {origin!r}")
        now = time.strftime(TIME_FORMAT)
        with self._lock:
            old = self.good_read_states().get(url_key)
            added = old["added_at"] if old and old["state"] == "in" and state == "in" else now
            if old and old["state"] == "in" and state == "in" and old["origin"] == "you":
                origin = "you"
            self.db.execute("INSERT OR REPLACE INTO good_reads VALUES (?, ?, ?, ?, ?)", (url_key, state, origin, added, now))
            self.db.commit()

    def good_read_states(self) -> dict[str, dict]:
        cur = self.db.execute("SELECT url_key, state, origin, added_at, decided_at FROM good_reads")
        cols = [c[0] for c in cur.description]
        return {row[0]: dict(zip(cols, row)) for row in cur.fetchall()}

    def good_reads(self) -> list[dict]:
        """The whole shelf, newest first, with no date window (a good read stays however old it is)."""
        cols = ", ".join(f"i.{c.strip()}" for c in ITEM_COLUMNS.split(","))
        cur = self.db.execute(
            f"SELECT {cols}, g.origin AS gr_origin, g.added_at AS gr_added FROM good_reads g JOIN items i ON i.url_key = g.url_key"
            " WHERE g.state = 'in' ORDER BY g.added_at DESC")
        names = [c[0] for c in cur.description]
        return [dict(zip(names, row)) for row in cur.fetchall()]

    # --- publication history (what has ever been in a public file), for the beta's quality checks ------------------------
    def record_published(self, url_keys: list[str]) -> None:
        """Remember when each article first appeared in a public file, and when a publish last ran."""
        now = time.strftime(TIME_FORMAT)
        with self._lock:
            self.db.executemany("INSERT OR IGNORE INTO published VALUES (?, ?)", [(k, now) for k in url_keys])
            self.db.execute("INSERT OR REPLACE INTO settings VALUES ('last_publish_at', ?)", (now,))
            self.db.commit()

    def published_log(self) -> dict[str, str]:
        return dict(self.db.execute("SELECT url_key, first_published_at FROM published").fetchall())

    # --- retention ------------------------------------------------------------------------------------------------
    def purge_items(self, days: int = 7, now: datetime | None = None, dry_run: bool = False) -> int:
        """Delete stored items older than `days` (by when they were stored), except those on the shelf and those the user
        labelled: the evaluation and the learning examples read the user's rated items from this table. Returns how many.
        seen_documents is untouched, so a purged article is never fetched and triaged again."""
        ref = (now or datetime.now().astimezone()).astimezone()
        cutoff = (ref - timedelta(days=days)).strftime(TIME_FORMAT)
        where = ("triaged_at < ? AND url_key NOT IN (SELECT url_key FROM labels)"
                 " AND url_key NOT IN (SELECT url_key FROM good_reads WHERE state = 'in')")
        with self._lock:
            n = self.db.execute(f"SELECT COUNT(*) FROM items WHERE {where}", (cutoff,)).fetchone()[0]
            if n and not dry_run:
                self.db.execute(f"DELETE FROM items WHERE {where}", (cutoff,))
                self.db.commit()
        return n
