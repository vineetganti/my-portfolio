import json
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from urllib.parse import urlsplit

import pytest

from newsletter_brief.brief.build import load_good_reads, load_items
from newsletter_brief.publish import health, sign
from newsletter_brief.publish.feed import PUBLIC_FILES, public_good_reads, public_items, write_public_feed
from tests.test_goodreads import GOOD, NOW, key, seed

BASE = "https://store.example.com/second-brain"
SITE = "https://site.example.com"


@pytest.fixture
def live(tmp_path):
    """A signed snapshot on disk, served by a fake `fetch`, plus the ids a correct publish should have."""
    keys = tmp_path / "keys"
    sign.generate_keys(keys)
    store = seed(tmp_path, {"alpha": dict(GOOD), "beta": dict(GOOD), "daily": {}})
    store.set_good_read(key("alpha"), "in", "you")
    store.set_good_read(key("beta"), "in", "you")
    store.set_label(key("daily"), decision="approve", publish=True)
    items, shelf = load_items(store, "engineering", 3, NOW), load_good_reads(store)
    out = tmp_path / "live"
    write_public_feed(items, out, shelf=shelf, now=NOW)
    for name in PUBLIC_FILES:
        sign.sign_file(out / name, keys)

    good_ids = {i.doc_id for i in public_good_reads(shelf)}
    daily_ids = {i.doc_id for i in public_items(items)}

    def fetch(url):
        return (out / url.removeprefix(f"{BASE}/current/")).read_bytes()

    def run(now=NOW + timedelta(hours=1), **kw):
        args = dict(key_dir=keys, expected_good_ids=good_ids, expected_daily_ids=daily_ids, fetch=fetch, now=now,
                    site_url=SITE, fetch_page=lambda u: "<html>Post alpha Post beta Post daily</html>", link_check=lambda u: (200, urlsplit(u).hostname))
        return health.run_health(BASE, **{**args, **kw})

    return SimpleNamespace(dir=out, key_dir=keys, store=store, good_ids=good_ids, daily_ids=daily_ids, fetch=fetch, run=run)


def levels(findings, check):
    return [f.level for f in findings if f.check == check]


def test_a_correct_snapshot_passes_every_check(live):
    findings = live.run()
    assert health.worst(findings) == "PASS", [(f.level, f.check, f.message) for f in findings if f.level != "PASS"]
    assert {"signature", "freshness", "status", "matches local", "no leaks", "links", "page"} <= {f.check for f in findings}


def test_a_changed_file_fails_the_signature_check_and_the_rest_still_run(live):
    path = live.dir / "good-reads.json"
    path.write_bytes(path.read_bytes().replace(b"Post alpha", b"Post ALPHA"))
    findings = live.run()
    assert "FAIL" in levels(findings, "signature") and health.worst(findings) == "FAIL"
    assert "freshness" in {f.check for f in findings}  # one bad file does not stop the report


def test_an_unfetchable_file_is_a_failure_not_a_crash(live):
    def fetch(url):
        if url.endswith("feed.json"):
            raise OSError("connection reset")
        return live.fetch(url)

    findings = live.run(fetch=fetch)
    assert any(f.level == "FAIL" and f.check == "files" and "feed.json" in f.message for f in findings)


def test_freshness_warns_after_a_day_and_a_half_and_fails_after_a_week(live):
    assert levels(live.run(now=NOW + timedelta(hours=10)), "freshness") == ["PASS"]
    assert levels(live.run(now=NOW + timedelta(hours=40)), "freshness") == ["WARN"]
    assert levels(live.run(now=NOW + timedelta(days=8)), "freshness") == ["FAIL"]


def test_live_items_must_match_what_the_database_says_is_public(live):
    assert levels(live.run(), "matches local") == ["PASS", "PASS"]  # both lists match
    f = [x for x in live.run(expected_good_ids=live.good_ids | {"a:ghost"}) if x.check == "matches local" and x.level == "FAIL"][0]
    assert "1 expected item(s) not live" in f.message  # a forgotten or partial upload is caught
    f = [x for x in live.run(expected_daily_ids=set()) if x.check == "matches local" and x.level == "FAIL"][0]
    assert "1 live item(s) not expected" in f.message  # something is live that the database would not publish


def test_a_private_field_in_a_validly_signed_file_is_a_leak(live):
    path = live.dir / "good-reads.json"
    doc = json.loads(path.read_text(encoding="utf-8"))
    doc["items"][0]["relevance"] = 5  # signed by the right key, but it must never be public
    path.write_text(json.dumps(doc), encoding="utf-8")
    sign.sign_file(path, live.key_dir)
    findings = live.run()
    leak = [f for f in findings if f.check == "no leaks"][0]
    assert leak.level == "FAIL" and "good-reads.json" in leak.message and "private field" in leak.message


# The strings below are FAKE and exist to prove the leak scan catches them; `safety-ignore` tells check-public-safety.mjs so.
@pytest.mark.parametrize("text, why", [('C:\\\\Users\\\\someone\\\\x', "Windows user path"), ("see /Users/someone/code/", "home-directory"),  # safety-ignore
                                       ("-----BEGIN PRIVATE KEY-----", "private key")])  # safety-ignore
