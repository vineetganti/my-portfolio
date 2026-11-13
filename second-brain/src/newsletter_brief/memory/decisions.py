"""How well does the model's triage agree with the reader's ratings? Offline: reads stored items and ratings, no model calls.

The gates below are the criteria for moving from "you rate every item" to a fully automatic feed. They are PROPOSED
thresholds, written down before any switch so the decision is not made after seeing flattering numbers.
"""
from newsletter_brief.db.store import Store
from newsletter_brief.memory.semantic import rated_rows

GATE_MIN_RATED = 50
GATE_MIN_DAYS = 7
GATE_MAX_MAE = 0.8  # mean absolute gap between the model's relevance and the reader's rating
GATE_MIN_PRECISION = 0.8  # of items the model scores 4+, the share the reader rates 4+
GATE_MIN_RECALL = 0.7  # of items the reader rates 4+, the share the model scores 4+


def evaluate(store: Store) -> dict:
    rows = rated_rows(store)
    n = len(rows)
    out: dict = {"rated": n, "days": len({r["labeled_at"][:10] for r in rows if r["labeled_at"]})}
    if not n:
        return out | {"gates": {}}
    gaps = [abs(r["relevance"] - r["score"]) for r in rows]
    model_high = [r for r in rows if r["relevance"] >= 4]
    user_high = [r for r in rows if r["score"] >= 4]
    both = [r for r in rows if r["relevance"] >= 4 and r["score"] >= 4]
    out.update(
        mae=round(sum(gaps) / n, 2), within_one=round(sum(g <= 1 for g in gaps) / n, 2),
        precision=round(len(both) / len(model_high), 2) if model_high else None,
        recall=round(len(both) / len(user_high), 2) if user_high else None,
        false_alarms=[r["title"][:60] for r in rows if r["relevance"] >= 4 and r["score"] <= 2],  # model loved it, reader did not
        misses=[r["title"][:60] for r in rows if r["score"] >= 4 and r["relevance"] <= 2],  # reader loved it, model buried it
    )
    out["gates"] = {
        f"at least {GATE_MIN_RATED} rated items": n >= GATE_MIN_RATED,
        f"ratings spread over at least {GATE_MIN_DAYS} days": out["days"] >= GATE_MIN_DAYS,
        f"mean gap at most {GATE_MAX_MAE}": out["mae"] <= GATE_MAX_MAE,
        f"precision at least {GATE_MIN_PRECISION}": (out["precision"] or 0) >= GATE_MIN_PRECISION,
        f"recall at least {GATE_MIN_RECALL}": (out["recall"] or 0) >= GATE_MIN_RECALL,
    }
    return out


def format_report(m: dict) -> str:
    if not m["rated"]:
        return "No rated items yet. Rate items in `nb brief` first."
    lines = [f"rated items: {m['rated']} over {m['days']} day(s)",
             f"model vs you: mean gap {m['mae']} points, within one point on {int(m['within_one'] * 100)}% of items",
             f"model's 4+ picks you also rated 4+ (precision): {m['precision']} | your 4+ items the model also scored 4+ (recall): {m['recall']}"]
    if m["false_alarms"]:
        lines.append("model scored 4+, you rated 2 or less: " + "; ".join(m["false_alarms"]))
    if m["misses"]:
        lines.append("you rated 4+, model scored 2 or less: " + "; ".join(m["misses"]))
    lines.append("gates for going fully automatic (proposed):")
    lines += [f"  [{'x' if ok else ' '}] {name}" for name, ok in m["gates"].items()]
    lines.append("READY to consider automation" if all(m["gates"].values()) else "NOT ready: keep rating")
    return "\n".join(lines)
