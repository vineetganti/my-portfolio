"""Private curator: rate articles coarsely (skip, good, top learning), saved to the local database.

Runs on the user's own machine and is never deployed: it holds the controls (and your judgments) that the public site
must not have. Nothing is published from this page. The "Publish on my site" and "Tag" boxes are hidden for now (the user
does not want to fine-rate or tag during the rating phase); existing values are preserved on save, and
`build_app(show_publish_and_tags=True)` brings the boxes back when publishing starts.

The rating is the learning signal: ratings are shown back to the triage model as examples (memory/semantic.py) and compared
with the model's own scores (memory/decisions.py). A rating also sets the layout fields the digest understands:
skip = left out of the digest, good = approved, top learning = approved and forced into Top picks.
"""
from datetime import datetime

from newsletter_brief.brief.build import GOOD_READS, DigestItem, buckets, load_good_reads, load_items
from newsletter_brief.db.store import Store
from newsletter_brief.memory.semantic import user_score

RATING_CHOICES = ["unrated", "skip", "good", "top learning"]
CHOICE_TO_RATING = {"unrated": 0, "skip": 1, "good": 3, "top learning": 5}
RATING_TO_CHOICE = {0: "unrated", 1: "skip", 2: "unrated", 3: "good", 4: "good", 5: "top learning"}  # old 2 and 4 map to the nearest choice
SKIPPED_LABEL = "Skipped by you (change your mind here)"


def rating_value(choice) -> int:
    """'good' -> 3, 'top learning' -> 5, 'skip' -> 1, 'unrated' -> 0; an int passes through (older labels hold 2 or 4)."""
    if isinstance(choice, int):
        return choice
    return CHOICE_TO_RATING.get(choice, 0)


def rating_fields(rating: int) -> dict:
    """What a rating means for the digest layout."""
    return {"decision": {0: "", 1: "skip", 2: ""}.get(rating, "approve"), "top_learning": rating == 5}


def save_labels(store: Store, rows: list[dict]) -> int:
    """rows: {url_key, rating, and optionally not_vendor, publish, tag, remove_good_read}. Fields a row does not carry keep
    their stored value, so hiding a box in the page never wipes what was saved earlier. Returns how many labels were written.

    The shelf follows what you DO, not what is stored: rating an item "top learning" when it was not before puts it on the
    shelf; lowering a top-learning item takes it off; the Remove box takes it off. Saving an unchanged row never touches the
    shelf, so a removal made elsewhere (`nb goodreads remove`) is not undone by pressing Save."""
    existing = store.labels()
    for r in rows:
        old = existing.get(r["url_key"], {})
        rating = rating_value(r["rating"])
        was_top, now_top = bool(old.get("top_learning")), rating == 5
        if r.get("remove_good_read"):
            store.set_good_read(r["url_key"], "out", "you")
        elif now_top and not was_top:
            store.set_good_read(r["url_key"], "in", "you")
        elif was_top and not now_top and store.good_read_states().get(r["url_key"], {}).get("state") == "in":
            store.set_good_read(r["url_key"], "out", "you")
        store.set_label(
            r["url_key"], rating=rating, not_vendor=bool(r.get("not_vendor", old.get("not_vendor", 0))),
            publish=bool(r.get("publish", old.get("publish", 0))), tag=r.get("tag", old.get("tag", "")) or "",
            note=old.get("note", "") or "", origin="ui", **rating_fields(rating))
    return len(rows)


def row_values(store: Store, items: list[DigestItem], widths: list[int], show_publish_and_tags: bool = False) -> list[list]:
    """What each row's boxes should show, read from the database NOW (not when the page was built). One list per row, in
    box order: rating, not-vendor, [publish, tag,] and an unticked Remove box on shelf rows (len(row) == its width)."""
    labels = store.labels()
    out = []
    for it, width in zip(items, widths):
        lab = labels.get(it.url_key, {})
        start = user_score(int(lab.get("rating") or 0), lab.get("decision", "") or "", bool(lab.get("top_learning")))
        v = [RATING_TO_CHOICE.get(start, "unrated"), bool(lab.get("not_vendor"))]
        if show_publish_and_tags:
            v += [bool(lab.get("publish")), lab.get("tag", "") or ""]
        out.append(v + [False] * (width - len(v)))
    return out


