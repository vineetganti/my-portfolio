from datetime import datetime, timedelta, timezone

from newsletter_brief.brief.build import load_items, render_markdown
from newsletter_brief.daily import run_feed, url_key
from newsletter_brief.db.store import Store
from newsletter_brief.schemas import Document, TriageItem
from newsletter_brief.sources.registry import Source
from newsletter_brief.sources.rss import FeedEntry
from newsletter_brief.summarize.backend import LLMError
from newsletter_brief.summarize.checks import unverified_numbers

NOW = datetime(2026, 11, 2, 12, 0, tzinfo=timezone.utc)
BODY = "<p>" + "Latency fell by 42 percent after the change. " * 60 + "</p>"  # long enough to count as full text
A = Source("a", "Blog A", "engineering", "rss", "https://a.dev/feed", section="bigtech")
B = Source("b", "Blog B", "engineering", "rss", "https://b.dev/feed", section="ai-lab")


def entry(slug, days_old=1, body=BODY, host="x.dev", title=None):
    return FeedEntry(title or f"Post {slug}", f"https://{host}/{slug}", NOW - timedelta(days=days_old), body)


def fake_triage(rel_by_slug=None, number=None):
    def triage(doc: Document):
        slug = doc.url.rsplit("/", 1)[-1]
        summary = "A summary with no figures." + (f" It reports {number} percent." if number else "")
        return TriageItem(title=doc.title, url=doc.url, type="article", topics=["t"], summary_2_lines=summary, why_it_matters="w",
                          relevance=(rel_by_slug or {}).get(slug, 3), is_promotional=False, confidence="high", category="applied_guide", breakthrough=False,
                          open_source=False, highlight_note="", doc_id=doc.id, source=doc.source_id)
    return triage


def run(tmp_path, feeds, **kw):
    store = Store(tmp_path / "t.sqlite")
    return run_feed(store=store, sources=[A, B], now=NOW, fetch=lambda url: feeds[url], log=lambda m: None, **kw), store


def test_window_cap_and_ranking(tmp_path):
    feeds = {A.url: [entry("old", days_old=9), entry("p1", 1), entry("p2", 2), entry("p3", 2)], B.url: [entry("q1", 1)]}
    rep, _ = run(tmp_path, feeds, days=3, per_source_cap=2, triage=fake_triage({"q1": 5, "p1": 1}))
    slugs = [f.item.url.rsplit("/", 1)[-1] for f in rep.ranked()]
    assert "old" not in slugs  # outside the window
    assert len(slugs) == 3 and rep.over_cap == 1  # A had 3 new in window, cap 2
    assert slugs[0] == "q1"  # highest relevance first
    assert rep.entries_in_window == 4


def test_second_run_is_idempotent(tmp_path):
    feeds = {A.url: [entry("p1")], B.url: [entry("q1")]}
    store = Store(tmp_path / "t.sqlite")
    calls = []
    kw = dict(store=store, sources=[A, B], now=NOW, fetch=lambda u: feeds[u], log=lambda m: None,
              triage=lambda d: calls.append(d.id) or fake_triage()(d))
    first = run_feed(**kw)
    second = run_feed(**kw)
    assert len(first.items) == 2 and len(second.items) == 0 and len(calls) == 2 and second.already_seen == 2


def test_skip_decisions_and_retry_rules(tmp_path):
    summary_only = entry("short", body="<p>teaser</p>")
    feeds = {A.url: [summary_only, entry("cut", body="<p>Teaser</p><a>Continue reading on Medium</a>")], B.url: []}
    store = Store(tmp_path / "t.sqlite")
    base = dict(store=store, sources=[A, B], now=NOW, fetch=lambda u: feeds[u], log=lambda m: None, triage=fake_triage())
    rep = run_feed(ensure=lambda d: (None, "blocked"), **base)
    assert rep.skipped["blocked"] == 1 and rep.skipped["paywalled"] == 1
    assert not store.seen(url_key(summary_only.link))  # transient: retried next run
    assert store.seen(url_key("https://x.dev/cut"))  # paywalled: final, not retried
    run_feed(ensure=lambda d: (None, "paywalled"), **base)
    assert store.seen(url_key(summary_only.link))  # a final reason is remembered


