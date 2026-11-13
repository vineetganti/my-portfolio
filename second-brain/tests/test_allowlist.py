import pytest

from newsletter_brief.ingest.allowlist import DEFAULT_SENDERS, add_sender, list_senders, remove_sender, seed_defaults
from newsletter_brief.ingest.gmail_client import build_query


def test_add_normalizes_dedupes_and_removes(tmp_path):
    db = tmp_path / "t.sqlite"
    add_sender("  Lenny@Substack.com ", "a", db)
    add_sender("lenny@substack.com", "b", db)
    assert list_senders(db) == ["lenny@substack.com"]
    remove_sender("LENNY@substack.com", db)
    assert list_senders(db) == []


def test_seed_is_idempotent(tmp_path):
    db = tmp_path / "t.sqlite"
    seed_defaults(db)
    seed_defaults(db)
    assert sorted(list_senders(db)) == sorted(DEFAULT_SENDERS)


def test_build_query():
    assert build_query("newer_than:1d", ["a@x.com", "b@y.com"]) == "newer_than:1d from:(a@x.com OR b@y.com)"


def test_empty_allowlist_never_fetches_whole_mailbox():
    with pytest.raises(ValueError):
        build_query("newer_than:1d", [])


def test_is_allowed_exact_domain_and_plus_tag():
    from newsletter_brief.ingest.allowlist import is_allowed

    entries = ["lenny@substack.com", "@medium.com", "paul@learnpracticeplay.com"]
    assert is_allowed("Lenny+How-I-AI@substack.com", entries)  # +tag stripped
    assert is_allowed("noreply@medium.com", entries)  # whole domain
    assert is_allowed("paul@learnpracticeplay.com", entries)
    assert not is_allowed("deals@walmart.com", entries)
    assert not is_allowed("paul@evil-learnpracticeplay.com", entries)
