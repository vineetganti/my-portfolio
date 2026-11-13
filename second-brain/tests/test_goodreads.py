import json
from datetime import datetime, timedelta, timezone

import pytest

from newsletter_brief.brief.app import save_labels
from newsletter_brief.brief.build import GOOD_READS, buckets, load_good_reads, load_items, render_markdown
from newsletter_brief.brief.goodreads import AUTOMATIC, MANUAL, finish_daily_run, get_mode, is_candidate, set_mode, sync_good_reads
from newsletter_brief.daily import run_feed, url_key
from newsletter_brief.db.store import TIME_FORMAT, Store
from newsletter_brief.publish import sign
from newsletter_brief.publish.feed import public_good_reads, public_items, to_good_reads_json, to_good_reads_rss, to_json_feed, write_public_feed
from newsletter_brief.schemas import TriageItem
from newsletter_brief.sources.registry import Source
from newsletter_brief.sources.rss import FeedEntry

NOW = datetime(2026, 11, 2, 12, 0, tzinfo=timezone.utc)
BODY = "<p>" + "Latency fell by 42 percent after the change. " * 60 + "</p>"
SRC = Source("a", "Blog A", "engineering", "rss", "https://a.dev/feed", section="bigtech")
GOOD = dict(category="distributed_systems", relevance=5, confidence="high")  # clears the automatic bar


def seed(tmp_path, specs):
    store = Store(tmp_path / "t.sqlite")

    def triage(doc):
        s = specs[doc.url.rsplit("/", 1)[-1]]
        return TriageItem(title=doc.title, url=doc.url, type="article", topics=[], summary_2_lines="A grounded summary.", why_it_matters="Because.",
                          relevance=s.get("relevance", 3), is_promotional=s.get("promo", False), confidence=s.get("confidence", "high"),
                          category=s.get("category", "applied_guide"), breakthrough=False, open_source=False, highlight_note="",
                          doc_id=doc.id, source=doc.source_id)

    entries = [FeedEntry(f"Post {slug}", f"https://x.dev/{slug}", NOW - timedelta(days=1), BODY) for slug in specs]
    run_feed(store=store, sources=[SRC], now=NOW, fetch=lambda u: entries, triage=triage, log=lambda m: None, per_source_cap=20)
    return store


def key(slug):
    return url_key(f"https://x.dev/{slug}")


def shelf(store):
    return {r["url_key"]: r["gr_origin"] for r in store.good_reads()}


def sync(store):
    return sync_good_reads(store, days=3650)  # the test items are dated 2026-11-01; the real window is 7 days


def make_old(store, slug, days):
    store.db.execute("UPDATE items SET triaged_at = ? WHERE url_key = ?",
                     ((datetime.now() - timedelta(days=days)).strftime(TIME_FORMAT), key(slug)))
    store.db.commit()


# --- who gets on the shelf -------------------------------------------------------------------------------------------
def test_rating_top_learning_puts_an_article_on_the_shelf_as_you(tmp_path):
    store = seed(tmp_path, {"a1": {}, "b2": {}})
    save_labels(store, [{"url_key": key("a1"), "rating": "top learning"}, {"url_key": key("b2"), "rating": "good"}])
    assert shelf(store) == {key("a1"): "you"}


def test_manual_mode_never_lets_the_model_add_but_automatic_mode_does_with_a_strict_bar(tmp_path):
    store = seed(tmp_path, {"great": GOOD, "promo": dict(GOOD, promo=True), "low": dict(GOOD, relevance=3),
                            "unsure": dict(GOOD, confidence="medium"), "applied": dict(GOOD, category="applied_guide")})
    assert get_mode(store) == MANUAL and sync(store) == {"you": 0, "model": 0} and shelf(store) == {}
    store.set_setting("mode", AUTOMATIC)
    assert sync(store) == {"you": 0, "model": 1}
    assert shelf(store) == {key("great"): "model"}  # promotional, below 4, not high confidence, not a core area: all stay off


