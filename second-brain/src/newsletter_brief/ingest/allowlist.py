"""Sender allowlist (SQLite): the strict gate for what counts as a newsletter.

Only exact sender addresses on this list are ever fetched. That keeps promotions,
receipts and alerts out by construction, and it also keeps Gmail quota use low.
Edit DEFAULT_SENDERS or use add_sender()/remove_sender().
"""
import sqlite3
from pathlib import Path

from newsletter_brief.config import settings

# Entries are either a full address or a whole domain ("@substack.com").
# Domain entries are broad: they also let through that domain's notification and promo mail,
# so the Stage 2 LLM step (not this list) is what drops non-content items.
DEFAULT_SENDERS: dict[str, str] = {
    "@substack.com": "All Substack newsletters (also includes notification mail)",
    "@medium.com": "Medium digests",
    "@seekingalpha.com": "Seeking Alpha - markets analysis",
    "@nytimes.com": "NYT newsletters (some promo mail)",
    "@tldrnewsletter.com": "TLDR newsletters",
    "paul@learnpracticeplay.com": "Learn Practice Play",
    "updates@epth.hindugroup.org.in": "The Hindu ePaper - daily headlines digest (exact address: sender is a subdomain)",
    "newsletter@economictimesnews.com": "Economic Times - markets and business",
    "morning@finshots.in": "Finshots - finance explainers",
    "marc@updates.langfuse.com": "Langfuse - product updates",
}


def is_allowed(sender_addr: str, entries: list[str]) -> bool:
    """Match a From address against the allowlist, ignoring '+tag' (lenny+how-i-ai@ -> lenny@)."""
    addr = sender_addr.strip().lower()
    local, _, domain = addr.partition("@")
    untagged = f"{local.split('+')[0]}@{domain}"
    return any(e in (addr, untagged, f"@{domain}") for e in entries)


def _connect(db_path: Path | None = None) -> sqlite3.Connection:
    path = db_path or settings.db_path
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.execute(
        "CREATE TABLE IF NOT EXISTS allowed_senders ("
        "addr TEXT PRIMARY KEY, note TEXT NOT NULL DEFAULT '', "
        "added_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"
    )
    return conn


def add_sender(addr: str, note: str = "", db_path: Path | None = None) -> None:
    with _connect(db_path) as conn:
        conn.execute(
            "INSERT INTO allowed_senders (addr, note) VALUES (?, ?) "
            "ON CONFLICT(addr) DO UPDATE SET note = excluded.note",
            (addr.strip().lower(), note),
        )


def remove_sender(addr: str, db_path: Path | None = None) -> None:
    with _connect(db_path) as conn:
        conn.execute("DELETE FROM allowed_senders WHERE addr = ?", (addr.strip().lower(),))


def list_senders(db_path: Path | None = None) -> list[str]:
    with _connect(db_path) as conn:
        return [r[0] for r in conn.execute("SELECT addr FROM allowed_senders ORDER BY addr")]


def seed_defaults(db_path: Path | None = None) -> None:
    for addr, note in DEFAULT_SENDERS.items():
        add_sender(addr, note, db_path)
