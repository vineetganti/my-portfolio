"""Build the Data Engineering SQL posts from their question specs.

Usage:  python scripts/sql-bank/build.py [post-module ...]     (needs `pip install duckdb`)

Every question's sample tables are created in a fresh DuckDB database, its answer is run there,
and the post shows the real result: the sample input, the expected output and the step-by-step
data trace all come from that run, never from hand-typed tables. A question marked `rerun` has
its answer run a second time to prove it is idempotent, and the build fails if the result moves.

Writes content/blog/<slug>.mdx and content/sql-traces/<slug>.json for each post module
(scripts/sql-bank/posts/*.py).
"""
from __future__ import annotations

import datetime as dt
import decimal
import importlib
import json
import pkgutil
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

import duckdb

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parent))


# ---------------------------------------------------------------- spec types

@dataclass
class Show:
    """A table in a trace step: `query` may return a `_mark` column (keep/new/drop/upd/hit)."""
    name: str
    query: str


@dataclass
class Step:
    label: str
    caption: str
    run: str = ""                      # statements to execute before showing the tables
    tables: list[Show] = field(default_factory=list)
    error: str = ""                    # a statement expected to FAIL; its error is shown


@dataclass
class Q:
    id: str
    title: str
    level: str                         # Easy | Medium | Hard | Expert
    pattern: str
    prompt: str
    setup: str
    answer: str
    explain: str
    check: str
    hint: str = ""
    show: list[str] = field(default_factory=list)      # sample tables shown with the question
    result: str = ""                   # query for the expected output when the answer is DML
    diff: tuple[str, str] | None = None  # (table, key columns) to mark inserted/changed/removed rows
    rerun: bool = False                # run the answer twice and require the same result
    steps: list[Step] | None = None    # custom trace; default is input -> result
    after: str = ""                    # markdown after the explanation (dialect notes, traps)
    trace_alt: str = ""
    expected_title: str = "Expected output"
    show_expected: bool = True
    # Engine-specific SQL shown instead of the runnable answer (it is not run; the runnable
    # answer below it produced the output). Use for Snowflake/BigQuery-only statements.
    display: str = ""
    display_label: str = "Snowflake"


@dataclass
class Group:
    heading: str
    intro: str
    questions: list[Q]


@dataclass
class Post:
    slug: str
    title: str
    description: str
    order: int
    tags: list[str]
    intro: str
    groups: list[Group]
    outro: str
    date: str = "2026-11-03"


# ---------------------------------------------------------------- values

def plain(v):
    """A database value as JSON: numbers stay numbers, decimals keep their scale as text."""
    if v is None or isinstance(v, (bool, int, float, str)):
        if isinstance(v, float):
            return round(v, 4)
        return v
    if isinstance(v, decimal.Decimal):
        return str(v)
    if isinstance(v, (dt.datetime,)):
        return v.strftime("%Y-%m-%d %H:%M") if v.second == 0 else v.strftime("%Y-%m-%d %H:%M:%S")
    if isinstance(v, (dt.date, dt.time)):
        return v.isoformat()
    if isinstance(v, dt.timedelta):
        return str(v)
    if isinstance(v, (list, tuple)):
        return json.dumps([plain(x) for x in v])
    return str(v)


def md_cell(v) -> str:
    v = plain(v)
    if v is None:
        return "*NULL*"
    if isinstance(v, bool):
        return "TRUE" if v else "FALSE"
    s = str(v)
    s = s.replace("|", "\\|").replace("<", "&lt;").replace("{", "\\{").replace("}", "\\}")
    return s if s.strip() else "&nbsp;"


def md_table(cols: list[str], rows: list[tuple]) -> str:
    if not rows:
        return "*(no rows)*"
    out = ["| " + " | ".join(f"`{c}`" for c in cols) + " |", "|" + "---|" * len(cols)]
    for r in rows:
        out.append("| " + " | ".join(md_cell(v) for v in r) + " |")
    return "\n".join(out)


def fetch(con, query: str):
    rel = con.execute(query)
    cols = [d[0] for d in rel.description]
    return cols, rel.fetchall()


def run_script(con, sql: str):
    """Run one or more statements; returns the result of the last one (or None)."""
    stmts = [s for s in split_sql(sql) if s.strip()]
    res = None
    for s in stmts:
        res = con.execute(s)
    return res


