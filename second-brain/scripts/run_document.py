"""Run ONE document from any source through fetch -> triage -> polish and fact-check the output.

    python scripts/run_document.py --source netflix --pick 0            # an RSS feed from the registry
    python scripts/run_document.py --source niti --pick 0               # NITI PDF report
    python scripts/run_document.py --source edgar --pick 0              # S-1 filing filtered to energy/tech SIC codes
    python scripts/run_document.py --source openai --pick 0 --fetch-only   # only fetch + show what happened (no LLM)
"""
import argparse
import json
import re
import sys
import time

from newsletter_brief.config import settings
from newsletter_brief.schemas import Document
from newsletter_brief.sources import edgar, niti
from newsletter_brief.sources.article import ensure_full_text
from newsletter_brief.sources.registry import SOURCES
from newsletter_brief.sources.rss import entry_to_document, fetch_entries
from newsletter_brief.summarize.checks import unverified_numbers
from newsletter_brief.summarize.extract import _clip, polish, triage_document

NUM = re.compile(r"\d[\d,]*(?:\.\d+)?")


def norm(text: str) -> str:
    return re.sub(r"\s+", " ", text.lower().replace(",", "")).strip()


ISO = re.compile(r"((?:19|20)\d\d)-(\d\d)(?:-(\d\d))?")
MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"]


def iso_date_in_text(y: str, m: str, d: str | None, hay: str) -> bool:
    name = MONTHS[int(m) - 1]
    if d:
        day = str(int(d))
        pats = [rf"{name[:3]}[a-z]*\.?\s+0?{day}(?:st|nd|rd|th)?,?\s+{y}", rf"0?{day}(?:st|nd|rd|th)?\s+{name[:3]}[a-z]*\.?,?\s+{y}"]
    else:
        pats = [rf"{name[:3]}[a-z]*\.?\s+(?:\d{{1,2}}(?:st|nd|rd|th)?,?\s+)?{y}", rf"\d{{1,2}}\s+{name[:3]}[a-z]*\.?,?\s+{y}"]
    return any(re.search(p, hay) for p in pats)


def fact_check(article: str, label: str, strings: list[str], entities: list[str] = ()) -> None:
    """Numbers, ISO dates and entity names the model wrote must appear in the text it was given.
    Checks only these literal facts; it cannot judge whether a sentence means the right thing."""
    hay = norm(article)
    dates = [(y, m, d) for s in strings for y, m, d in ISO.findall(s)]
    missing_dates = sorted({f"{y}-{m}" + (f"-{d}" if d else "") for y, m, d in dates if not iso_date_in_text(y, m, d or None, hay)})
    stripped = [ISO.sub(" ", s) for s in strings]
    nums = {n.rstrip(".") for s in stripped for n in NUM.findall(s.replace(",", ""))}
    missing_nums = unverified_numbers(article, " ".join(strings))  # whole-token match, shared with the daily run
    names = [re.split(r"\s+\(", e)[0].strip() for e in entities]  # drop "(CEO, NITI Aayog)"-style descriptors
    missing_ents = [n for n in names if norm(n) not in hay]
    print(f"    [{label}] numbers checked={len(nums)} missing={missing_nums or 'none'} | dates checked={len(dates)} missing={missing_dates or 'none'} | entities checked={len(names)} missing={missing_ents or 'none'}")


def load(source_id: str, pick: int) -> Document | None:
    t = time.time()
    if source_id == "niti":
        reports = niti.fetch_reports()
        print(f"[1] NITI listing: {len(reports)} PDFs. Showing pick {pick}: {reports[pick].title!r}")
        doc, why = niti.report_to_document(reports[pick])
        print(f"[2] PDF: {why} ({time.time() - t:.1f}s)")
        return doc
    if source_id == "edgar":
        with edgar.new_client() as client:
            filings = edgar.new_filings(client, "S-1", 40)
            cache = edgar.load_cache()
            focus = []
            for f in filings:
                co = edgar.lookup_company(client, f.cik, cache)
                if edgar.classify(co["sic"]):
                    focus.append((f, co))
            print(f"[1] EDGAR: {len(filings)} new S-1 filings, {len(focus)} in energy/tech SIC codes:")
            for f, co in focus:
                print(f"      {edgar.classify(co['sic']):6} SIC {co['sic']} {co['sic_description'][:34]:34} {f.company}")
            if not focus:
                return None
            f, co = focus[pick]
            doc, why = edgar.filing_to_document(client, f, co)
            print(f"[2] filing document: {why} ({time.time() - t:.1f}s)")
            return doc
    source = next(s for s in SOURCES if s.id == source_id and s.kind == "rss")
    entries = fetch_entries(source.url)
    print(f"[1] {source.name}: {len(entries)} entries in {time.time() - t:.1f}s")
    entry = entries[pick]
    doc = entry_to_document(source, entry)
    if doc is None:
        print(f"[2] entry skipped (paywalled or empty): {entry.title!r}")
        return None
    day = doc.published.strftime("%Y-%m-%d") if doc.published else "?"
    print(f"[2] {doc.title!r} ({day}) feed body -> {len(doc.body_text)} chars, full_text={doc.full_text}")
    if not doc.full_text:
        doc, why = ensure_full_text(doc)
        print(f"    article page fetch: {why}" + (f" -> {len(doc.body_text)} chars" if doc else " (skipped, per the no-paywall rule)"))
    return doc


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", required=True)
    ap.add_argument("--pick", type=int, default=0)
    ap.add_argument("--fetch-only", action="store_true")
    args = ap.parse_args()

    doc = load(args.source, args.pick)
    if doc is None or args.fetch_only:
        sys.exit(0 if args.fetch_only else "nothing to process")
    print(f"    {doc.title!r}\n    {doc.url}\n    {len(doc.body_text)} chars (model sees at most {len(_clip(doc.body_text))})")

    t = time.time()
    item = triage_document(doc)
    print(f"\n[3] triage (haiku, {time.time() - t:.1f}s): relevance={item.relevance} type={item.type} confidence={item.confidence} promo={item.is_promotional}")
    print(f"    {item.summary_2_lines}\n    why: {item.why_it_matters}\n    topics: {item.topics}")
    seen = _clip(doc.body_text)
    fact_check(seen, "triage", [item.summary_2_lines])

    t = time.time()
    note = polish(doc.title, doc.url, doc.body_text)
    print(f"\n[4] polish (haiku, {time.time() - t:.1f}s): confidence={note.confidence}\n    SUMMARY: {note.summary}")
    for k in note.key_takeaways:
        print(f"    - {k}")
    print(f"    ENTITIES: {note.entities}\n    DATES: {note.dates_and_deadlines}\n    IMPLICATIONS: {note.implications}\n    OPEN QUESTIONS: {note.open_questions}\n    TOPICS: {note.topics}")
    fact_check(seen, "polish", [note.summary, *note.key_takeaways, *note.dates_and_deadlines], note.entities)
    log = [json.loads(l) for l in open(settings.usage_log, encoding="utf-8").readlines()[-2:]]
    print("\n[5] usage:", [(l["model"], l["output_tokens"], round(l["cost_usd"], 4), f"{l['duration_ms'] / 1000:.1f}s") for l in log])