def changed_rows(items: list[DigestItem], loaded: list[list], current: list[list], show_publish_and_tags: bool = False) -> list[dict]:
    """The rows whose boxes differ from what the page showed when it loaded, as save_labels rows. Saving only these means
    a page left open (or a second tab) can't write its old values over a newer rating, and an untouched row keeps the time
    you actually rated it, which the learning examples and the 7-day gate depend on."""
    out = []
    for it, before, now in zip(items, loaded, current):
        if list(before) == list(now):
            continue
        row = {"url_key": it.url_key, "rating": now[0], "not_vendor": bool(now[1])}
        if show_publish_and_tags:
            row |= {"publish": bool(now[2]), "tag": now[3] or ""}
        if len(now) > (4 if show_publish_and_tags else 2):  # the Remove box exists only on shelf rows
            row["remove_good_read"] = bool(now[-1])
        out.append(row)
    return out


def _card(it: DigestItem) -> str:
    day = it.published.strftime("%b %d") if it.published else "date unknown"
    badges = " ".join(f"`{b}`" for b, on in (("BREAKTHROUGH", it.breakthrough), ("OPEN SOURCE", it.open_source)) if on)
    return (f"**[model {it.relevance}/5] [{it.title}]({it.url})** {badges}  \n{it.source_name}, {day}, {it.category or it.type}  \n"
            f"{it.summary}  \n*Why it matters (model's view):* {it.why}")


def build_app(store: Store | None = None, feed: str = "engineering", days: int = 3, show_publish_and_tags: bool = False):
    import gradio as gr

    store = store or Store()
    items = load_items(store, feed, days)
    labels = store.labels()
    groups, _ = buckets(items)
    shelf = [i for i in load_good_reads(store) if i.decision != "skip"]  # the whole shelf, not just the window
    groups = ([(GOOD_READS, shelf)] if shelf else []) + [(g, rows) for g, rows in groups if g != GOOD_READS]
    skipped = [i for i in items if i.decision == "skip"]
    ordered = groups + ([(SKIPPED_LABEL, skipped)] if skipped else [])

    with gr.Blocks(title="Curator") as demo:
        gr.Markdown("# Curator (private)\nFor each article choose **skip** (not interested), **good** (useful) or **top learning** (deep "
                    "material in your core areas). Leave it **unrated** if you have no view. Your ratings teach the model your taste and "
                    "measure how well it already matches you. Nothing is published from this page. Press **Save labels** when you are done.")
        rows: list[tuple[DigestItem, list]] = []
        for label, group in ordered:
            gr.Markdown(f"## {label} ({len(group)})")
            for it in group:
                lab = labels.get(it.url_key, {})
                start = user_score(int(lab.get("rating") or 0), it.decision, it.top_learning)
                gr.Markdown(_card(it))
                with gr.Row():
                    rate = gr.Radio(RATING_CHOICES, value=RATING_TO_CHOICE.get(start, "unrated"), label="Your rating")
                    nv = gr.Checkbox(value=bool(lab.get("not_vendor")), label="Not a vendor announcement")
                    comps = [rate, nv]
                    if show_publish_and_tags:
                        comps += [gr.Checkbox(value=it.publish, label="Publish on my site"), gr.Textbox(value=it.tag, label="Tag", max_lines=1)]
                    if label == GOOD_READS:
                        comps.append(gr.Checkbox(value=False, label=f"Remove from Good reads (added by {it.good_read_origin or 'you'})"))
                rows.append((it, comps))
        save = gr.Button("Save labels", variant="primary")
        status = gr.Markdown()
        # What this browser tab showed when it loaded (or last saved). Per tab, so two tabs can't confuse each other.
        loaded = gr.State([])

        page_items = [it for it, _ in rows]
        widths = [len(comps) for _, comps in rows]
        boxes = [c for _, comps in rows for c in comps]

        def split(values) -> list[list]:
            out, pos = [], 0
            for w in widths:
                out.append(list(values[pos:pos + w]))
                pos += w
            return out

        def fresh() -> tuple[list[list], list]:
            vals = row_values(store, page_items, widths, show_publish_and_tags)
            return vals, [v for row in vals for v in row]

        # Fill every box from the database each time the page opens, so a browser refresh shows what is saved,
        # not what was stored when `nb brief` started.
        def on_load():
            vals, flat = fresh()
            return [vals, *flat]

        def on_save(before, *values):
            before = before or fresh()[0]  # Save pressed before the page finished loading: compare with the database
            todo = changed_rows(page_items, before, split(values), show_publish_and_tags)
            n = save_labels(store, todo) if todo else 0
            vals, flat = fresh()
            note = (f"Saved {n} changed label{'s' if n != 1 else ''} at {datetime.now():%H:%M:%S}." if n
                    else "Nothing changed since the page loaded; nothing saved.")
            return [note + " Refreshing the page keeps them; restart `nb brief` to see the new order.", vals, *flat]

        demo.load(on_load, outputs=[loaded, *boxes])
        save.click(on_save, inputs=[loaded, *boxes], outputs=[status, loaded, *boxes])
    return demo
