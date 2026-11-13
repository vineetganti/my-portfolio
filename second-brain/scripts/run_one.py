"""Run ONE cached newsletter through parse -> resolve (network) -> triage (claude -p) and print every step.

    python scripts/run_one.py --sender tldrnewsletter.com --pick 0     # newest TLDR issue
"""
import argparse
import json
import sys
import time
from collections import Counter
from urllib.parse import urlsplit

from newsletter_brief.ingest.gmail_client import load_raw_emails
from newsletter_brief.parse.redirects import Resolver
from newsletter_brief.pipeline import parse_email
from newsletter_brief.summarize.backend import ClaudeCliBackend
from newsletter_brief.summarize.extract import triage_with_audit

if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser()
    ap.add_argument("--sender", required=True, help="substring of the sender address")
    ap.add_argument("--pick", type=int, default=0, help="0 = newest")
    args = ap.parse_args()

    emails = sorted((e for e in load_raw_emails() if args.sender in e.sender_addr), key=lambda e: e.date, reverse=True)
    email = emails[args.pick]
    print(f"[1] picked {args.pick} of {len(emails)} from {email.sender_addr}: {email.subject!r} ({email.date:%Y-%m-%d})")

    t = time.time()
    resolver = Resolver()
    parsed = parse_email(email, resolver)
    print(f"[2] parse+resolve: {len(email.html or '')} html chars -> {len(parsed.body_text)} text chars, {len(parsed.links)} links, "
          f"{resolver.requests_made} network requests, {time.time() - t:.1f}s")
    print("    link hosts:", Counter(urlsplit(l.url).hostname for l in parsed.links).most_common(6))

    backend = ClaudeCliBackend()
    t = time.time()
    items, skipped_by_model = triage_with_audit(parsed, backend=backend)
    usage = json.loads(open(backend_log := __import__("newsletter_brief.config", fromlist=["settings"]).settings.usage_log, encoding="utf-8").readlines()[-1])
    print(f"[3] triage: {len(items)} items in {time.time() - t:.1f}s | model={usage['model']} out_tokens={usage['output_tokens']} cost_usd={usage['cost_usd']:.4f}")
    for i in sorted(items, key=lambda i: -i.relevance):
        flag = " PROMO" if i.is_promotional else ""
        print(f"\n  [{i.relevance}] {i.type:10} conf={i.confidence:6}{flag}\n      {i.title}\n      {i.url}\n      {i.summary_2_lines}\n      why: {i.why_it_matters}\n      topics: {i.topics}")

    reasons = {sk.url: sk.reason for sk in skipped_by_model}
    kept = {i.url for i in items}
    unaccounted = [l for l in parsed.links if l.url not in kept and l.url not in reasons]
    print(f"\n[4] links in email: {len(parsed.links)} | items: {len(items)} | skipped with reason: {len(reasons)} | UNACCOUNTED: {len(unaccounted)}")
    for l in parsed.links:
        if l.url in reasons:
            print(f"      skipped ({reasons[l.url]}): {l.text[:60]!r} -> {urlsplit(l.url).hostname}")
    for l in unaccounted:
        print(f"      UNACCOUNTED: {l.text[:60]!r} -> {urlsplit(l.url).hostname}")
