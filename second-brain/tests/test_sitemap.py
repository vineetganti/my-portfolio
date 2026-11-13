from datetime import datetime, timedelta, timezone

import httpx
import pytest

from newsletter_brief.daily import run_feed, url_key
from newsletter_brief.db.store import Store
from newsletter_brief.sources.registry import SOURCES, Source, by_feed
from newsletter_brief.sources.rss import FeedEntry
from newsletter_brief.sources.sitemap import fetch_sitemap_entries, include_prefixes, parse_sitemap

from tests.test_daily import NOW, fake_triage

URLSET = b"""<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
<url><loc>https://s.dev/news/a</loc><lastmod>2026-11-01</lastmod></url>
<url><loc>https://s.dev/careers/job-1</loc><lastmod>2026-11-01T08:00:00+00:00</lastmod></url>
<url><loc>https://s.dev/news/no-date</loc></url></urlset>"""
INDEX = b"""<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>https://s.dev/a.xml</loc></sitemap></sitemapindex>"""
SRC = Source("s", "Site", "aerospace-defence", "sitemap", "https://s.dev/sitemap.xml", include=("/news/",))


def test_parse_sitemap_reads_dates_with_and_without_a_time_and_refuses_an_index():
    rows = parse_sitemap(URLSET)
    assert [u for u, _ in rows] == ["https://s.dev/news/a", "https://s.dev/careers/job-1", "https://s.dev/news/no-date"]
    assert rows[0][1].date().isoformat() == "2026-11-01" and rows[0][1].tzinfo is not None and rows[2][1] is None
    with pytest.raises(ValueError, match="index"):
        parse_sitemap(INDEX)


def test_year_placeholder_covers_this_and_last_year():
    assert include_prefixes(("/news/{year}/", "/press/"), NOW) == ("/news/2026/", "/news/2025/", "/press/")


def test_only_included_paths_are_returned_and_an_unchanged_sitemap_costs_nothing(tmp_path):
    store = Store(tmp_path / "t.sqlite")
    seen_headers = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen_headers.append(request.headers.get("if-none-match"))
        if request.headers.get("if-none-match") == '"v1"':
            return httpx.Response(304)
        return httpx.Response(200, content=URLSET, headers={"etag": '"v1"'})

    client = httpx.Client(transport=httpx.MockTransport(handler))
    first = fetch_sitemap_entries(SRC, store, NOW, client)
    assert [e.link for e in first] == ["https://s.dev/news/a", "https://s.dev/news/no-date"]  # the careers page is filtered out
    assert fetch_sitemap_entries(SRC, store, NOW, client) == [] and seen_headers == [None, '"v1"']


def watched_run(store, lastmod_days_old, text, triage_calls):
    link = "https://s.dev/news/a"
    entry = FeedEntry("", link, NOW - timedelta(days=lastmod_days_old), "")
    return run_feed(
        store=store, sources=[SRC], now=NOW, days=10, log=lambda m: None, feed="aerospace-defence",
        fetch_sitemap=lambda src, st, now: [entry],
        ensure=lambda d: (d.model_copy(update={"body_text": text, "full_text": True, "title": "Page A"}), "ok"),
        triage=lambda d: triage_calls.append(d.id) or fake_triage()(d),
    )


def test_watched_page_is_only_triaged_when_its_text_really_changed(tmp_path):
    store = Store(tmp_path / "t.sqlite")
    calls: list[str] = []
    assert len(watched_run(store, 5, "Original text. " * 80, calls).items) == 1 and len(calls) == 1  # new
    again = watched_run(store, 5, "Original text. " * 80, calls)  # same lastmod: not even fetched
    assert len(calls) == 1 and again.entries_in_window == 1 and not again.items
    touched = watched_run(store, 2, "Original text. " * 80, calls)  # lastmod moved, text identical: bulk re-save
    assert len(calls) == 1 and touched.skipped["unchanged"] == 1 and touched.updated == 0
    edited = watched_run(store, 1, "Edited text with news. " * 80, calls)  # a real update
    assert len(calls) == 2 and edited.updated == 1
    stored = store.items("aerospace-defence", "2000-01-01")
    assert len(stored) == 1 and stored[0]["title"] == "Page A"  # replaced in place, so the digest still shows it once
    assert store.page_state(url_key("https://s.dev/news/a"))["lastmod"] == (NOW - timedelta(days=1)).isoformat()


def test_transient_failure_on_a_watched_page_is_retried_next_run(tmp_path):
    store = Store(tmp_path / "t.sqlite")
    link = "https://s.dev/news/a"
    kw = dict(store=store, sources=[SRC], now=NOW, days=10, log=lambda m: None, triage=fake_triage(),
              fetch_sitemap=lambda s, st, n: [FeedEntry("", link, NOW - timedelta(days=1), "")])
    run_feed(ensure=lambda d: (None, "blocked"), **kw)
    assert store.page_state(url_key(link)) is None  # nothing recorded, so the next run tries again
    run_feed(ensure=lambda d: (None, "too_short"), **kw)
    assert store.page_state(url_key(link)) is not None  # a final decision is recorded; skipped until the page is updated


def test_aerospace_defence_registry_has_filters_for_every_sitemap_source(tmp_path):
    usable = [s for s in by_feed("aerospace-defence", usable_only=True) if s.kind == "sitemap"]
    assert len(usable) >= 5 and all(s.include for s in usable)  # an unfiltered sitemap would pull whole websites
    assert all(s.kind == "none" for s in by_feed("aerospace-defence") if s.status == "no_feed")
    assert len({s.id for s in SOURCES}) == len(SOURCES)
    with pytest.raises(ValueError, match="include"):
        fetch_sitemap_entries(Source("x", "X", "aerospace-defence", "sitemap", "https://x.dev/s.xml"), Store(tmp_path / "t.sqlite"), NOW)
