"""Check which candidate feeds really exist, parse, and are alive. Polite: one request per feed, 0.5 s apart.

    python scripts/probe_feeds.py            # writes data/cache/feed_probe.json
"""
import json
import sys
import time
from datetime import datetime, timedelta, timezone

import httpx

from newsletter_brief.config import ROOT
from newsletter_brief.sources.engineering_blogs import CANDIDATES
from newsletter_brief.sources.rss import parse_feed

UA = "newsletter-brief/0.1 (personal feed reader)"


def parse_feed_summary(xml_bytes: bytes) -> tuple[str, list[dict]]:
    kind, entries = parse_feed(xml_bytes)
    return kind, [{"title": e.title, "link": e.link, "date": e.date, "body_chars": len(e.body_html)} for e in entries]


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    now = datetime.now(timezone.utc)
    results = []
    with httpx.Client(headers={"User-Agent": UA}, timeout=20, follow_redirects=True) as client:
        for c in CANDIDATES:
            row = {"id": c.id, "name": c.name, "group": c.group, "feed_url": c.feed_url}
            try:
                r = client.get(c.feed_url)
                row.update(status=r.status_code, final_url=str(r.url))
                if r.status_code == 200:
                    kind, entries = parse_feed_summary(r.content)
                    dated = [e["date"] for e in entries if e["date"]]
                    row.update(kind=kind, entries=len(entries), newest=max(dated).date().isoformat() if dated else None,
                               last_30d=sum(1 for d in dated if now - d <= timedelta(days=30)),
                               avg_body_chars=int(sum(e["body_chars"] for e in entries) / max(len(entries), 1)),
                               sample=[e["title"][:70] for e in entries[:2]])
            except Exception as ex:  # keep probing the rest
                row["error"] = f"{type(ex).__name__}: {str(ex)[:80]}"
            results.append(row)
            ok = row.get("status") == 200 and "entries" in row
            print(f"{'OK  ' if ok else 'FAIL'} {c.id:18} " + (f"{row['kind']:4} entries={row['entries']:3} last30d={row['last_30d']:3} newest={row['newest']} body~{row['avg_body_chars']}c" if ok else f"status={row.get('status')} {row.get('error', '')}"))
            time.sleep(0.5)
    out = ROOT / "data" / "cache" / "feed_probe.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(results, indent=2), encoding="utf-8")
    good = sum(1 for r in results if r.get("status") == 200 and "entries" in r)
    print(f"\n{good}/{len(results)} feeds usable; details in {out.relative_to(ROOT)}")
