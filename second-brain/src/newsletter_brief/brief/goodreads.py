"""Good reads: the permanent shelf of the best learning posts, and the switch between manual and automatic curation.

Who is on the shelf:
- manual mode (the default, while you rate items): only what YOU put there (rating an item "top learning", or `nb goodreads add`);
- automatic mode (rating has stopped): the model also adds items that clear a high bar, and you can remove any of them.
A removal is a veto stored on the shelf table ("out"): the model never re-adds it, only an explicit action by you can.

Automatic mode also turns on 7-day retention of the daily feed (Store.purge_items). The shelf and the items you rated are
exempt. Switching to automatic is gated by the measurements in memory/decisions.py; `force` overrides them, knowingly.
"""
from newsletter_brief.brief.build import CORE_CATEGORIES, DigestItem, load_items
from newsletter_brief.db.store import Store
from newsletter_brief.memory.decisions import evaluate

MANUAL, AUTOMATIC = "manual", "automatic"
RETENTION_DAYS = 7
HOLD_HOURS = 24  # a model-added good read is not made public until it has been on the shelf this long, so you can veto it first
CANDIDATE_MIN_RELEVANCE = 4


def get_mode(store: Store) -> str:
    return AUTOMATIC if store.get_setting("mode", MANUAL) == AUTOMATIC else MANUAL


def set_mode(store: Store, mode: str, force: bool = False) -> tuple[bool, str]:
    """Switch mode. Going automatic needs every gate of `nb eval` to pass (an empty history fails), unless forced."""
    if mode not in (MANUAL, AUTOMATIC):
        raise ValueError(f"mode must be 'manual' or 'automatic', got {mode!r}")
    if mode == AUTOMATIC and not force:
        gates = evaluate(store).get("gates") or {}
        failing = [name for name, ok in gates.items() if not ok]
        if not gates or failing:
            return False, ("Not switched: " + ("no ratings yet" if not gates else "gates not met: " + "; ".join(failing))
                           + ". Use --force to switch anyway.")
    store.set_setting("mode", mode)
    return True, f"Mode is now {mode}." + (f" The model will add good reads, and items older than {RETENTION_DAYS} days (except the shelf and "
                                           "your rated items) will be deleted after each `nb daily`." if mode == AUTOMATIC else "")


def is_candidate(it: DigestItem) -> bool:
    """A strict bar, because in automatic mode this adds to a public shelf: a high score, high confidence, one of the core
    learning areas, not an announcement, and not something the user skipped."""
    return (it.relevance >= CANDIDATE_MIN_RELEVANCE and it.confidence == "high" and not it.is_promotional
            and it.category in CORE_CATEGORIES and it.decision != "skip")


def sync_good_reads(store: Store, feed: str = "engineering", days: int = RETENTION_DAYS) -> dict:
    """Bring the shelf up to date. Items already on the table (in or out) are never touched here, so a veto holds.
    Returns how many were added from your labels and how many by the model."""
    known = store.good_read_states()
    items = load_items(store, feed, days)
    added = {"you": 0, "model": 0}
    for it in items:
        if it.url_key in known or it.decision == "skip" or it.duplicate_of is not None:
            continue
        if it.top_learning:
            store.set_good_read(it.url_key, "in", "you")
            added["you"] += 1
        elif get_mode(store) == AUTOMATIC and is_candidate(it):
            store.set_good_read(it.url_key, "in", "model")
            added["model"] += 1
    return added


def finish_daily_run(store: Store, feed: str = "engineering") -> dict:
    """After `nb daily`: update the shelf, and in automatic mode delete what is past retention."""
    out = {"added": sync_good_reads(store, feed), "purged": 0}
    if get_mode(store) == AUTOMATIC:
        out["purged"] = store.purge_items(RETENTION_DAYS)
    return out
