# Learning loop: from rating every item to a fully automatic feed

Decision (2026-11-02): for the first few runs the reader rates items so the model can learn from them; after a reasonable time the feed becomes fully automatic. This is a **graduated autonomy** plan: autonomy is earned by measured agreement, never switched on by the calendar.

## Phase 1 (now): you rate, the model calibrates

### Morning routine (exact steps; run by hand, indefinitely, until you decide to publish)
Open PowerShell in the `second-brain/` folder of the `my-portfolio` repo, then:

1. **Activate the environment** (once per terminal): `.\.venv\Scripts\Activate.ps1`. The prompt then starts with `(.venv)`. Without it the short `nb` command is not found; `.\.venv\Scripts\nb.exe` works without activating.
2. **`nb daily`**: reads the 24 engineering feeds and triages only what is new (about 2 minutes), writes the digest to `data/out/engineering-<date>.md`, and prints whether learning from your ratings is active. After skipping days use `nb daily --days 5` (the default looks back 3 days; already-seen articles are never repeated). Do **not** use `--refresh` while rating: it re-scores items you have already seen, which makes the measurements jump.
3. **`nb brief`**: starts the private page at http://127.0.0.1:7860 (open it in a browser). For each article choose one of three ratings, or leave it **unrated**:
   - **skip**: not interested (the article disappears from the digest);
   - **good**: useful;
   - **top learning**: deep material in LLM internals, distributed systems, core engineering challenges or AI (it goes to Top picks).
   Tick **Not a vendor announcement** if the model wrongly put a normal article in the vendor section. Press **Save labels** and wait for the "Saved N labels" message. Then press **Ctrl+C** in the terminal to stop the page. To see the new order, start `nb brief` again.
4. **`nb eval`**: shows how closely the model agrees with your ratings and which of the automation gates are met.
5. Optional: read `data/out/engineering-<date>.md`; it follows your ratings (skips are left out, top learning is on top).

Things to know:
- **Rate the dull ones as skip.** The model can only learn what you do not want from skips. Learning stays off until there are at least 3 good-or-top and 3 skip ratings.
- **No fine rating:** there are only three choices on purpose. The scores behind them are skip = 1, good = 3, top learning = 5.
- **Publish and Tag are hidden** during this phase. Anything saved for them earlier is kept untouched when you save. They come back with `nb brief --publish-controls` when you are ready to publish.
- If **Save shows an error**, copy the terminal text. (One was fixed on 2026-11-02: the page's Save ran on a different thread from the database connection. Fixed and tested; if you started the page before that fix, restart it.)
- `nb publish` still exists but publishes nothing until items are marked public, and it never uploads anything.

### What "the model learns" means here
No fine-tuning. Your most recent ratings are shown to the triage model as labelled examples ("this article, you scored it 3, the reader rated it 5"), so its relevance scores and categories move toward your taste. Rules built in:
- **Off until there are at least 3 high (4 to 5) and 3 low (1 to 2) ratings.** Likes alone would make the model rate everything higher.
- The 4 most recent high and 4 most recent low examples are shown.
- An article's **own rating is hidden when that same article is re-triaged** (no leakage into any measurement).
- Example titles are cleaned and truncated and are placed in the user message as data, never in the system prompt: stored titles come from third-party articles and are treated as untrusted.
- Your labels also **override** the model directly in the digest (skip, top learning, not-a-vendor-announcement) regardless of what it scores.

### How we will know it works
- `nb eval` (offline, no model calls): mean gap between the model's relevance and your rating, share within one point, **precision** (of the items the model scores 4 or more, the share you rate 4 or more), **recall** (of your 4-and-5 items, the share the model scores 4 or more), the items the model loved and you did not, and the items you loved and the model buried.
- A proper before-and-after test, not built yet: re-triage the rated items with and without the examples (leaving out each item's own rating) and compare the gap. Needs about 30 ratings. Until then "it learns" is a design, not a result.

### Baseline (2026-11-02): treat as a starting line, not a result
Nine items, **not rated on the page**: their ratings were inferred from the reader's chat comments (the eMudhra analysis = top learning; the eight other confirmed picks = good). After the switch to the three-level scale (skip 1, good 3, top learning 5) `nb eval` reports a mean gap of 0.11, within one point on all 9, precision 1.0 and recall 1.0. **Do not read that as the model matching the reader.** It is an artifact: the "good" items line up with the model's 3s, only one item counts as top learning (and the model happened to score it 4), and all nine are things the reader liked, so false alarms cannot show up. Before the conversion (when I had inferred some items as 4) the same data gave a gap of 0.67 and recall 0.17. The numbers only mean something once the reader has rated a day or more on the page, including skips. Learning from ratings is **not active** yet (no skip ratings). With three levels, "4 or more" in the metrics means **top learning** (and the model's 4 or 5).

## Phase 2 (later): fully automatic

**The gates** (proposed, in `memory/decisions.py`; `nb eval` prints the status):
| Gate | Threshold |
|---|---|
| Enough data | at least 50 rated items |
| Enough time | ratings spread over at least 7 days |
| Closeness | mean gap at most 0.8 points |
| Trust in the model's top picks | precision at least 0.8 |
| Not missing what you love | recall at least 0.7 |
They are written down before any result exists so the decision cannot be bent to fit flattering numbers. Change them deliberately, in writing, not after looking at the numbers.

**What "automatic" would mean** (design, not built):
- The model publishes on its own only items that are relevance 4 or more, high confidence, not promotional, not paywalled, and from a verified source. Everything else stays in the local digest.
- **A review window:** items go public after a delay (for example 24 hours) while a short list is shown to you, so a bad batch can be stopped.
- **A permanent audit sample:** a random share of items (for example 10%) keeps asking for your rating, so drift is detected.
- **A kill switch and an automatic fall-back:** if the rolling gap over your last 20 audit ratings rises above the threshold, the feed returns to manual publishing and tells you.
- **Retract:** unpublishing an item removes it from the feed on the next run.

### Phase 2 as built (2026-11-13): `nb mode automatic`
One switch, off by default (`nb mode status`). `nb mode automatic` is refused unless the gates above pass (an empty history fails them); `--force` overrides on purpose. Turning it on does three things together:
- **The model adds to Good reads** the items with relevance 4 or more, high confidence, a core learning area, not promotional and not skipped. You can remove any of them (`nb brief`, or `nb goodreads remove <key>`); a removal is a veto the model never overrides.
- **A 24-hour hold** keeps a model-added good read out of the public files until it has been on the shelf a day (the review window proposed above).
- **7-day retention:** after each `nb daily`, stored items older than 7 days are deleted, except the shelf and anything you rated (the evaluation and the learning examples read those). Seen URLs are kept, so nothing is fetched and triaged twice. `nb purge --dry-run` counts first. Switching back to manual stops this; it does not bring anything back.
Not built from the list above: the permanent audit sample and the automatic fall-back (kill switch). Until they exist, the veto and the hold are the only brakes.

## Known weaknesses of the learning approach
- Ratings are few at first and mostly positive; the examples switch on late and are a weak signal until there are dozens.
- The model's scale is compressed (most items 3); examples may or may not fix that, and re-triaging changes scores each time (4 of 18 items flipped by a point on an unchanged article in Entry 20), so single measurements are noisy.
- Taste drifts; the examples use the most recent ratings, which helps, but the gates are measured over all ratings.
