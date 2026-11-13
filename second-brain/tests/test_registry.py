from newsletter_brief.sources.registry import ENGINEERING_SECTIONS, FEEDS, SOURCES, by_feed


def test_ids_unique_and_feeds_valid():
    ids = [s.id for s in SOURCES]
    assert len(ids) == len(set(ids))
    assert all(s.feed in FEEDS for s in SOURCES)


def test_engineering_sources_have_valid_sections_and_verified_feeds_have_urls():
    eng = by_feed("engineering")
    assert eng and all(s.section in ENGINEERING_SECTIONS for s in eng)
    assert all(s.url.startswith("https://") for s in eng if s.status == "verified")
    assert all(s.kind == "rss" for s in eng if s.status == "verified")


def test_usable_only_excludes_dormant_failed_and_planned():
    usable = {s.id for s in by_feed("engineering", usable_only=True)}
    assert "netflix" in usable and "meta-eng" in usable
    assert not usable & {"dropbox", "slack", "lyft", "instacart"}  # dormant: nothing in 30 days
    assert not usable & {"doordash", "x-blog"}  # blocked: no usable feed
    assert all(s.status != "planned" for s in by_feed("regulation", usable_only=True))
