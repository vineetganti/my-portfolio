import json
from datetime import datetime, timedelta, timezone

import pytest

from newsletter_brief.brief.app import build_app, save_labels
from newsletter_brief.brief.build import LOW_PRIORITY, TOP, buckets, load_items, render_markdown
from newsletter_brief.daily import run_feed, url_key
from newsletter_brief.db.store import Store
from newsletter_brief.publish.feed import public_items, to_json_feed, to_rss, write_public_feed
from newsletter_brief.schemas import TriageItem
from newsletter_brief.sources.registry import Source
from newsletter_brief.sources.rss import FeedEntry

NOW = datetime(2026, 11, 2, 12, 0, tzinfo=timezone.utc)
BODY = "<p>" + "Latency fell by 42 percent after the change. " * 60 + "</p>"
SRC = Source("a", "Blog A", "engineering", "rss", "https://a.dev/feed", section="bigtech")


def seed(tmp_path, specs):
    """specs: {slug: dict(category=..., relevance=..., promo=...)} -> a store with those items triaged."""
    store = Store(tmp_path / "t.sqlite")

    def triage(doc):
        s = specs[doc.url.rsplit("/", 1)[-1]]
        return TriageItem(title=doc.title, url=doc.url, type="article", topics=[], summary_2_lines="A grounded summary.", why_it_matters="Because.",
                          relevance=s.get("relevance", 3), is_promotional=s.get("promo", False), confidence="high", category=s.get("category", "applied_guide"),
                          breakthrough=False, open_source=False, highlight_note="", doc_id=doc.id, source=doc.source_id)

    entries = [FeedEntry(f"Post {slug}", f"https://x.dev/{slug}", NOW - timedelta(days=1), BODY) for slug in specs]
    run_feed(store=store, sources=[SRC], now=NOW, fetch=lambda u: entries, triage=triage, log=lambda m: None, per_source_cap=20)
    return store


def key(slug):
    return url_key(f"https://x.dev/{slug}")


def test_label_validation_and_roundtrip(tmp_path):
    store = Store(tmp_path / "t.sqlite")
    with pytest.raises(ValueError):
        store.set_label("k", decision="maybe")
    store.set_label("k", decision="approve", top_learning=True, publish=True, tag=" cuda ")
    lab = store.labels()["k"]
    assert lab["decision"] == "approve" and lab["top_learning"] == 1 and lab["publish"] == 1 and lab["tag"] == "cuda"


def test_user_labels_beat_the_model_and_survive_a_retriage(tmp_path):
    store = seed(tmp_path, {"eng": dict(category="applied_guide"), "vendor": dict(promo=True), "junk": {}})
    store.set_label(key("eng"), decision="approve", top_learning=True)  # e.g. the Cloudflare incident analysis
    store.set_label(key("vendor"), not_vendor=True)  # e.g. NemoClaw: a normal item, not a vendor announcement
    store.set_label(key("junk"), decision="skip")
    items = load_items(store, "engineering", 3, NOW)
    groups = dict(buckets(items)[0])
    assert [i.title for i in groups[TOP]] == ["Post eng"]  # forced into top picks although the model said applied_guide
    assert LOW_PRIORITY not in groups and "Post vendor" in [i.title for g in groups.values() for i in g]  # promo flag overridden
    assert "Post junk" not in [i.title for g in groups.values() for i in g]  # skipped: left out
    md = render_markdown(items, None, 3, NOW)
    assert "`TOP LEARNING`" in md and "`APPROVED`" in md and "1 skipped by you" in md
    # re-triage everything: labels live in their own table, so they are still there
    entries = [FeedEntry(f"Post {s}", f"https://x.dev/{s}", NOW - timedelta(days=1), BODY) for s in ("eng", "vendor", "junk")]
    run_feed(store=store, sources=[SRC], now=NOW, fetch=lambda u: entries, refresh=True, log=lambda m: None,
             triage=lambda d: TriageItem(title=d.title, url=d.url, type="article", topics=[], summary_2_lines="x", why_it_matters="y", relevance=1,
                                         is_promotional=True, confidence="high", category="other", breakthrough=False, open_source=False,
                                         highlight_note="", doc_id=d.id, source=d.source_id))
    again = {i.title: i for i in load_items(store, "engineering", 3, NOW)}
    assert again["Post eng"].top_learning and again["Post junk"].decision == "skip" and not again["Post vendor"].is_promotional


def test_save_labels_from_the_curator_page(tmp_path):
    store = seed(tmp_path, {"a1": {}, "b2": {}})
    n = save_labels(store, [
        {"url_key": key("a1"), "rating": "top learning", "not_vendor": False, "publish": True, "tag": "agents"},
        {"url_key": key("b2"), "rating": "skip", "not_vendor": False, "publish": False, "tag": ""},
    ])
    labels = store.labels()
    assert n == 2 and labels[key("a1")]["publish"] == 1 and labels[key("a1")]["rating"] == 5
    assert labels[key("a1")]["top_learning"] == 1 and labels[key("a1")]["decision"] == "approve"  # rating 5 sets the layout fields
    assert labels[key("b2")]["decision"] == "skip" and labels[key("b2")]["rating"] == 1
    assert build_app(store) is not None  # the page builds from the stored items (not launched here)


def test_public_feed_has_only_published_items_and_no_private_fields(tmp_path):
    store = seed(tmp_path, {"pub": dict(category="distributed_systems"), "private": {}, "skipme": {}})
    store.set_label(key("pub"), decision="approve", publish=True, tag="raft", note="my private note: ask Priya about this")
    store.set_label(key("skipme"), decision="skip", publish=True)  # a skip always wins over publish
    items = load_items(store, "engineering", 3, NOW)
    assert [i.title for i in public_items(items)] == ["Post pub"]
    feed = to_json_feed(items)
    blob = json.dumps(feed) + to_rss(items)
    assert feed["version"].endswith("/1.1") and len(feed["items"]) == 1
    it = feed["items"][0]
    assert it["external_url"] == "https://x.dev/pub" and "raft" in it["tags"] and it["_ai_note"]["label"].startswith("Written by an AI")
    for private in ("private note", "Priya", "relevance", "unverified", "Post private", "Post skipme", BODY[:30]):
        assert private not in blob
    out = tmp_path / "public"
    assert write_public_feed(items, out) == 1 and (out / "feed.json").exists() and (out / "feed.xml").read_text(encoding="utf-8").count("<item>") == 1