def test_model_error_is_not_marked_seen_and_feed_error_does_not_stop_run(tmp_path):
    def boom(doc):
        raise LLMError("rate limited")

    def fetch(url):
        if url == A.url:
            raise RuntimeError("down")
        return [entry("q1", host="b.dev")]

    store = Store(tmp_path / "t.sqlite")
    rep = run_feed(store=store, sources=[A, B], now=NOW, fetch=fetch, triage=boom, log=lambda m: None)
    assert [e[0] for e in rep.feed_errors] == ["a"] and len(rep.llm_errors) == 1 and not store.seen(url_key("https://b.dev/q1"))


def test_numbers_check_duplicates_and_digest(tmp_path):
    feeds = {A.url: [entry("p1", title="Making Failure Diagnosis Reliable")], B.url: [entry("q1", title="Making failure diagnosis reliable!")]}
    rep, store = run(tmp_path, feeds, triage=fake_triage(number=99))
    assert all(f.unverified == ["99"] for f in rep.items)  # 99 is not in the article; 42 is, but was not claimed
    items = load_items(store, "engineering", 3, NOW)
    assert sum(i.duplicate_of is not None for i in items) == 1
    md = render_markdown(items, rep, 3, NOW)
    assert "unverified figure(s) in summary: 99" in md and "model's view" in md
    assert "1 duplicate dropped" in md and md.lower().count("making failure diagnosis reliable") == 1  # dropped, not shown twice
    assert unverified_numbers("cut by 42 percent in 2026-07", "fell 42% since 2026-07-01 and 7 times") == ["7"]


def test_digest_is_a_view_over_stored_items_so_a_rerun_does_not_empty_it(tmp_path):
    feeds = {A.url: [entry("p1"), entry("p2")], B.url: []}
    store = Store(tmp_path / "t.sqlite")
    kw = dict(store=store, sources=[A, B], now=NOW, fetch=lambda u: feeds[u], log=lambda m: None, triage=fake_triage({"p1": 5}))
    first = run_feed(**kw)
    second = run_feed(**kw)  # nothing new: this used to produce an empty digest
    assert len(first.items) == 2 and len(second.items) == 0
    items = load_items(store, "engineering", 3, NOW)
    assert len(items) == 2 and "Post p1" in render_markdown(items, second, 3, NOW)
    assert load_items(store, "engineering", 1, NOW + timedelta(days=5)) == []  # the window still applies


def test_rounding_is_supported_but_conversions_and_date_digits_are_not():
    assert unverified_numbers("speeds 73.3 and 126.9 tokens/s, 105.3 on 2K", "from about 73 to roughly 105-127 tokens/s") == []
    assert unverified_numbers("the offer is $9,800,000", "worth 9.8 million") == ["9.8"]  # unit conversion still flagged
    assert unverified_numbers("cut by 42 percent in 2026-07", "fell 42% and 7 times") == ["7"]
    assert unverified_numbers("a 15.52 gain", "up 15.5 percent") == []


def test_promotional_items_go_to_a_low_priority_section_at_the_end(tmp_path):
    from newsletter_brief.brief.build import to_json

    def promo_triage(doc):
        it = fake_triage()(doc)
        return it.model_copy(update={"is_promotional": doc.url.endswith("/ad")})

    feeds = {A.url: [entry("good"), entry("ad")], B.url: []}
    store = Store(tmp_path / "t.sqlite")
    rep = run_feed(store=store, sources=[A, B], now=NOW, fetch=lambda u: feeds[u], log=lambda m: None, triage=promo_triage)
    items = load_items(store, "engineering", 3, NOW)
    md = render_markdown(items, rep, 3, NOW)
    assert "Post good" in md and "Post ad" in md
    assert md.index("Post ad") > md.index("## Product announcements and vendor news (low priority)") > md.index("Post good")
    rows = {r["title"]: r for r in __import__("json").loads(to_json(items))["items"]}
    assert rows["Post ad"]["low_priority"] is True and rows["Post good"]["low_priority"] is False


