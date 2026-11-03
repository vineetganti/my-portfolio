"""Text shared by every post in the series."""

SERIES = [
    ("de-sql-foundations", "01 · Foundations: DDL, DML and the NULL Traps"),
    ("de-sql-dimensional-warehouse", "02 · ShopWave: Building a Dimensional Warehouse"),
    ("de-sql-medallion-cdc", "03 · NovaBank: Medallion Layers and CDC"),
    ("de-sql-product-analytics", "04 · StreamLoop: Product Analytics Pipelines"),
    ("de-sql-cross-domain", "05 · Hard Problems Across Industries"),
    ("de-sql-capstones", "06 · Capstones: Whole Pipelines in SQL"),
]


def series_callout(current: str) -> str:
    lines = ['<Callout type="note" title="The Data Engineering SQL series">', ""]
    for i, (slug, title) in enumerate(SERIES, 1):
        if slug == current:
            lines.append(f"{i}. **{title}** (this post)")
        else:
            lines.append(f"{i}. [{title}](/blog/{slug})")
    lines += [
        "",
        "A practice bank for the SQL that data engineering actually runs on: modeling, loading, history, "
        "incremental pipelines and data quality. It started as an AI-generated draft. Every answer here was "
        "then run against its sample data on DuckDB, and the draft's wrong answers were fixed "
        "([how the answers are checked](/blog/de-sql-foundations#how-the-answers-are-checked)).",
        "",
        "</Callout>",
    ]
    return "\n".join(lines)


HOW_TO_READ = """
Each question has a difficulty, the pattern it drills, a small sample of data and the expected output. Try it before you open the dropdowns: **Hint** nudges you, and **Answer** has the SQL, a line-by-line explanation and a step-through of the data. The step-through shows the real tables at each stage, with changed rows tinted and labelled: inserted or kept rows in green, removed rows in red, changed rows in amber.
"""
