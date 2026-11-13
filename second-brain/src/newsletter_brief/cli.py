import argparse
import re
import sys

from newsletter_brief.ingest import allowlist
from newsletter_brief.ingest.gmail_client import fetch_newsletters, load_raw_emails
from newsletter_brief.parse.redirects import Resolver, resolve_offline
from newsletter_brief.pipeline import parse_email

LONG_URL = re.compile(r"\((https?://[^)\s]{80,})\)")


def _shorten(text: str) -> str:
    """Display only: tracking URLs can be thousands of characters long."""
    return LONG_URL.sub(lambda m: f"({m.group(1)[:70]}...[{len(m.group(1))} chars])", text)


def _fetch(args: argparse.Namespace) -> None:
    if args.offline:
        emails = load_raw_emails()
    else:
        emails = fetch_newsletters(f"newer_than:{args.days}d")
    resolver = resolve_offline if args.no_resolve else Resolver()
    entries = allowlist.list_senders()
    emails = [e for e in emails if allowlist.is_allowed(e.sender_addr, entries)]
    print(f"{len(emails)} newsletter(s)\n")
    for email in emails[: args.limit]:
        parsed = parse_email(email, resolver)
        print("=" * 80)
        print(f"{parsed.sender_addr} | {parsed.subject}")
        print(f"text: {len(parsed.body_text)} chars | links kept: {len(parsed.links)}")
        print(_shorten(parsed.body_text)[: args.chars])
        print("-- links")
        for link in parsed.links[:10]:
            print(f"  {link.text[:60]!r} -> {link.url[:90]}")


def _daily(args: argparse.Namespace) -> None:
    from datetime import date

    from newsletter_brief.brief.build import load_items, render_markdown, to_json
    from newsletter_brief.config import ROOT
    from newsletter_brief.daily import run_feed
    from newsletter_brief.db.store import Store

    store = Store()
    from newsletter_brief.memory.semantic import describe_learning, make_triage

    print(describe_learning(store))
    report = run_feed(args.feed, days=args.days, per_source_cap=args.cap, max_docs=args.max_docs, archive_per_run=args.archive, refresh=args.refresh, store=store,
                      triage=make_triage(store))
    from newsletter_brief.brief.goodreads import finish_daily_run

    after = finish_daily_run(store, args.feed)  # update the shelf; in automatic mode also delete what is past retention
    print(f"good reads added: {after['added']['you']} from your ratings, {after['added']['model']} by the model"
          + (f" | purged {after['purged']} items older than the retention window" if after["purged"] else ""))
    items = load_items(store, args.feed, args.days)  # the digest is a view over everything stored in the window
    out = ROOT / "data" / "out"
    out.mkdir(parents=True, exist_ok=True)
    stem = f"{args.feed}-{date.today().isoformat()}"
    (out / f"{stem}.md").write_text(render_markdown(items, report, args.days), encoding="utf-8")
    (out / f"{stem}.json").write_text(to_json(items, args.feed, args.days), encoding="utf-8")
    print(f"\n{len(items)} articles in the digest ({len(report.items)} newly triaged) in {report.seconds:.0f}s | skipped {dict(report.skipped) or 'none'} | "
          f"model errors {len(report.llm_errors)} | feed errors {report.feed_errors or 'none'} | usage {report.usage}")
    print(f"wrote data/out/{stem}.md and .json")


def _eval(args: argparse.Namespace) -> None:
    from newsletter_brief.db.store import Store
    from newsletter_brief.memory.decisions import evaluate, format_report

    print(format_report(evaluate(Store())))


def _brief(args: argparse.Namespace) -> None:
    from newsletter_brief.brief.app import build_app

    build_app(feed=args.feed, days=args.days, show_publish_and_tags=args.publish_controls).launch(server_name="127.0.0.1", server_port=args.port)  # local only, never deployed


