import httpx

from newsletter_brief.daily import run_feed
from newsletter_brief.db.store import Store
from newsletter_brief.sources.pagepoll import extract_article_links, fetch_page_entries
from newsletter_brief.sources.registry import SOURCES, Source, by_feed
from newsletter_brief.sources.rss import FeedEntry

from tests.test_daily import NOW, fake_triage

HTML = """<html><body>
<a href="/blog/a">A</a><a href="/blog/a?utm=x#top">A again</a><a href="https://s.dev/blog/b/">B</a>
<a href="/blog/">listing</a><a href="/blog/topic/ai/page2">deep</a><a href="/about">about</a><a href="https://other.dev/blog/c">other host</a>
</body></html>"""
SRC = Source("s", "Site", "engineering", "page", "https://s.dev/blog/", include=("/blog/",), depth=2)


def test_links_are_filtered_by_prefix_depth_host_and_deduplicated():
    assert extract_article_links(HTML, "https://s.dev/blog/", ("/blog/",), 2) == ["https://s.dev/blog/a", "https://s.dev/blog/b"]
    assert "https://s.dev/blog/topic/ai/page2" in extract_article_links(HTML, "https://s.dev/blog/", ("/blog/",))  # depth 0: any


def test_unchanged_listing_is_a_304_and_an_unfiltered_source_is_refused(tmp_path):
    store = Store(tmp_path / "t.sqlite")

    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(304) if req.headers.get("if-none-match") == '"v1"' else httpx.Response(200, text=HTML, headers={"etag": '"v1"'})

    client = httpx.Client(transport=httpx.MockTransport(handler))
    first = fetch_page_entries(SRC, store, NOW, client)
    assert [e.link for e in first] == ["https://s.dev/blog/a", "https://s.dev/blog/b"] and all(e.date is None for e in first)
    assert fetch_page_entries(SRC, store, NOW, client) == []
    try:
        fetch_page_entries(Source("x", "X", "engineering", "page", "https://x.dev/"), store, NOW, client)
        raise AssertionError("expected ValueError")
    except ValueError as ex:
        assert "include" in str(ex)


def test_page_source_is_new_only_and_goes_through_the_daily_run(tmp_path):
    store = Store(tmp_path / "t.sqlite")
    link = "https://s.dev/blog/a"
    calls: list[str] = []
    kw = dict(store=store, sources=[SRC], now=NOW, days=3, log=lambda m: None, feed="engineering",
              fetch_page=lambda s, st, n: [FeedEntry("", link, None, "")],
              ensure=lambda d: (d.model_copy(update={"body_text": "Real article text. " * 80, "full_text": True, "title": "A"}), "ok"),
              triage=lambda d: calls.append(d.id) or fake_triage()(d))
    assert len(run_feed(**kw).items) == 1
    run_feed(**kw)
    assert len(calls) == 1  # already handled: a dateless page is never treated as updated


def test_registry_page_sources_all_have_include_prefixes_and_a_depth():
    pages = [s for s in SOURCES if s.kind == "page" and s.feed in ("engineering", "science") and s.status in ("verified", "candidate") and s.active]
    assert len(pages) >= 7 and all(s.include and s.depth for s in pages)
    assert {"anthropic", "meta-ai", "linkedin", "uber", "notion", "ibm-quantum", "bps-digest", "tsmc-news"} <= {s.id for s in pages}
    assert {"pragmatic-engineer", "google-quantum-ai", "space-india", "bharat-shakti", "space-com"} <= {s.id for s in SOURCES if s.kind == "rss"}