def test_a_skipped_article_is_never_a_candidate(tmp_path):
    store = seed(tmp_path, {"great": GOOD})
    store.set_label(key("great"), decision="skip")
    store.set_setting("mode", AUTOMATIC)
    assert sync(store)["model"] == 0
    assert not is_candidate(load_items(store, "engineering", 3650)[0])


# --- the veto ----------------------------------------------------------------------------------------------------------
def test_a_removal_is_a_veto_the_model_and_a_plain_save_cannot_undo_but_you_can(tmp_path):
    store = seed(tmp_path, {"great": GOOD})
    store.set_setting("mode", AUTOMATIC)
    sync(store)
    assert shelf(store) == {key("great"): "model"}
    store.set_good_read(key("great"), "out", "you")  # e.g. `nb goodreads remove`
    sync(store)
    assert shelf(store) == {}  # sticky across the next daily run
    entries = [FeedEntry("Post great", "https://x.dev/great", NOW - timedelta(days=1), BODY)]
    run_feed(store=store, sources=[SRC], now=NOW, fetch=lambda u: entries, refresh=True, log=lambda m: None,
             triage=lambda d: TriageItem(title=d.title, url=d.url, type="article", topics=[], summary_2_lines="x", why_it_matters="y", relevance=5,
                                         is_promotional=False, confidence="high", category="distributed_systems", breakthrough=False,
                                         open_source=False, highlight_note="", doc_id=d.id, source=d.source_id))
    sync(store)
    assert shelf(store) == {}  # ...and across a re-triage
    store.set_label(key("great"), rating=5, decision="approve", top_learning=True)
    save_labels(store, [{"url_key": key("great"), "rating": "top learning"}])  # unchanged top-learning row: Save must not undo the veto
    assert shelf(store) == {}
    save_labels(store, [{"url_key": key("great"), "rating": "good"}])
    save_labels(store, [{"url_key": key("great"), "rating": "top learning"}])  # a deliberate new rating is an explicit add
    assert shelf(store) == {key("great"): "you"}


def test_remove_box_and_lowering_a_rating_take_an_article_off_the_shelf(tmp_path):
    store = seed(tmp_path, {"a1": {}, "b2": {}})
    save_labels(store, [{"url_key": key("a1"), "rating": "top learning"}, {"url_key": key("b2"), "rating": "top learning"}])
    save_labels(store, [{"url_key": key("a1"), "rating": "top learning", "remove_good_read": True}, {"url_key": key("b2"), "rating": "good"}])
    assert shelf(store) == {}


def test_you_are_never_downgraded_to_model_when_re_added(tmp_path):
    store = Store(tmp_path / "t.sqlite")
    store.set_good_read("k", "in", "you")
    store.set_good_read("k", "in", "model")
    assert store.good_read_states()["k"]["origin"] == "you"
    with pytest.raises(ValueError):
        store.set_good_read("k", "maybe", "you")


# --- the digest --------------------------------------------------------------------------------------------------------
def test_a_good_read_is_first_listed_once_and_outlives_the_window(tmp_path):
    store = seed(tmp_path, {"gem": dict(GOOD), "plain": {}})
    save_labels(store, [{"url_key": key("gem"), "rating": "top learning"}])
    items = load_items(store, "engineering", 3, NOW)
    groups = buckets(items)[0]
    assert groups[0][0] == GOOD_READS and [i.title for i in groups[0][1]] == ["Post gem"]
    assert sum(i.title == "Post gem" for _, rows in groups for i in rows) == 1  # once-only still holds
    assert "`GOOD READ (you)`" in render_markdown(items, None, 3, NOW)
    assert load_items(store, "engineering", 1, NOW + timedelta(days=30)) == []  # outside every window...
    assert [i.title for i in load_good_reads(store)] == ["Post gem"]  # ...but still on the shelf