def split_sql(sql: str) -> list[str]:
    """Split on semicolons that end a statement (outside quotes and comments)."""
    out, cur, i, q = [], [], 0, None
    while i < len(sql):
        ch = sql[i]
        if q:
            cur.append(ch)
            if ch == q:
                q = None
        elif ch in "'\"":
            q = ch
            cur.append(ch)
        elif sql.startswith("--", i):
            j = sql.find("\n", i)
            j = len(sql) if j < 0 else j
            cur.append(sql[i:j])
            i = j
            continue
        elif ch == ";":
            out.append("".join(cur))
            cur = []
        else:
            cur.append(ch)
        i += 1
    out.append("".join(cur))
    return [s for s in out if re.sub(r"--[^\n]*", "", s).strip()]


def table_json(name: str, cols, rows, marks=None) -> dict:
    t = {"name": name, "columns": list(cols), "rows": [[plain(v) for v in r] for r in rows]}
    if marks and any(marks):
        t["marks"] = marks
    return t


def marked(con, show: Show) -> dict:
    cols, rows = fetch(con, show.query)
    if "_mark" in cols:
        k = cols.index("_mark")
        marks = [r[k] or "" for r in rows]
        cols = [c for i, c in enumerate(cols) if i != k]
        rows = [tuple(v for i, v in enumerate(r) if i != k) for r in rows]
        return table_json(show.name, cols, rows, marks)
    return table_json(show.name, cols, rows)


def diff_table(before, after, keys: list[str]) -> dict:
    """Mark the after-state of a table against its before-state, by key columns."""
    b_cols, b_rows = before
    cols, a_rows = after          # the after-state's columns (the answer may have changed them)
    as_dict = lambda c, r: dict(zip(c, r))
    b = {tuple(as_dict(b_cols, r)[k] for k in keys): as_dict(b_cols, r) for r in b_rows}
    a_keys = set()
    rows, marks = [], []
    for r in a_rows:
        d = as_dict(cols, r)
        k = tuple(d[x] for x in keys)
        a_keys.add(k)
        rows.append(r)
        if k not in b:
            marks.append("new")
        else:
            old = b[k]
            changed = set(cols) != set(b_cols) or any(old[c] != d[c] for c in cols)
            marks.append("upd" if changed else "")
    for k, old in b.items():
        if k not in a_keys:
            rows.append(tuple(old.get(c) for c in cols))
            marks.append("drop")
    return cols, rows, marks


# ---------------------------------------------------------------- one question

def build_question(post: Post, q: Q) -> tuple[str, dict]:
    """Run one question in its own temporary folder, so setup can write files the answer reads."""
    import os
    import tempfile
    here = os.getcwd()
    with tempfile.TemporaryDirectory() as tmp:
        os.chdir(tmp)
        try:
            return _build_question(post, q)
        finally:
            os.chdir(here)