def test_paths_and_keys_are_leaks_too(live, text, why):
    path = live.dir / "feed.xml"
    path.write_text(path.read_text(encoding="utf-8") + f"\n<!-- {text} -->", encoding="utf-8")
    sign.sign_file(path, live.key_dir)
    leak = [f for f in live.run() if f.check == "no leaks"][0]
    assert leak.level == "FAIL" and why in leak.message


def test_broken_links_warn_and_moved_links_are_noted(live):
    findings = live.run(link_check=lambda u: (404, "example.com"))
    assert levels(findings, "links") == ["WARN"]
    findings = live.run(link_check=lambda u: (200, "somewhere-else.com"))
    assert levels(findings, "links") == ["PASS", "INFO"]
    findings = live.run(link_check=lambda u: (None, ""))  # no answer at all counts as broken
    assert levels(findings, "links") == ["WARN"]


def test_the_rendered_page_is_checked(live):
    assert levels(live.run(fetch_page=lambda u: "<p>nothing relevant</p>"), "page") == ["WARN"]  # cache may still be old
    assert levels(live.run(fetch_page=lambda u: "<p>Temporarily unavailable</p>"), "page") == ["FAIL"]
    assert levels(live.run(fetch_page=lambda u: "<p>Paused for now.</p>"), "page") == ["INFO"]
    assert levels(live.run(fetch_page=lambda u: "<p>Post alpha</p>"), "page") == ["PASS"]

    def boom(u):
        raise OSError("dns")

    assert levels(live.run(fetch_page=boom), "page") == ["FAIL"]
    assert "page" not in {f.check for f in live.run(fetch_page=None)}  # skipped on request


def test_a_paused_status_is_a_warning_so_it_is_not_forgotten(live):
    paused = live.dir.parent / "paused"
    write_public_feed([], paused, shelf=[], now=NOW, enabled=False, note="Back soon")
    for name in PUBLIC_FILES:
        sign.sign_file(paused / name, live.key_dir)
    findings = live.run(fetch=lambda url: (paused / url.removeprefix(f"{BASE}/current/")).read_bytes(), expected_good_ids=set(), expected_daily_ids=set())
    status = [f for f in findings if f.check == "status"][0]
    assert status.level == "WARN" and "PAUSED" in status.message and "Back soon" in status.message


def test_sign_verify_bytes_rejects_other_keys_and_garbage(tmp_path):
    a, b = tmp_path / "a", tmp_path / "b"
    sign.generate_keys(a)
    sign.generate_keys(b)
    f = tmp_path / "f.txt"
    f.write_bytes(b"hello")
    sig = sign.sign_file(f, a).read_text(encoding="ascii")
    assert sign.verify_bytes(b"hello", sig, a)
    assert not sign.verify_bytes(b"hellp", sig, a) and not sign.verify_bytes(b"hello", sig, b)
    assert not sign.verify_bytes(b"hello", "not base64!!", a) and not sign.verify_bytes(b"hello", "", a)


# --- scorecard ---------------------------------------------------------------------------------------------------------------
def test_scorecard_with_nothing_published(tmp_path):
    store = seed(tmp_path, {"a1": {}})
    assert [f.level for f in health.scorecard(store)] == ["INFO"]


def test_scorecard_counts_retractions_of_recently_published_items(tmp_path):
    specs = {f"p{i}": {} for i in range(10)}
    store = seed(tmp_path, specs)
    keys = [key(s) for s in specs]
    store.record_published(keys)
    assert store.get_setting("last_publish_at")
    for k in keys:
        store.set_good_read(k, "in", "you")
    card = health.scorecard(store)
    assert [f.level for f in card if f.check == "retraction"] == ["PASS"]  # nothing removed yet
    store.set_good_read(keys[0], "out", "you")
    store.set_label(keys[1], decision="skip")  # a skipped item counts as taken back too
    retraction = [f for f in health.scorecard(store) if f.check == "retraction"][0]
    assert retraction.level == "WARN" and "2 of 10" in retraction.message and "20%" in retraction.message
    store.set_good_read(keys[0], "in", "you")
    assert [f.level for f in health.scorecard(store) if f.check == "retraction"] == ["PASS"]  # 1 of 10 = 10%, not above the limit


def test_scorecard_ignores_old_publications_and_warns_when_publishing_stopped(tmp_path):
    store = seed(tmp_path, {"old": {}})
    store.record_published([key("old")])
    long_ago = (datetime.now() - timedelta(days=30)).strftime("%Y-%m-%dT%H:%M:%S")
    store.db.execute("UPDATE published SET first_published_at = ?", (long_ago,))
    store.set_setting("last_publish_at", long_ago)
    store.set_good_read(key("old"), "out", "you")
    card = health.scorecard(store)
    assert not [f for f in card if f.check == "retraction"]  # outside the 14 day window
    assert any(f.level == "WARN" and "last publish 30 day" in f.message for f in card)


def test_report_is_a_table_with_the_overall_level_first(live):
    text = health.format_report(live.run(link_check=lambda u: (404, "x")), datetime(2026, 11, 13, 9, 0))
    assert text.splitlines()[0] == "# Second brain health: 2026-11-13 09:00" and "**Overall: WARN**" in text and "| WARN | links |" in text
    assert health.worst([]) == "PASS" and health.worst([health.Finding("INFO", "x", "y")]) == "INFO"
    assert datetime.now(timezone.utc)  # (keeps the timezone import honest)