# --- mode and retention ------------------------------------------------------------------------------------------------
def test_automatic_mode_needs_the_gates_unless_forced(tmp_path):
    store = seed(tmp_path, {"a1": {}})
    ok, message = set_mode(store, AUTOMATIC)
    assert not ok and "no ratings yet" in message and get_mode(store) == MANUAL
    ok, message = set_mode(store, AUTOMATIC, force=True)
    assert ok and get_mode(store) == AUTOMATIC and "deleted" in message
    assert set_mode(store, MANUAL)[0] and get_mode(store) == MANUAL
    with pytest.raises(ValueError):
        set_mode(store, "sometimes")


def test_retention_deletes_old_unlabelled_items_but_keeps_the_shelf_and_rated_items(tmp_path):
    specs = {s: {} for s in ("old", "fresh", "shelf", "rated", "vetoed")}
    store = seed(tmp_path, specs)
    for slug in ("old", "shelf", "rated", "vetoed"):
        make_old(store, slug, 8)
    make_old(store, "fresh", 6)
    store.set_good_read(key("shelf"), "in", "you")
    store.set_good_read(key("vetoed"), "out", "you")
    store.set_label(key("rated"), rating=3, decision="approve")
    assert store.purge_items(7, dry_run=True) == 2 and store.db.execute("SELECT COUNT(*) FROM items").fetchone()[0] == 5  # dry run deletes nothing
    assert store.purge_items(7) == 2  # "old" and "vetoed" (a veto lives in its own table and needs no article text)
    left = {r[0] for r in store.db.execute("SELECT url_key FROM items")}
    assert left == {key("fresh"), key("shelf"), key("rated")}
    assert store.good_read_states()[key("vetoed")]["state"] == "out"  # the veto outlives the article
    assert store.seen(key("old"))  # remembered, so the next run does not fetch and triage it again


def test_nothing_is_deleted_in_manual_mode_and_something_is_in_automatic_mode(tmp_path):
    store = seed(tmp_path, {"old": {}})
    make_old(store, "old", 30)
    assert finish_daily_run(store)["purged"] == 0
    store.set_setting("mode", AUTOMATIC)
    assert finish_daily_run(store)["purged"] == 1


# --- what visitors can receive -----------------------------------------------------------------------------------------
def test_public_shelf_holds_model_additions_for_24_hours_and_hides_vetoes_and_skips(tmp_path):
    store = seed(tmp_path, {"mine": {}, "auto": dict(GOOD), "vetoed": {}, "skipme": {}, "plain": {}})
    store.set_good_read(key("mine"), "in", "you")
    store.set_good_read(key("auto"), "in", "model")
    store.set_good_read(key("vetoed"), "out", "you")
    store.set_good_read(key("skipme"), "in", "you")
    store.set_label(key("skipme"), decision="skip")
    shelf_items = load_good_reads(store)
    now = datetime.now()
    assert [i.title for i in public_good_reads(shelf_items, now)] == ["Post mine"]  # "auto" is still in its hold
    later = now + timedelta(hours=25)
    assert {i.title for i in public_good_reads(shelf_items, later)} == {"Post mine", "Post auto"}
    assert "Post vetoed" not in json.dumps(to_good_reads_json(shelf_items, now=later)) and "Post skipme" not in to_good_reads_rss(shelf_items, now=later)


def test_public_files_list_an_article_once_and_carry_no_private_field(tmp_path):
    store = seed(tmp_path, {"gem": dict(GOOD), "daily": {}})
    store.set_label(key("gem"), decision="approve", top_learning=True, publish=True, note="my private note: ask Priya")
    store.set_label(key("daily"), decision="approve", publish=True, tag="raft")
    store.set_good_read(key("gem"), "in", "you")
    items = load_items(store, "engineering", 3, NOW)
    assert [i.title for i in public_items(items)] == ["Post daily"]  # the good read is not repeated in the daily list
    out = tmp_path / "public"
    write_public_feed(items, out, shelf=load_good_reads(store))
    good = json.loads((out / "good-reads.json").read_text(encoding="utf-8"))
    assert good["_schema"] == 1 and good["_count"] == 1 == len(good["items"]) and good["feed_url"].endswith("/second-brain/good-reads.json")
    blob = json.dumps(good) + (out / "good-reads.xml").read_text(encoding="utf-8") + json.dumps(to_json_feed(items))
    for private in ("private note", "Priya", "relevance", "unverified", "url_key", BODY[:30]):
        assert private not in blob
    assert json.loads((out / "feed.json").read_text(encoding="utf-8"))["_count"] == 1