def _publish(args: argparse.Namespace) -> None:
    from newsletter_brief.brief.build import load_items
    from newsletter_brief.config import ROOT
    from newsletter_brief.db.store import Store
    from newsletter_brief.publish.feed import PUBLIC_FILES, public_good_reads, public_items, write_public_feed

    import json

    from newsletter_brief.brief.build import load_good_reads
    from newsletter_brief.brief.goodreads import AUTOMATIC, RETENTION_DAYS, get_mode
    from newsletter_brief.publish import sign

    store = Store()
    days = args.days or (RETENTION_DAYS if get_mode(store) == AUTOMATIC else 30)  # automatic mode keeps nothing older than a week
    out = ROOT / "data" / "out" / "public"
    old_count = None
    if (out / "good-reads.json").exists():
        try:
            old_count = json.loads((out / "good-reads.json").read_text(encoding="utf-8")).get("_count")
        except (ValueError, OSError):
            pass
    items, shelf = load_items(store, args.feed, days), load_good_reads(store)
    n = write_public_feed(items, out, args.site, shelf=shelf, enabled=not args.pause, note=args.note)
    if not args.pause:  # a paused page shows nothing, so nothing counts as published (this feeds the beta's retraction rate)
        store.record_published([i.url_key for i in public_good_reads(shelf)] + [i.url_key for i in public_items(items)])
    new_count = json.loads((out / "good-reads.json").read_text(encoding="utf-8"))["_count"]
    print(f"{n} daily items and {new_count} good reads written to {out.relative_to(ROOT)}. Nothing was uploaded.")
    if args.pause:
        print("PAUSED: status.json says enabled=false. Upload it, and the page shows a pause notice instead of the lists.")
    if old_count and new_count < old_count / 2:
        print(f"WARNING: good reads dropped from {old_count} to {new_count}. Check before you upload.")
    if (sign.KEY_DIR / sign.PRIVATE).exists():
        for name in PUBLIC_FILES:
            sign.sign_file(out / name)
        print(f"signed all {len(PUBLIC_FILES)} files (each has a .sig next to it)")
    else:
        print("NOT SIGNED: run `nb keys init` first. The website must not accept unsigned files.")


def _health(args: argparse.Namespace) -> None:
    import os
    from datetime import datetime

    from newsletter_brief.brief.build import load_good_reads, load_items
    from newsletter_brief.config import ROOT
    from newsletter_brief.db.store import Store
    from newsletter_brief.publish import health
    from newsletter_brief.publish.feed import public_good_reads, public_items

    base = args.base or os.getenv("SECOND_BRAIN_BASE_URL", "")
    if not base:
        raise SystemExit("No storage address: pass --base or set SECOND_BRAIN_BASE_URL (the address `upload-second-brain.mjs` printed).")
    store = Store()
    expected_good = {i.doc_id for i in public_good_reads(load_good_reads(store))}
    expected_daily = {i.doc_id for i in public_items(load_items(store, args.feed, args.days))}
    findings = health.run_health(
        base, expected_good_ids=expected_good, expected_daily_ids=expected_daily, fetch=health.http_fetch, site_url=args.site,
        fetch_page=health.http_page, link_check=None if args.no_links else health.make_link_check())
    findings += health.scorecard(store)
    report = health.format_report(findings)
    out = ROOT / "data" / "out"
    out.mkdir(parents=True, exist_ok=True)
    path = out / f"health-{datetime.now():%Y-%m-%d}.md"
    path.write_text(report, encoding="utf-8")
    print(report)
    print(f"wrote {path.relative_to(ROOT)}")
    if health.worst(findings) == "FAIL":
        raise SystemExit(1)


def _goodreads(args: argparse.Namespace) -> None:
    from newsletter_brief.brief.build import load_good_reads
    from newsletter_brief.daily import url_key
    from newsletter_brief.db.store import Store

    store = Store()
    if args.action == "list":
        rows = load_good_reads(store)
        for i in rows:
            print(f"{i.good_read_added[:10]}  [{i.good_read_origin:5}] {i.title[:70]}\n            {i.url_key}  {i.url}")
        print(f"{len(rows)} good reads")
        return
    key = url_key(args.target) if args.target.startswith("http") else args.target  # a url or the url_key shown by `list`
    if not store.db.execute("SELECT 1 FROM items WHERE url_key = ?", (key,)).fetchone():
        raise SystemExit(f"no stored article with key {key}. Use the url_key from `nb goodreads list` or the article's URL.")
    store.set_good_read(key, "in" if args.action == "add" else "out", "you")
    print(f"{'added to' if args.action == 'add' else 'removed from'} Good reads: {key}")


def _mode(args: argparse.Namespace) -> None:
    from newsletter_brief.brief.goodreads import get_mode, set_mode
    from newsletter_brief.db.store import Store

    store = Store()
    if args.mode == "status":
        print(f"mode: {get_mode(store)}")
        return
    ok, message = set_mode(store, args.mode, force=args.force)
    print(message)
    if not ok:
        raise SystemExit(1)


def _purge(args: argparse.Namespace) -> None:
    from newsletter_brief.brief.goodreads import RETENTION_DAYS
    from newsletter_brief.db.store import Store

    n = Store().purge_items(args.days or RETENTION_DAYS, dry_run=args.dry_run)
    print(f"{'would delete' if args.dry_run else 'deleted'} {n} items stored more than {args.days or RETENTION_DAYS} days ago "
          "(the shelf and items you rated are kept; seen URLs are remembered, so nothing is re-triaged)")


def _keys(args: argparse.Namespace) -> None:
    from newsletter_brief.publish import sign

    folder = sign.generate_keys()
    print(f"keys written to {folder}. Keep private.pem secret and backed up outside the repo; the website needs only public.raw.b64:")
    print((folder / sign.PUBLIC_RAW).read_text(encoding="ascii").strip())