def make_item(**kw):
    from newsletter_brief.brief.build import DigestItem

    base = dict(doc_id="d", source_id="a", source_name="Blog A", section="bigtech", title="T", url="https://x.dev/t", published=NOW, relevance=3,
                type="article", summary="S.", why="W.", topics=[], confidence="high", is_promotional=False)
    return DigestItem(**{**base, **kw})


def test_every_article_appears_exactly_once_and_buckets_are_ordered():
    import json as _json
    from newsletter_brief.brief.build import HIGHLIGHTS, LOW_PRIORITY, TOP, buckets, to_json

    items = [
        make_item(doc_id="1", url="https://x.dev/1", title="Breakthrough and top", relevance=5, breakthrough=True, highlight_note="first of its kind"),
        make_item(doc_id="2", url="https://x.dev/2", title="Open source mid", relevance=3, open_source=True, highlight_note="repo released"),
        make_item(doc_id="3", url="https://x.dev/3", title="Distributed systems deep dive", relevance=3, category="distributed_systems"),
        make_item(doc_id="4", url="https://x.dev/4", title="Open source but marginal", relevance=2, open_source=True, section="ai-lab"),
        make_item(doc_id="5", url="https://x.dev/5", title="Plain section item", relevance=3, section="ai-lab"),
        make_item(doc_id="6", url="https://x.dev/6", title="Vendor launch", relevance=5, is_promotional=True, breakthrough=True),
        make_item(doc_id="7", url="https://x.dev/7", title="Applied how-to guide", relevance=4, category="applied_guide"),
    ]
    groups, dropped = buckets(items)
    labels = [g[0] for g in groups]
    assert labels[0] == HIGHLIGHTS and labels[1] == TOP and labels[-1] == LOW_PRIORITY and dropped == 0
    placed = [i.doc_id for _, rows in groups for i in rows]
    assert sorted(placed) == ["1", "2", "3", "4", "5", "6", "7"] and len(placed) == len(set(placed))  # once each
    assert [i.doc_id for i in dict(groups)[HIGHLIGHTS]] == ["1", "2"]  # relevance 2 stays in its section; promotional never highlighted
    assert [i.doc_id for i in dict(groups)[TOP]] == ["3"]  # core area at relevance 3 qualifies; item 1 is not repeated here
    assert "7" not in [i.doc_id for i in dict(groups)[TOP]]  # a good applied guide is not top learning material
    md = render_markdown(items, None, 3, NOW)
    for it in items:
        assert md.count(it.url) == 1
    assert "`BREAKTHROUGH`" in md and "`OPEN SOURCE`" in md and "*Highlight (from the text):* first of its kind" in md
    urls = [r["url"] for r in _json.loads(to_json(items))["items"]]
    assert len(urls) == len(set(urls)) == 7


def test_same_story_is_caught_across_sources_even_with_different_titles_and_urls():
    from newsletter_brief.brief.build import same_story

    a = make_item(doc_id="a", url="https://huggingface.co/blog/nvidia/nemotron-halloween", title="nemotron-halloween",
                  summary="An NVIDIA engineer built MonsterHouse, an interactive Halloween projection where a pirate-ship garage door talks to trick-or-treaters "
                          "using Nemotron ASR, a small LLM with a LoRA adapter, Magpie TTS and Audio2Face on one workstation.")
    b = make_item(doc_id="b", url="https://developer.nvidia.com/blog/monsterhouse-voice-agent", title="Building MonsterHouse with Nemotron",
                  summary="NVIDIA describes MonsterHouse, an interactive Halloween projection of a pirate-ship garage door that talks to trick-or-treaters, built with "
                          "Nemotron ASR, a LoRA-tuned small LLM, Magpie TTS and Audio2Face on a single workstation.")
    c = make_item(doc_id="c", url="https://aws.amazon.com/blogs/x/bedrock-costs", title="Managing Bedrock costs",
                  summary="AWS proposes a five-stage operating model for managing Bedrock spend with budgets, attribution and caching defaults.")
    d = make_item(doc_id="d", url="https://huggingface.co/blog/nemotron-halloween", title="Different words", summary="Unrelated text about kernels.")
    assert same_story(a, b) and not same_story(a, c) and not same_story(b, c)
    assert same_story(a, d)  # same host and same final slug under a different path