# --- tamper protection -------------------------------------------------------------------------------------------------
def test_a_signed_file_verifies_and_any_change_swap_or_other_key_fails(tmp_path):
    keys, other = tmp_path / "keys", tmp_path / "other"
    sign.generate_keys(keys)
    sign.generate_keys(other)
    with pytest.raises(FileExistsError):
        sign.generate_keys(keys)  # never silently replace the key the site trusts
    good, bad = tmp_path / "good-reads.json", tmp_path / "second.json"
    good.write_text('{"items": ["a"]}', encoding="utf-8")
    bad.write_text('{"items": ["b"]}', encoding="utf-8")
    sign.sign_file(good, keys)
    sign.sign_file(bad, keys)
    assert sign.verify_file(good, keys)
    assert not sign.verify_file(good, other)  # signed by a different key
    original = good.read_bytes()
    good.write_bytes(original.replace(b"a", b"x"))
    assert not sign.verify_file(good, keys)  # one byte changed
    good.write_bytes(bad.read_bytes())
    assert not sign.verify_file(good, keys)  # another genuine file swapped in under the first one's signature
    (tmp_path / "good-reads.json.sig").unlink()
    good.write_bytes(original)
    assert not sign.verify_file(good, keys)  # unsigned


# --- kill switch: status.json ------------------------------------------------------------------------------------------
def test_status_file_defaults_to_enabled_and_can_pause_the_page(tmp_path):
    from newsletter_brief.publish.feed import PUBLIC_FILES, to_status

    store = seed(tmp_path, {"gem": dict(GOOD)})
    store.set_good_read(key("gem"), "in", "you")
    items, shelf_items = load_items(store, "engineering", 3, NOW), load_good_reads(store)
    on, off = tmp_path / "on", tmp_path / "off"
    write_public_feed(items, on, shelf=shelf_items)
    write_public_feed(items, off, shelf=shelf_items, enabled=False, note="x" * 500)
    assert json.loads((on / "status.json").read_text(encoding="utf-8"))["enabled"] is True
    paused = json.loads((off / "status.json").read_text(encoding="utf-8"))
    assert paused["enabled"] is False and paused["_schema"] == 1 and len(paused["note"]) == 200 and paused["_generated_at"]
    assert to_status(True)["enabled"] is True
    assert set(PUBLIC_FILES) == {"feed.json", "feed.xml", "good-reads.json", "good-reads.xml", "status.json"}
    assert all((off / name).exists() for name in PUBLIC_FILES)  # a paused publish still writes every file


def test_every_public_file_including_status_is_signed_and_a_forged_status_fails(tmp_path):
    from newsletter_brief.publish.feed import PUBLIC_FILES

    keys, out = tmp_path / "keys", tmp_path / "public"
    sign.generate_keys(keys)
    store = seed(tmp_path, {"gem": dict(GOOD)})
    write_public_feed(load_items(store, "engineering", 3, NOW), out, shelf=load_good_reads(store))
    for name in PUBLIC_FILES:
        sign.sign_file(out / name, keys)
    assert all(sign.verify_file(out / name, keys) for name in PUBLIC_FILES)
    status = out / "status.json"
    status.write_text(status.read_text(encoding="utf-8").replace("true", "false"), encoding="utf-8")  # someone pauses (or un-pauses) the page
    assert not sign.verify_file(status, keys)