def _allow(args: argparse.Namespace) -> None:
    if args.action == "add":
        allowlist.add_sender(args.addr, args.note)
    elif args.action == "remove":
        allowlist.remove_sender(args.addr)
    print("\n".join(allowlist.list_senders()))


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # Windows consoles default to cp1252
    parser = argparse.ArgumentParser(prog="nb")
    sub = parser.add_subparsers(dest="cmd", required=True)

    fetch = sub.add_parser("fetch", help="fetch + parse allowlisted newsletters, print to terminal")
    fetch.add_argument("--days", type=int, default=1)
    fetch.add_argument("--offline", action="store_true", help="re-parse data/raw/ without calling Gmail")
    fetch.add_argument("--no-resolve", action="store_true", help="skip following tracking redirects (offline unwrapping only)")
    fetch.add_argument("--limit", type=int, default=5, help="max emails to print")
    fetch.add_argument("--chars", type=int, default=1500, help="max text chars per email")
    fetch.set_defaults(func=_fetch)

    daily = sub.add_parser("daily", help="daily run for one feed: fetch sources, triage what is new, write the digest")
    daily.add_argument("--feed", default="engineering")
    daily.add_argument("--days", type=int, default=3, help="only entries from the last N days")
    daily.add_argument("--cap", type=int, default=5, help="max new entries per source per run")
    daily.add_argument("--max-docs", type=int, default=60, help="max documents per run")
    daily.add_argument("--archive", type=int, default=1, help="old posts to resurface per run from blogs silent for 90+ days (0 = none)")
    daily.add_argument("--refresh", action="store_true", help="re-triage items already seen in the window (after a prompt change)")
    daily.set_defaults(func=_daily)

    ev = sub.add_parser("eval", help="how well the model's scores agree with your ratings, and the gates for going automatic")
    ev.set_defaults(func=_eval)

    brief = sub.add_parser("brief", help="open the private curator page (approve / skip / top learning / publish) on localhost")
    brief.add_argument("--feed", default="engineering")
    brief.add_argument("--days", type=int, default=3)
    brief.add_argument("--port", type=int, default=7860)
    brief.add_argument("--publish-controls", action="store_true", help="show the 'Publish on my site' and Tag boxes (hidden during the rating phase)")
    brief.set_defaults(func=_brief)

    publish = sub.add_parser("publish", help="write and sign the public files (daily items you marked public, plus Good reads); uploads nothing")
    publish.add_argument("--feed", default="engineering")
    publish.add_argument("--days", type=int, default=0, help="daily window; default 30, or 7 in automatic mode")
    publish.add_argument("--site", default="https://www.vineetganti.com")
    publish.add_argument("--pause", action="store_true", help="write status.json with enabled=false: after upload the page shows a pause notice")
    publish.add_argument("--note", default="", help="short text shown on the page while paused")
    publish.set_defaults(func=_publish)

    hl = sub.add_parser("health", help="check what is LIVE: signatures, freshness, matches your database, no leaks, links, rendered page")
    hl.add_argument("--base", default="", help="storage address (default: SECOND_BRAIN_BASE_URL)")
    hl.add_argument("--site", default="https://www.vineetganti.com")
    hl.add_argument("--feed", default="engineering")
    hl.add_argument("--days", type=int, default=30, help="daily window used to work out what should be public")
    hl.add_argument("--no-links", action="store_true", help="skip the link check (about one request per link per second)")
    hl.set_defaults(func=_health)

    gr = sub.add_parser("goodreads", help="the Good reads shelf: list it, add an article, or remove one (a removal is a veto the model respects)")
    gr.add_argument("action", choices=["list", "add", "remove"])
    gr.add_argument("target", nargs="?", default="", help="the article's url_key (shown by list) or its URL")
    gr.set_defaults(func=_goodreads)

    mode = sub.add_parser("mode", help="manual (you rate) or automatic (model adds good reads, items older than 7 days are deleted)")
    mode.add_argument("mode", choices=["status", "manual", "automatic"])
    mode.add_argument("--force", action="store_true", help="switch to automatic although the nb eval gates are not met")
    mode.set_defaults(func=_mode)

    purge = sub.add_parser("purge", help="delete stored items past retention (the shelf and your rated items are kept)")
    purge.add_argument("--days", type=int, default=0, help="default 7")
    purge.add_argument("--dry-run", action="store_true", help="count only, delete nothing")
    purge.set_defaults(func=_purge)

    keys = sub.add_parser("keys", help="create the signing key pair for the public files (refuses to overwrite an existing key)")
    keys.add_argument("action", choices=["init"])
    keys.set_defaults(func=_keys)

    allow = sub.add_parser("allow", help="list/add/remove allowlisted senders")
    allow.add_argument("action", choices=["list", "add", "remove"])
    allow.add_argument("addr", nargs="?", default="")
    allow.add_argument("--note", default="")
    allow.set_defaults(func=_allow)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