# --- archive: old posts from blogs silent for 90+ days -------------------------------------------------------------
OLD = Source("old", "Old Blog", "engineering", "rss", "https://old.dev/feed", section="india")
OLD2 = Source("old2", "Older Blog", "engineering", "rss", "https://old2.dev/feed", section="india")


def archive_run(tmp_path, feeds, now=NOW, store=None, **kw):
    store = store or Store(tmp_path / "t.sqlite")
    base = dict(store=store, sources=[A, OLD, OLD2], now=now, fetch=lambda u: feeds[u], log=lambda m: None, triage=fake_triage())
    return run_feed(**{**base, **kw}), store


def test_a_blog_silent_for_90_days_resurfaces_one_old_post_per_run(tmp_path):
    feeds = {A.url: [entry("p1")],
             OLD.url: [entry("o1", 200, host="old.dev"), entry("o2", 300, host="old.dev")],
             OLD2.url: [entry("q1", 100, host="old2.dev")]}
    rep, store = archive_run(tmp_path, feeds)
    assert sorted(rep.dormant) == ["old", "old2"]
    assert len(rep.archive_picked) == 1  # limited: one per run, not one per dormant blog
    assert len(rep.items) == 2  # the fresh post plus the single archive pick
    picked = [r for r in store.items("engineering", "2000-01-01") if r["section"] == "archive"]
    assert len(picked) == 1 and picked[0]["published"] is not None  # keeps the original date for display


def test_archive_rotates_across_blogs_by_day_and_never_repeats_a_post(tmp_path):
    feeds = {A.url: [], OLD.url: [entry("o1", 200, host="old.dev"), entry("o2", 300, host="old.dev")],
             OLD2.url: [entry("q1", 100, host="old2.dev")]}
    store = Store(tmp_path / "t.sqlite")
    sources_seen = []
    for day in range(4):
        rep, _ = archive_run(tmp_path, feeds, now=NOW + timedelta(days=day), store=store)
        sources_seen += [f.source.id for f in rep.items]
    assert sources_seen.count("old") == 2 and sources_seen.count("old2") == 1  # three posts exist, each used once
    assert len(set(sources_seen)) == 2 and len(sources_seen) == 3  # day 4: pool empty, nothing repeated


def test_an_old_post_the_model_rates_low_is_remembered_and_the_next_source_is_tried(tmp_path):
    feeds = {A.url: [], OLD.url: [entry("o1", 200, host="old.dev")], OLD2.url: [entry("q1", 100, host="old2.dev")]}
    rep, store = archive_run(tmp_path, feeds, triage=fake_triage({"o1": 2, "q1": 2}), archive_tries=3)
    assert rep.archive_picked == [] and rep.skipped["archive_not_worth_it"] == 2  # tries are bounded by the number of sources here
    assert store.seen(url_key("https://old.dev/o1")) and store.seen(url_key("https://old2.dev/q1"))  # not re-triaged tomorrow


def test_archive_can_be_turned_off_and_a_revived_blog_is_not_archived(tmp_path):
    feeds = {A.url: [], OLD.url: [entry("o1", 200, host="old.dev")], OLD2.url: [entry("q1", 2, host="old2.dev")]}
    rep, _ = archive_run(tmp_path, feeds, archive_per_run=0)
    assert rep.archive_picked == [] and rep.dormant == ["old"]  # old2 posted 2 days ago: a normal source again
    assert [f.source.id for f in rep.items] == ["old2"]


def test_archive_pick_has_its_own_section_stays_in_the_window_and_is_not_a_top_pick(tmp_path):
    feeds = {A.url: [], OLD.url: [entry("o1", 400, host="old.dev")], OLD2.url: []}
    rep, store = archive_run(tmp_path, feeds, triage=fake_triage({"o1": 5}))
    items = load_items(store, "engineering", 3, datetime.now(timezone.utc))  # a 3 day window, though the post is 400 days old
    assert len(items) == 1 and items[0].section == "archive"
    md = render_markdown(items, rep, 3, NOW)
    assert "From the archive" in md and "Top picks" not in md  # the model's category must not pull it out of the archive section
    assert "(old, Sep 2025" in md and str((NOW - timedelta(days=400)).year) in md  # the year is shown for an old post
