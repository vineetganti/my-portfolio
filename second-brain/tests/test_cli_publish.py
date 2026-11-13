"""`nb publish`, `nb publish --pause` and `nb health`, run through the real command-line entry point.

The unit tests cover the pieces; these cover the wiring a person actually runs: files written, all five signed, publication
history recorded, a pause that records nothing, and a health run that exits non-zero when the live files are wrong.
"""
import sys
from types import SimpleNamespace

import pytest

import newsletter_brief.config as config
import newsletter_brief.db.store as store_module
from newsletter_brief import cli
from newsletter_brief.publish import health, sign
from newsletter_brief.publish.feed import PUBLIC_FILES
from tests.test_goodreads import GOOD, key, seed


@pytest.fixture
def env(tmp_path, monkeypatch):
    """A seeded database, a key pair and a fake project root, all in tmp_path; the CLI is pointed at them."""
    keys = tmp_path / "keys"
    sign.generate_keys(keys)
    store = seed(tmp_path, {"alpha": dict(GOOD), "daily": {}, "private": {}})
    store.set_good_read(key("alpha"), "in", "you")
    store.set_label(key("daily"), decision="approve", publish=True)
    root = tmp_path / "root"
    root.mkdir()
    monkeypatch.setattr(config, "ROOT", root)
    monkeypatch.setattr(store_module, "settings", SimpleNamespace(db_path=tmp_path / "t.sqlite"))
    monkeypatch.setattr(sign, "KEY_DIR", keys)
    monkeypatch.setenv("SECOND_BRAIN_BASE_URL", "")

    def nb(*argv):
        monkeypatch.setattr(sys, "argv", ["nb", *argv])
        cli.main()

    return SimpleNamespace(nb=nb, store=store, keys=keys, out=root / "data" / "out" / "public", root=root)


def test_publish_writes_signs_and_records_what_it_published(env, capsys):
    env.nb("publish", "--days", "3650")
    assert all((env.out / n).exists() and (env.out / (n + ".sig")).exists() for n in PUBLIC_FILES)
    assert all(sign.verify_file(env.out / n, env.keys) for n in PUBLIC_FILES)
    assert f"signed all {len(PUBLIC_FILES)} files" in capsys.readouterr().out
    log = env.store.published_log()
    assert key("alpha") in log and key("daily") in log and key("private") not in log  # only what a visitor can get
    assert env.store.get_setting("last_publish_at")


def test_a_paused_publish_records_nothing_and_says_so(env, capsys):
    env.nb("publish", "--days", "3650", "--pause", "--note", "Retooling")
    out = capsys.readouterr().out
    assert "PAUSED" in out
    assert '"enabled": false' in (env.out / "status.json").read_text(encoding="utf-8") and sign.verify_file(env.out / "status.json", env.keys)
    assert env.store.published_log() == {}  # a paused page shows nothing, so nothing counts as published


def test_publish_without_a_key_warns_that_the_files_are_unsigned(env, capsys, monkeypatch):
    monkeypatch.setattr(sign, "KEY_DIR", env.keys.parent / "nokeys")
    env.nb("publish", "--days", "3650")
    assert "NOT SIGNED" in capsys.readouterr().out and not (env.out / "feed.json.sig").exists()


def test_health_passes_on_a_good_snapshot_and_exits_nonzero_on_a_tampered_one(env, monkeypatch, capsys):
    env.nb("publish", "--days", "3650")
    base = "https://store.example.com/second-brain"
    monkeypatch.setattr(health, "http_fetch", lambda url: (env.out / url.removeprefix(f"{base}/current/")).read_bytes())
    monkeypatch.setattr(health, "http_page", lambda url: "Post alpha Post daily")
    monkeypatch.setattr(health, "make_link_check", lambda: (lambda url: (200, "x.dev")))
    capsys.readouterr()
    env.nb("health", "--base", base, "--days", "3650")
    out = capsys.readouterr().out
    assert "**Overall:" in out and "FAIL" not in out.split("**Overall:")[1].split("**")[0]
    assert list((env.root / "data" / "out").glob("health-*.md"))  # the report is saved

    path = env.out / "good-reads.json"
    path.write_bytes(path.read_bytes().replace(b"Post alpha", b"Post ALPHA"))
    with pytest.raises(SystemExit) as exc:
        env.nb("health", "--base", base, "--days", "3650", "--no-links")
    assert exc.value.code == 1


def test_health_needs_a_storage_address(env):
    with pytest.raises(SystemExit) as exc:
        env.nb("health")
    assert "SECOND_BRAIN_BASE_URL" in str(exc.value)


def test_signed_files_use_unix_line_endings_on_every_os(env):
    """Regression: on Windows Python turned "\n" into "\r\n", the signature covered the CRLF bytes, and the same files failed
    verification on Linux after git normalised them. The published bytes must be identical everywhere."""
    env.nb("publish", "--days", "3650")
    for name in PUBLIC_FILES:
        for path in (env.out / name, env.out / (name + ".sig")):
            assert b"\r" not in path.read_bytes(), f"{path.name} contains a carriage return"
    assert b"\r" not in (env.keys / sign.PUBLIC_RAW).read_bytes()
    assert all(sign.verify_file(env.out / n, env.keys) for n in PUBLIC_FILES)