def _build_question(post: Post, q: Q) -> tuple[str, dict]:
    con = duckdb.connect()
    run_script(con, q.setup)
    inputs = {name: fetch(con, f"SELECT * FROM {name}") for name in q.show}

    diff_before = None
    if q.diff:
        diff_before = fetch(con, f"SELECT * FROM {q.diff[0]} ORDER BY ALL")

    # custom steps run against their own fresh database, so they can replay the answer in pieces
    trace_steps = []
    if q.steps:
        tcon = duckdb.connect()
        run_script(tcon, q.setup)
        for st in q.steps:
            tables = []
            if st.run:
                run_script(tcon, st.run)
            if st.error:
                try:
                    run_script(tcon, st.error)
                    raise SystemExit(f"{q.id}: step '{st.label}' was expected to fail but succeeded")
                except duckdb.Error as e:
                    msg = str(e).split("\n")[0]
                    tables.append({"name": "the engine says", "columns": [], "rows": [], "error": msg})
            tables += [marked(tcon, s) for s in st.tables]
            trace_steps.append({"label": st.label, "caption": st.caption, "tables": tables})

    res = run_script(con, q.answer)
    if q.result:
        out_cols, out_rows = fetch(con, q.result)
    elif res is not None and res.description:
        out_cols, out_rows = [d[0] for d in res.description], res.fetchall()
    else:
        out_cols, out_rows = [], []

    if q.rerun:
        run_script(con, q.answer)
        again = fetch(con, q.result) if q.result else None
        if q.result and again != (out_cols, out_rows):
            raise SystemExit(f"{q.id}: running the answer twice changed the result")

    if not trace_steps:
        trace_steps.append({
            "label": "Input",
            "caption": "The sample data before the answer runs.",
            "tables": [table_json(n, *inputs[n]) for n in q.show],
        })
        if q.diff:
            after = fetch(con, f"SELECT * FROM {q.diff[0]} ORDER BY ALL") if not q.rerun else fetch(con, f"SELECT * FROM {q.diff[0]} ORDER BY ALL")
            cols, rows, marks = diff_table(diff_before, after, [k.strip() for k in q.diff[1].split(",")])
            caption = "The table after the answer runs" + (", run twice to prove it is idempotent." if q.rerun else ".")
            trace_steps.append({"label": "After", "caption": caption, "tables": [table_json(q.diff[0], cols, rows, marks)]})
        elif out_cols:
            if "_mark" in out_cols:
                k = out_cols.index("_mark")
                marks = [r[k] or "" for r in out_rows]
                c2 = [c for i, c in enumerate(out_cols) if i != k]
                r2 = [tuple(v for i, v in enumerate(r) if i != k) for r in out_rows]
                trace_steps.append({"label": "Result", "caption": "What the answer returns.", "tables": [table_json("result", c2, r2, marks)]})
            else:
                trace_steps.append({"label": "Result", "caption": "What the answer returns.", "tables": [table_json("result", out_cols, out_rows)]})

    # strip a helper _mark column from the expected output table in the post
    if "_mark" in out_cols:
        k = out_cols.index("_mark")
        out_cols = [c for i, c in enumerate(out_cols) if i != k]
        out_rows = [tuple(v for i, v in enumerate(r) if i != k) for r in out_rows]

    num = int(q.id[1:])
    parts = [f"### Q{num} · {q.title}", "", f"*{q.level} · {q.pattern}*", "", q.prompt.strip(), ""]
    if q.show:
        parts += ["**Sample data**", ""]
        for n in q.show:
            parts += [f"`{n}`", "", md_table(*inputs[n]), ""]
    if q.setup.strip():
        parts += [
            "<details>",
            "<summary>Sample data as SQL (to run it yourself)</summary>",
            "",
            "```sql",
            q.setup.strip(),
            "```",
            "",
            "</details>",
            "",
        ]
    if q.show_expected and out_cols:
        parts += [f"**{q.expected_title}**", "", md_table(out_cols, out_rows), ""]
    if q.hint:
        parts += ["<details>", "<summary>Hint</summary>", "", q.hint.strip(), "", "</details>", ""]
    parts += ["<details className=\"answer\">", "<summary>Answer</summary>", ""]
    if q.display.strip():
        parts += [
            f"In {q.display_label}:",
            "",
            "```sql",
            q.display.strip(),
            "```",
            "",
            "The same logic in portable SQL, as run on DuckDB to produce the output above:",
            "",
        ]
    parts += [
        "```sql",
        q.answer.strip(),
        "```",
        "",
        q.explain.strip(),
        "",
        f'<DataTrace post="{post.slug}" q="{q.id}" />',
        "",
    ]
    if q.after.strip():
        parts += [q.after.strip(), ""]
    parts += [f"**Engineer check.** {q.check.strip()}", "", "</details>", ""]

    alt = q.trace_alt or f"Step-by-step data for Q{num}, {q.title}: the sample tables and what the answer produces."
    return "\n".join(parts), {"alt": alt, "steps": trace_steps}


# ---------------------------------------------------------------- one post

def build_post(post: Post):
    traces, body = {}, []
    for g in post.groups:
        body += [f"## {g.heading}", ""]
        if g.intro.strip():
            body += [g.intro.strip(), ""]
        for q in g.questions:
            md, trace = build_question(post, q)
            body.append(md)
            traces[q.id] = trace
            print(f"  {q.id} ok")
    front = [
        "---",
        f'title: "{post.title}"',
        f'description: "{post.description}"',
        f'date: "{post.date}"',
        'section: "data-engineering"',
        'series: "de-sql"',
        f"seriesOrder: {post.order}",
        "tags: [" + ", ".join(f'"{t}"' for t in post.tags) + "]",
        "---",
        "",
        "{/* Generated by scripts/sql-bank/build.py from scripts/sql-bank/posts. Edit the spec and rebuild. */}",
        "",
    ]
    text = "\n".join(front) + post.intro.strip() + "\n\n" + "\n".join(body) + "\n" + post.outro.strip() + "\n"
    (ROOT / "content/blog" / f"{post.slug}.mdx").write_text(text, encoding="utf-8")
    tdir = ROOT / "content/sql-traces"
    tdir.mkdir(exist_ok=True)
    (tdir / f"{post.slug}.json").write_text(json.dumps(traces, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"{post.slug}: {sum(len(g.questions) for g in post.groups)} questions")


def main():
    import posts  # noqa: F401  (scripts/sql-bank/posts)
    names = sys.argv[1:] or [m.name for m in pkgutil.iter_modules(posts.__path__)]
    for name in names:
        mod = importlib.import_module(f"posts.{name}")
        if hasattr(mod, "POST"):           # posts/common.py holds shared text, not a post
            build_post(mod.POST)


if __name__ == "__main__":
    main()
