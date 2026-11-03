from build import Group, Post, Q, Show, Step
from posts.common import HOW_TO_READ, series_callout

SLUG = "de-sql-dimensional-warehouse"

HASH = "md5(concat_ws('|', coalesce(first_name,'<NULL>'), coalesce(last_name,'<NULL>'), coalesce(email,'<NULL>'), coalesce(city,'<NULL>'), coalesce(state,'<NULL>'), coalesce(country,'<NULL>')))"

DIM_CUSTOMER_DDL = """
CREATE SEQUENCE customer_sk_seq START 1;
CREATE TABLE dim_customer (
    customer_sk INTEGER PRIMARY KEY DEFAULT nextval('customer_sk_seq'),
    customer_code VARCHAR NOT NULL, first_name VARCHAR, last_name VARCHAR, email VARCHAR,
    city VARCHAR, state VARCHAR, country VARCHAR,
    effective_from DATE NOT NULL, effective_to DATE NOT NULL, is_current BOOLEAN NOT NULL,
    row_hash VARCHAR, version INTEGER NOT NULL
);
"""

# ------------------------------------------------------------------ modeling

q16 = Q(
    id="q16",
    title="Declare the grain, then create the fact table",
    level="Easy",
    pattern="Grain and fact DDL",
    prompt="""
ShopWave's sales fact is **one row per order line**. Create `fact_sales` with surrogate foreign keys `date_sk`, `customer_sk`, `product_sk`; the order number and line number as degenerate dimensions; the measures `quantity`, `unit_price`, `discount_amt`, `gross_amount`, `net_amount`; and audit columns `_loaded_at`, `_batch_id`. Make the grain enforceable where the engine allows it.
""",
    setup="",
    answer="""
-- Grain: one row per order line, i.e. per (order_id, line_no).
CREATE TABLE fact_sales (
    date_sk      INTEGER       NOT NULL,   -- FK to dim_date
    customer_sk  INTEGER       NOT NULL,   -- FK to dim_customer (-1 = unknown)
    product_sk   INTEGER       NOT NULL,   -- FK to dim_product  (-1 = unknown)
    order_id     VARCHAR(30)   NOT NULL,   -- degenerate dimension
    line_no      INTEGER       NOT NULL,   -- degenerate dimension
    quantity     INTEGER,
    unit_price   DECIMAL(12,2),
    discount_amt DECIMAL(12,2),
    gross_amount DECIMAL(14,2),
    net_amount   DECIMAL(14,2),
    _loaded_at   TIMESTAMP     DEFAULT current_timestamp,
    _batch_id    VARCHAR(50),
    PRIMARY KEY (order_id, line_no)
);
""",
    show_expected=False,
    hint="Write the grain down first. The primary key should be exactly the columns that identify one row of that grain.",
    explain="""
- **The grain comes first.** "One row per order line" decides every column: measures must be true for one line, and every join and sum has to respect it.
- **Surrogate foreign keys** (`date_sk`, `customer_sk`, `product_sk`) point at dimension rows. They are `NOT NULL` because a missing or unknown key points at the `-1` Unknown member (Q17), never at NULL.
- **Degenerate dimensions** (`order_id`, `line_no`) are identifiers with no dimension table of their own. They keep every fact row traceable to its source line.
- **`gross_amount` and `net_amount` are stored**, not computed at query time, so every report uses the same arithmetic.
- **`PRIMARY KEY (order_id, line_no)`** is the grain written as a constraint. DuckDB and Postgres reject a duplicate, as the step-through shows. Snowflake accepts it silently (it doesn't enforce primary keys), so there the grain is protected by the load logic and the quality gate in Q35.
""",
    steps=[
        Step("Load", "Two lines of order SO-1 load.",
             run="""CREATE TABLE fact_sales (date_sk INTEGER NOT NULL, customer_sk INTEGER NOT NULL, product_sk INTEGER NOT NULL, order_id VARCHAR(30) NOT NULL, line_no INTEGER NOT NULL, quantity INTEGER, unit_price DECIMAL(12,2), discount_amt DECIMAL(12,2), gross_amount DECIMAL(14,2), net_amount DECIMAL(14,2), _loaded_at TIMESTAMP DEFAULT current_timestamp, _batch_id VARCHAR(50), PRIMARY KEY (order_id, line_no));
INSERT INTO fact_sales (date_sk, customer_sk, product_sk, order_id, line_no, quantity, unit_price, discount_amt, gross_amount, net_amount, _batch_id) VALUES (20250301, 1, 10, 'SO-1', 1, 2, 24.99, 0, 49.98, 49.98, 'B1'), (20250301, 1, 11, 'SO-1', 2, 1, 89.00, 10.00, 89.00, 79.00, 'B1');""",
             tables=[Show("fact_sales", "SELECT date_sk, customer_sk, product_sk, order_id, line_no, quantity, net_amount, _batch_id, 'new' AS _mark FROM fact_sales")]),
        Step("Double load", "A retry loads line 1 again. The primary key rejects it here; Snowflake would keep both copies and double the revenue.",
             error="INSERT INTO fact_sales (date_sk, customer_sk, product_sk, order_id, line_no, quantity, unit_price, discount_amt, gross_amount, net_amount, _batch_id) VALUES (20250301, 1, 10, 'SO-1', 1, 2, 24.99, 0, 49.98, 49.98, 'B2')"),
    ],
    trace_alt="Two steps: two order lines load into fact_sales; a retried load of the same line is rejected by the primary key.",
    check="Grain: one row per `(order_id, line_no)`, enforced only on engines that enforce primary keys. Run twice: a plain reload double-counts unless it's a `MERGE` or a delete-and-insert (Q28). NULL: foreign keys are `NOT NULL` by design; unknown means `-1`.",
)

q17 = Q(
    id="q17",
    title="An SCD Type 2 dimension, with an Unknown member",
    level="Easy",
    pattern="SCD2 scaffolding",
    prompt="""
Create `dim_customer` so it can keep history (SCD Type 2): a surrogate key, the natural key `customer_code`, the tracked attributes (`first_name`, `last_name`, `email`, `city`, `state`, `country`), and the columns that make history work. Then insert the **Unknown member**, with surrogate key `-1`, that facts point at when their customer is missing.
""",
    setup="",
    answer=DIM_CUSTOMER_DDL.strip() + """

INSERT INTO dim_customer (customer_sk, customer_code, first_name, last_name, email, city, state, country,
                          effective_from, effective_to, is_current, row_hash, version)
VALUES (-1, 'UNKNOWN', 'Unknown', 'Unknown', NULL, 'Unknown', 'Unknown', 'Unknown',
        DATE '1900-01-01', DATE '9999-12-31', TRUE, 'UNKNOWN', 1);
""",
    result="SELECT customer_sk, customer_code, first_name, city, effective_from, effective_to, is_current, version FROM dim_customer",
    hint="One customer will have several rows over time. What makes each row unique, and what tells you which row was true on a given date?",
    explain="""
- **`customer_sk` is unique per version, not per customer.** When a customer moves, they get a new row and a new surrogate key.
- **`customer_code` is `NOT NULL` but not `UNIQUE`.** It repeats across versions. "This customer today" is `customer_code = … AND is_current`.
- **`effective_from` / `effective_to`** are the validity window of a version. They power point-in-time joins (Q25). `9999-12-31` marks "still valid": a real far-future date keeps range predicates simple, where a NULL end date would need special handling in every join.
- **`is_current`** duplicates what the window says, but makes "the current version" a cheap filter.
- **`row_hash`** fingerprints the tracked attributes, so a load can detect change with one comparison (Q19).
- **`version`** counts changes per customer, which helps when debugging.

**The Unknown member.** Every dimension reserves `-1` for "unknown, not applicable or not yet arrived". A fact whose customer can't be resolved points at `-1` instead of NULL, so inner joins never drop it, totals stay complete, and "Unknown" shows up as a bucket you can monitor. Its window covers all time, so any fact date falls inside it.
""",
    after="On Postgres, an `IDENTITY` column declared `GENERATED ALWAYS` refuses an explicit `-1` unless the insert says `OVERRIDING SYSTEM VALUE`; declaring it `GENERATED BY DEFAULT` avoids that. Snowflake lets you insert an explicit value into an `AUTOINCREMENT` column.",
    check="Grain: one row per customer **version**. Run twice: the Unknown-member insert fails on the primary key the second time; in production it's a `MERGE` or `INSERT … WHERE NOT EXISTS`. NULL: the window uses a sentinel end date instead of NULL so that `BETWEEN` works.",
)

q18 = Q(
    id="q18",
    title="Clean and deduplicate the staging layer",
    level="Medium",
    pattern="Staging and dedup",
    prompt="""
`src_customer` holds repeated CDC pulls with messy formatting. Build `stg_customer` with exactly one row per customer: the latest pull, with names and codes trimmed, `email` lower-cased, `country` upper-cased, and rows without a `customer_code` removed. Add the `row_hash` (Q19's recipe) so later loads can detect change.
""",
    setup="""
CREATE TABLE src_customer (customer_code VARCHAR, first_name VARCHAR, last_name VARCHAR, email VARCHAR,
                           city VARCHAR, state VARCHAR, country VARCHAR, signup_ts TIMESTAMP, updated_at TIMESTAMP);
INSERT INTO src_customer VALUES
    ('C-001', ' Ana ', 'Lopez', 'Ana@Example.com', 'Austin', 'TX', 'us',  TIMESTAMP '2024-11-02 10:00', TIMESTAMP '2025-01-05 09:00'),
    ('C-001', 'Ana',   'Lopez', 'ana@example.com', 'Austin', 'TX', 'US',  TIMESTAMP '2024-11-02 10:00', TIMESTAMP '2025-02-10 09:00'),
    (' C-002', 'Raj',  'Patel', 'RAJ@EXAMPLE.COM', 'Pune',   'MH', ' in', TIMESTAMP '2024-12-01 08:00', TIMESTAMP '2025-01-20 12:00'),
    (NULL,     'Ghost','User',  'ghost@x.com',     NULL,     NULL, 'US',  NULL,                         TIMESTAMP '2025-01-21 12:00'),
    ('C-003', 'Li',    'Wei',   'li@example.com',  'Austin', 'TX', 'US',  TIMESTAMP '2025-01-15 08:30', NULL),
    ('C-003', 'Li',    'Wei',   'li@example.com',  'Dallas', 'TX', 'US',  TIMESTAMP '2025-01-15 08:30', TIMESTAMP '2025-02-01 08:30');
""",
    show=["src_customer"],
    answer=f"""
CREATE OR REPLACE TABLE stg_customer AS
WITH cleaned AS (
    SELECT
        TRIM(customer_code)  AS customer_code,
        TRIM(first_name)     AS first_name,
        TRIM(last_name)      AS last_name,
        LOWER(TRIM(email))   AS email,
        TRIM(city)           AS city,
        TRIM(state)          AS state,
        UPPER(TRIM(country)) AS country,
        signup_ts,
        updated_at
    FROM src_customer
    WHERE NULLIF(TRIM(customer_code), '') IS NOT NULL
    QUALIFY ROW_NUMBER() OVER (PARTITION BY TRIM(customer_code)
                               ORDER BY updated_at DESC NULLS LAST) = 1
)
SELECT *, {HASH} AS row_hash
FROM cleaned;
""",
    result="SELECT customer_code, first_name, email, city, country, updated_at, left(row_hash, 8) || '…' AS row_hash FROM stg_customer ORDER BY customer_code",
    hint="Standardise before you deduplicate, or `' C-002'` and `'C-002'` count as different customers.",
    explain="""
- **Standardise at the staging boundary.** `TRIM`, `LOWER` and `UPPER` make equal things equal, so `' in'` and `'IN'` aren't two countries and `' C-002'` isn't a separate customer.
- **Partition by the cleaned key** (`TRIM(customer_code)`). Deduplicating on the raw key would leave a padded and an unpadded copy of the same customer.
- **`NULLIF(TRIM(customer_code), '') IS NOT NULL`** drops rows you can't key, including blank strings, which `IS NOT NULL` alone would keep. In production these go to a quarantine table rather than vanishing (post 03, Q51).
- **`NULLS LAST`** stops C-003's pull with no timestamp from winning (Q11). C-003's latest real pull says Dallas.
- **`row_hash`** is computed once here so every later load compares one column instead of six.
""",
    steps=[
        Step("Raw", "Six pulls: duplicates, padding, mixed case, a row with no code and a pull with no timestamp.",
             tables=[Show("src_customer", "SELECT customer_code, first_name, email, city, country, updated_at, CASE WHEN customer_code IS NULL THEN 'drop' END AS _mark FROM src_customer")]),
        Step("Ranked", "After cleaning, rows are numbered newest first within each customer. Row 1 wins.",
             tables=[Show("ranked", "SELECT TRIM(customer_code) AS customer_code, TRIM(first_name) AS first_name, LOWER(TRIM(email)) AS email, TRIM(city) AS city, UPPER(TRIM(country)) AS country, updated_at, ROW_NUMBER() OVER (PARTITION BY TRIM(customer_code) ORDER BY updated_at DESC NULLS LAST) AS rn, CASE WHEN ROW_NUMBER() OVER (PARTITION BY TRIM(customer_code) ORDER BY updated_at DESC NULLS LAST) = 1 THEN 'keep' ELSE 'drop' END AS _mark FROM src_customer WHERE NULLIF(TRIM(customer_code), '') IS NOT NULL ORDER BY 1, rn")]),
    ],
    trace_alt="Two steps: the six raw pulls with the keyless row marked for removal; the cleaned rows ranked within each customer, keeping the newest real pull.",
    check="Grain: one row per cleaned `customer_code`. Run twice: `CREATE OR REPLACE` rebuilds the same result. NULL: keyless rows are removed and NULL timestamps sort last.",
)

q19 = Q(
    id="q19",
    title="A change-detection hash that can't be fooled",
    level="Hard",
    pattern="Change detection",
    prompt="""
SCD loads compare a hash of the tracked attributes to decide whether a row changed. The rows below are five **different** attribute pairs. Write a hash expression that gives each a different value, and show how the two obvious approaches, plain concatenation and `concat_ws`, give false matches.
""",
    setup="""
CREATE TABLE pairs (row_id INT, a VARCHAR, b VARCHAR);
INSERT INTO pairs VALUES
    (1, 'AB', 'C'),
    (2, 'A',  'BC'),
    (3, 'X',  NULL),
    (4, NULL, 'X'),
    (5, 'X',  '');
""",
    show=["pairs"],
    answer="""
SELECT
    row_id, a, b,
    md5(concat_ws('|', coalesce(a, '<NULL>'), coalesce(b, '<NULL>'))) AS row_hash
FROM pairs
ORDER BY row_id;
""",
    hint="Two things break naive hashing: values that run into each other, and NULLs. Fix the first with a separator and the second with a placeholder that can't occur in real data.",
    explain="""
- **The separator** stops boundary collisions: plain `a || b` turns both `('AB', 'C')` and `('A', 'BC')` into `'ABC'`. With `'|'` they become `'AB|C'` and `'A|BC'`.
- **The NULL placeholder** is needed for a different reason on each engine:
  - DuckDB and Postgres's `concat_ws` **skips** NULLs, so `('X', NULL)` and `(NULL, 'X')` both become `'X'`. A customer whose city moved into the state column would look unchanged.
  - Snowflake's `concat_ws` and `||` return **NULL** if any argument is NULL ([docs](https://docs.snowflake.com/en/sql-reference/functions/concat_ws)). Every row with any NULL then hashes to NULL, and `NULL <> NULL` is never true, so changes to those rows are never detected.
  - `coalesce(col, '<NULL>')` fixes both, and also keeps NULL apart from the empty string (rows 3 and 5).
- **`md5`** turns the string into a fixed-length fingerprint that's identical on every engine, which matters when you reconcile across systems. Snowflake's `HASH()` is faster but engine-specific.

Choose a separator and a placeholder that can't appear in the data, or hash each column on its own and concatenate the hashes.
""",
    steps=[
        Step("Plain concat", "`a || b`: rows 1 and 2 collide, and any NULL makes the whole value NULL.",
             tables=[Show("a || b", "SELECT row_id, a, b, a || b AS concatenated, CASE WHEN row_id IN (1, 2) THEN 'bad' WHEN a IS NULL OR b IS NULL THEN 'bad' END AS _mark FROM pairs ORDER BY row_id")]),
        Step("concat_ws", "A separator fixes rows 1 and 2, but on DuckDB and Postgres the NULL is skipped, so rows 3 and 4 collide.",
             tables=[Show("concat_ws('|', a, b)", "SELECT row_id, a, b, concat_ws('|', a, b) AS concatenated, CASE WHEN row_id IN (3, 4) THEN 'bad' END AS _mark FROM pairs ORDER BY row_id")]),
        Step("Safe hash", "Separator plus placeholder: five different inputs, five different hashes.",
             tables=[Show("safe", "SELECT row_id, a, b, concat_ws('|', coalesce(a,'<NULL>'), coalesce(b,'<NULL>')) AS concatenated, left(md5(concat_ws('|', coalesce(a,'<NULL>'), coalesce(b,'<NULL>'))), 10) || '…' AS row_hash, 'keep' AS _mark FROM pairs ORDER BY row_id")]),
        Step("Count", "Distinct values each method produces for the five distinct rows.",
             tables=[Show("distinct values", "SELECT count(DISTINCT a || b) AS plain_concat, count(DISTINCT concat_ws('|', a, b)) AS concat_ws_only, count(DISTINCT md5(concat_ws('|', coalesce(a,'<NULL>'), coalesce(b,'<NULL>')))) AS safe_hash FROM pairs")]),
    ],
    trace_alt="Four steps: plain concatenation colliding and nulling; concat_ws colliding when a NULL is skipped; the safe hash giving five different values; a count of distinct values per method, 2, 4 and 5.",
    check="NULL: the whole question is NULL behaviour. Decide what a NULL means in the hash, and make sure it can't equal an empty string or a value shifted between columns.",
)

q20 = Q(
    id="q20",
    title="The first full load of a dimension",
    level="Medium",
    pattern="Surrogate keys and SCD2 seed",
    prompt="""
`dim_customer` holds only the Unknown member. Load every customer from `stg_customer` as version 1, current, valid from their signup date to `9999-12-31`, with surrogate keys assigned by the table and the staged `row_hash`.
""",
    setup=DIM_CUSTOMER_DDL + """
INSERT INTO dim_customer (customer_sk, customer_code, first_name, last_name, email, city, state, country, effective_from, effective_to, is_current, row_hash, version)
VALUES (-1, 'UNKNOWN', 'Unknown', 'Unknown', NULL, 'Unknown', 'Unknown', 'Unknown', DATE '1900-01-01', DATE '9999-12-31', TRUE, 'UNKNOWN', 1);

CREATE TABLE stg_customer (customer_code VARCHAR, first_name VARCHAR, last_name VARCHAR, email VARCHAR, city VARCHAR,
                           state VARCHAR, country VARCHAR, signup_ts TIMESTAMP, row_hash VARCHAR);
INSERT INTO stg_customer VALUES
    ('C-001', 'Ana', 'Lopez', 'ana@example.com', 'Austin', 'TX', 'US', TIMESTAMP '2024-11-02 10:00', 'h-c001-a'),
    ('C-002', 'Raj', 'Patel', 'raj@example.com', 'Pune',   'MH', 'IN', TIMESTAMP '2024-12-01 08:00', 'h-c002-a'),
    ('C-003', 'Li',  'Wei',   'li@example.com',  'Dallas', 'TX', 'US', NULL,                         'h-c003-a');
""",
    show=["stg_customer"],
    answer="""
INSERT INTO dim_customer (customer_code, first_name, last_name, email, city, state, country,
                          effective_from, effective_to, is_current, row_hash, version)
SELECT
    s.customer_code, s.first_name, s.last_name, s.email, s.city, s.state, s.country,
    COALESCE(CAST(s.signup_ts AS DATE), DATE '2025-03-01') AS effective_from,  -- load date if unknown
    DATE '9999-12-31',
    TRUE,
    s.row_hash,
    1
FROM stg_customer s
WHERE NOT EXISTS (SELECT 1 FROM dim_customer d WHERE d.customer_code = s.customer_code);
""",
    result="SELECT customer_sk, customer_code, city, effective_from, effective_to, is_current, version FROM dim_customer ORDER BY customer_sk",
    diff=("dim_customer", "customer_sk"),
    rerun=True,
    hint="Leave the surrogate key out of the column list. And make the load harmless if it runs on a non-empty table.",
    explain="""
- **No `customer_sk` in the column list**, so the sequence default numbers each new row. The Unknown member keeps its `-1`.
- **`effective_from`** starts each customer's history at signup; C-003 has no signup time, so it falls back to the load date. History before the warehouse existed is unknowable, and a date is still better than a NULL that breaks range joins.
- **`9999-12-31`, `is_current = TRUE`, `version = 1`**: every customer starts as their own first, open, current version.
- **`WHERE NOT EXISTS`** is the guard that makes the "first load" safe to re-run: the build ran it twice and the second run inserted nothing. A seed load that can double a dimension is a real incident waiting to happen; ongoing loads are SCD2 (Q22).
""",
    check="Grain: one current version per customer. Run twice: no change, verified. NULL: a missing signup time gets the load date, never a NULL window start.",
)

q21 = Q(
    id="q21",
    title="SCD Type 1: overwrite in place",
    level="Medium",
    pattern="SCD1 with MERGE",
    prompt="""
Product corrections (a fixed price, a renamed brand) need no history: the current row is simply overwritten (Type 1). Apply `stg_product` to `dim_product`, updating changed products and inserting new ones, without rewriting products that didn't change.
""",
    setup="""
CREATE SEQUENCE product_sk_seq START 100;
CREATE TABLE dim_product (product_sk INTEGER PRIMARY KEY DEFAULT nextval('product_sk_seq'), product_code VARCHAR NOT NULL,
                          product_name VARCHAR, category VARCHAR, list_price DECIMAL(10,2),
                          effective_from DATE, effective_to DATE, is_current BOOLEAN, version INTEGER);
INSERT INTO dim_product (product_code, product_name, category, list_price, effective_from, effective_to, is_current, version) VALUES
    ('SKU-001', 'Wireless Mouse', 'Accessories', 24.99, DATE '2025-01-01', DATE '9999-12-31', TRUE, 1),
    ('SKU-002', 'Keyboard',       'Accessories', 98.00, DATE '2025-01-01', DATE '9999-12-31', TRUE, 1);

CREATE TABLE stg_product (product_code VARCHAR, product_name VARCHAR, category VARCHAR, list_price DECIMAL(10,2));
INSERT INTO stg_product VALUES
    ('SKU-001', 'Wireless Mouse',      'Accessories', 24.99),   -- unchanged
    ('SKU-002', 'Mechanical Keyboard', 'Accessories', 89.00),   -- corrected name and price
    ('SKU-003', 'USB Hub',             'Accessories', 19.00);   -- new
""",
    show=["dim_product", "stg_product"],
    answer="""
MERGE INTO dim_product t
USING stg_product s
   ON t.product_code = s.product_code AND t.is_current
WHEN MATCHED AND (t.product_name IS DISTINCT FROM s.product_name
               OR t.category     IS DISTINCT FROM s.category
               OR t.list_price   IS DISTINCT FROM s.list_price) THEN UPDATE SET
    product_name = s.product_name,
    category     = s.category,
    list_price   = s.list_price
WHEN NOT MATCHED THEN INSERT
    (product_code, product_name, category, list_price, effective_from, effective_to, is_current, version)
    VALUES (s.product_code, s.product_name, s.category, s.list_price, DATE '2025-03-01', DATE '9999-12-31', TRUE, 1);
""",
    result="SELECT product_sk, product_code, product_name, list_price, is_current, version FROM dim_product ORDER BY product_sk",
    diff=("dim_product", "product_sk"),
    rerun=True,
    hint="A plain `WHEN MATCHED THEN UPDATE` rewrites every matched row, changed or not. Add a condition to the matched branch.",
    explain="""
- **`ON … AND t.is_current`** matches each staged product to its current row, so the same `MERGE` stays correct once the table also holds Type 2 history.
- **`WHEN MATCHED AND (… IS DISTINCT FROM …)`** updates only rows that actually changed. Without the condition, SKU-001 would be rewritten with identical values every night: wasted writes, misleading "last modified" audit columns, and on Snowflake rewritten micro-partitions that cost storage and Time Travel space. `IS DISTINCT FROM` is the NULL-safe comparison (Q12), so a change from NULL to a value is caught.
- **Type 1 means the old value is gone.** The keyboard's old price of 98.00 can't be recovered. That's right for corrections and wrong for anything analysts slice history by; those attributes need Type 2 (Q22).
- `WHEN NOT MATCHED THEN INSERT` adds SKU-003 as a new current product.
""",
    check="Grain: one current row per product. Run twice: verified unchanged. NULL: `IS DISTINCT FROM` catches changes to and from NULL that `<>` would miss.",
)

q22 = Q(
    id="q22",
    title="SCD Type 2: expire, then insert",
    level="Hard",
    pattern="SCD2",
    prompt="""
Customers move, and reports must show where a customer lived **when** they bought. Given today's `stg_customer` (load date `2025-06-01`), expire the current row of every customer whose tracked attributes changed, insert their new version, and insert brand-new customers. Unchanged customers must not be touched, and the load must be safe to re-run.
""",
    setup=DIM_CUSTOMER_DDL + """
INSERT INTO dim_customer (customer_code, first_name, last_name, email, city, state, country, effective_from, effective_to, is_current, row_hash, version) VALUES
    ('C-001', 'Ana', 'Lopez', 'ana@example.com', 'Austin', 'TX', 'US', DATE '2024-11-02', DATE '9999-12-31', TRUE, 'h-austin', 1),
    ('C-002', 'Raj', 'Patel', 'raj@example.com', 'Pune',   'MH', 'IN', DATE '2024-12-01', DATE '9999-12-31', TRUE, 'h-pune',   1);

CREATE TABLE stg_customer (customer_code VARCHAR, first_name VARCHAR, last_name VARCHAR, email VARCHAR,
                           city VARCHAR, state VARCHAR, country VARCHAR, row_hash VARCHAR);
INSERT INTO stg_customer VALUES
    ('C-001', 'Ana', 'Lopez', 'ana@example.com', 'Denver', 'CO', 'US', 'h-denver'),   -- moved
    ('C-002', 'Raj', 'Patel', 'raj@example.com', 'Pune',   'MH', 'IN', 'h-pune'),     -- unchanged
    ('C-003', 'Li',  'Wei',   'li@example.com',  'Dallas', 'TX', 'US', 'h-dallas');   -- new
""",
    show=["dim_customer", "stg_customer"],
    answer="""
-- Step 1: close the current version of customers whose attributes changed
UPDATE dim_customer AS t
SET is_current   = FALSE,
    effective_to = DATE '2025-06-01' - 1          -- last day the old version was true
FROM stg_customer s
WHERE t.customer_code = s.customer_code
  AND t.is_current
  AND t.row_hash <> s.row_hash;

-- Step 2: open a new current version for changed AND brand-new customers
INSERT INTO dim_customer (customer_code, first_name, last_name, email, city, state, country,
                          effective_from, effective_to, is_current, row_hash, version)
SELECT
    s.customer_code, s.first_name, s.last_name, s.email, s.city, s.state, s.country,
    DATE '2025-06-01', DATE '9999-12-31', TRUE, s.row_hash,
    COALESCE((SELECT MAX(d.version) FROM dim_customer d WHERE d.customer_code = s.customer_code), 0) + 1
FROM stg_customer s
WHERE NOT EXISTS (SELECT 1 FROM dim_customer cur
                  WHERE cur.customer_code = s.customer_code AND cur.is_current);
""",
    result="SELECT customer_sk, customer_code, city, effective_from, effective_to, is_current, version FROM dim_customer ORDER BY customer_code, version",
    diff=("dim_customer", "customer_sk"),
    rerun=True,
    hint="One `MERGE` can't both close the old row and insert the new one for the same key. Use two statements, and think about what Step 1 leaves behind for Step 2 to find.",
    explain="""
- **Two statements, in order.** A standard `MERGE` acts once per matched target row, so it can't expire C-001's row *and* insert C-001's new row. The usual pattern is expire, then insert. (A single-`MERGE` variant exists, using a source that lists each changed key twice, but it's harder to read.)
- **Step 1's `t.row_hash <> s.row_hash`** is the change gate: only C-001 is expired, and C-002 is untouched.
- **`effective_to = load date - 1`** closes the old window the day before the new one opens. The windows are contiguous and never overlap, so exactly one version matches any date (Q25 depends on that).
- **Step 2's `NOT EXISTS (… cur.is_current)`** finds every staged customer without a current row. After Step 1 that is exactly the changed customers (just expired) plus the new ones.
- **`version = MAX(version) + 1`** is computed over all of the customer's versions, so numbering stays correct through any number of changes.
- **Re-run:** the second run finds no hash differences and every customer already current, so it changes nothing. The build verified it.
""",
    after="""
<Callout type="warning" title="Two changes on the same day">

If a customer changes twice in one day and the load runs twice, Step 1 closes the morning's version with `effective_to = load date - 1`, which is *before* its own `effective_from`. The window is inverted, and as-of joins can't find that version. Either run SCD2 at most once per day per key, use timestamps instead of dates for the window, or, when the current version's `effective_from` equals the load date, overwrite it in place instead of opening another.

</Callout>
""",
    check="Grain: one row per customer version, one current. Run twice: verified unchanged. NULL: the hash must be NULL-safe (Q19), or a change from NULL is invisible to `<>`.",
)

q23 = Q(
    id="q23",
    title="SCD Type 3: keep only the previous value",
    level="Medium",
    pattern="SCD3",
    prompt="""
Marketing only ever compares a product's current category with its **immediately previous** one. Add `previous_category` and `category_changed_at` to `dim_product`, and write the update that moves the old category aside when it changes (load date `2025-06-01`).
""",
    setup="""
CREATE TABLE dim_product (product_sk INT, product_code VARCHAR, product_name VARCHAR, category VARCHAR);
INSERT INTO dim_product VALUES (100, 'SKU-001', 'Wireless Mouse', 'Accessories'), (101, 'SKU-004', 'Webcam', 'Accessories');
CREATE TABLE stg_product (product_code VARCHAR, category VARCHAR);
INSERT INTO stg_product VALUES ('SKU-001', 'Accessories'), ('SKU-004', 'Video');
""",
    show=["dim_product", "stg_product"],
    answer="""
ALTER TABLE dim_product ADD COLUMN IF NOT EXISTS previous_category   VARCHAR;
ALTER TABLE dim_product ADD COLUMN IF NOT EXISTS category_changed_at DATE;

UPDATE dim_product AS t
SET previous_category   = t.category,
    category            = s.category,
    category_changed_at = DATE '2025-06-01'
FROM stg_product s
WHERE t.product_code = s.product_code
  AND t.category IS DISTINCT FROM s.category;
""",
    result="SELECT * FROM dim_product ORDER BY product_sk",
    diff=("dim_product", "product_sk"),
    rerun=True,
    hint="The `SET` clause reads the row's old values, so you can copy the old category before overwriting it in the same statement.",
    explain="""
- **Type 3 keeps a fixed, small amount of history in extra columns** of the same row: here exactly one previous value and when it changed. Type 2 keeps unlimited history as extra rows.
- **`SET previous_category = t.category, category = s.category`** works in one statement because every expression in `SET` sees the row's values from *before* the update.
- **`IS DISTINCT FROM`** limits the update to real changes. Without it, SKU-001's unchanged category would be copied into `previous_category`, erasing the true previous value.
- **Re-run:** the second run finds the categories already equal, so nothing changes, and the history stays intact. The build verified it.

Use Type 3 when people only ask "current versus previous", such as sales under the old and new category after a reorganisation. It can't answer "what was it two changes ago".
""",
    check="Grain: unchanged, one row per product. Run twice: verified. NULL: a change from NULL to a category is caught by `IS DISTINCT FROM`, and NULL becomes the previous value.",
)

# ------------------------------------------------------------------ facts

FACT_SRC = """
CREATE TABLE dim_date (date_key INT, full_date DATE);
INSERT INTO dim_date SELECT CAST(strftime(d, '%Y%m%d') AS INT), CAST(d AS DATE) FROM generate_series(DATE '2025-03-01', DATE '2025-04-30', INTERVAL 1 DAY) t(d);
"""

q24 = Q(
    id="q24",
    title="Load the fact table, routing missing keys to Unknown",
    level="Medium",
    pattern="Fact loading",
    prompt="""
Load `fact_sales` from `src_order` and `src_order_line`. Resolve each natural key to the **current** dimension row, compute `gross_amount = quantity × unit_price` and `net_amount = gross_amount − discount_amt`, and make sure an order line whose customer or product is missing from the dimensions still loads.
""",
    setup=FACT_SRC + """
CREATE TABLE dim_customer (customer_sk INT, customer_code VARCHAR, is_current BOOLEAN);
INSERT INTO dim_customer VALUES (-1, 'UNKNOWN', TRUE), (1, 'C-001', TRUE), (2, 'C-002', TRUE);
CREATE TABLE dim_product (product_sk INT, product_code VARCHAR, is_current BOOLEAN);
INSERT INTO dim_product VALUES (-1, 'UNKNOWN', TRUE), (100, 'SKU-001', TRUE), (101, 'SKU-002', TRUE);

CREATE TABLE src_order (order_id VARCHAR, customer_code VARCHAR, order_ts TIMESTAMP);
INSERT INTO src_order VALUES ('SO-1', 'C-001', TIMESTAMP '2025-03-02 10:00'), ('SO-2', 'C-999', TIMESTAMP '2025-03-03 15:30');
CREATE TABLE src_order_line (order_id VARCHAR, line_no INT, product_code VARCHAR, quantity INT, unit_price DECIMAL(10,2), discount_amt DECIMAL(10,2));
INSERT INTO src_order_line VALUES
    ('SO-1', 1, 'SKU-001', 2, 24.99, NULL),
    ('SO-1', 2, 'SKU-002', 1, 89.00, 10.00),
    ('SO-2', 1, 'SKU-777', 3, 5.00, 0.00);

CREATE TABLE fact_sales (date_sk INT, customer_sk INT, product_sk INT, order_id VARCHAR, line_no INT,
                         quantity INT, unit_price DECIMAL(10,2), discount_amt DECIMAL(10,2),
                         gross_amount DECIMAL(12,2), net_amount DECIMAL(12,2));
""",
    show=["src_order", "src_order_line"],
    answer="""
INSERT INTO fact_sales
SELECT
    dd.date_key,
    COALESCE(dc.customer_sk, -1),
    COALESCE(dp.product_sk,  -1),
    ol.order_id,
    ol.line_no,
    ol.quantity,
    ol.unit_price,
    COALESCE(ol.discount_amt, 0),
    ol.quantity * ol.unit_price,
    ol.quantity * ol.unit_price - COALESCE(ol.discount_amt, 0)
FROM src_order_line ol
JOIN      src_order    o  ON o.order_id = ol.order_id
LEFT JOIN dim_date     dd ON dd.full_date = CAST(o.order_ts AS DATE)
LEFT JOIN dim_customer dc ON dc.customer_code = o.customer_code AND dc.is_current
LEFT JOIN dim_product  dp ON dp.product_code  = ol.product_code AND dp.is_current;
""",
    result="SELECT * FROM fact_sales ORDER BY order_id, line_no",
    hint="Which joins are allowed to drop a row? Only the one that defines the grain.",
    explain="""
- **`JOIN src_order`** is an inner join on purpose: an order line without its header is broken source data, and the grain (order line) needs the header's date and customer.
- **`LEFT JOIN` to every dimension**: an unmatched key must not drop the line. SO-2 belongs to customer C-999 and product SKU-777, neither in the dimensions, and it still loads.
- **`COALESCE(sk, -1)`** points unresolved keys at the Unknown member. The $15 of SO-2 stays in every total, as an "Unknown" bucket that a monitor can alert on, instead of silently vanishing.
- **`COALESCE(discount_amt, 0)`**: SO-1 line 1 has no discount, and `x − NULL` is NULL, so without it the line's net amount would be NULL and drop out of `SUM`.
- **`AND is_current`** makes this a *current-version* lookup. That's fine for a first load, but it labels every historical order with the customer's attributes today. Q25 fixes that.
""",
    check="Grain: one row per order line; dimension joins can't multiply rows, because each `is_current` lookup returns at most one row per key. Run twice: this plain insert doubles the fact; incremental loads use Q27, reloads Q28. NULL: missing keys become `-1`, missing discounts 0.",
)

q25 = Q(
    id="q25",
    title="Point-in-time lookup: the tier at the time of purchase",
    level="Hard",
    pattern="As-of join",
    prompt="""
`dim_customer` tracks `loyalty_tier` as SCD2. C-001 was BRONZE until 31 March and GOLD from 1 April. Count orders by the tier the customer had **when they ordered**, and show how the answer changes if you join on the current tier instead.
""",
    setup="""
CREATE TABLE dim_customer (customer_sk INT, customer_code VARCHAR, loyalty_tier VARCHAR,
                           effective_from DATE, effective_to DATE, is_current BOOLEAN);
INSERT INTO dim_customer VALUES
    (1, 'C-001', 'BRONZE', DATE '2024-11-02', DATE '2025-03-31', FALSE),
    (4, 'C-001', 'GOLD',   DATE '2025-04-01', DATE '9999-12-31', TRUE),
    (2, 'C-002', 'SILVER', DATE '2024-12-01', DATE '9999-12-31', TRUE);
CREATE TABLE src_order (order_id VARCHAR, customer_code VARCHAR, order_ts TIMESTAMP);
INSERT INTO src_order VALUES
    ('SO-1', 'C-001', TIMESTAMP '2025-03-05 10:00'), ('SO-2', 'C-001', TIMESTAMP '2025-03-20 18:00'),
    ('SO-3', 'C-001', TIMESTAMP '2025-04-02 09:00'), ('SO-4', 'C-002', TIMESTAMP '2025-04-03 12:00');
""",
    show=["dim_customer", "src_order"],
    answer="""
SELECT dc.loyalty_tier AS tier_at_purchase, COUNT(*) AS orders
FROM src_order o
JOIN dim_customer dc
  ON dc.customer_code = o.customer_code
 AND CAST(o.order_ts AS DATE) BETWEEN dc.effective_from AND dc.effective_to
GROUP BY dc.loyalty_tier
ORDER BY dc.loyalty_tier;
""",
    hint="Instead of `is_current`, join on the version whose validity window contains the order date.",
    explain="""
- **`order date BETWEEN effective_from AND effective_to`** picks the version that was true on the day of the order: SO-1 and SO-2 find the BRONZE row, SO-3 the GOLD row. This is a **point-in-time** (as-of) join.
- It returns exactly one version per order because Q22's windows are contiguous and don't overlap. If they did overlap, this join would duplicate orders.
- **Joining on `is_current`** credits all three of C-001's orders to GOLD, as the step-through shows. Any "did customers spend more after upgrading?" analysis is then meaningless, because the history has been rewritten.
- **In a real warehouse you resolve this once, at load time:** the fact load uses the as-of join to pick `customer_sk`, and since each version has its own surrogate key, the fact row is pinned to the right version forever. Reports then join on `customer_sk` with no date logic at all.
""",
    steps=[
        Step("As-of", "Each order matched to the version valid on its date.",
             tables=[Show("as-of match", "SELECT o.order_id, CAST(o.order_ts AS DATE) AS order_date, dc.customer_sk, dc.loyalty_tier, dc.effective_from, dc.effective_to, 'keep' AS _mark FROM src_order o JOIN dim_customer dc ON dc.customer_code = o.customer_code AND CAST(o.order_ts AS DATE) BETWEEN dc.effective_from AND dc.effective_to ORDER BY o.order_id")]),
        Step("Current", "Joined on is_current, the March orders are labelled GOLD although the customer was BRONZE then.",
             tables=[Show("current-version match", "SELECT o.order_id, CAST(o.order_ts AS DATE) AS order_date, dc.customer_sk, dc.loyalty_tier, CASE WHEN o.order_id IN ('SO-1','SO-2') THEN 'bad' END AS _mark FROM src_order o JOIN dim_customer dc ON dc.customer_code = o.customer_code AND dc.is_current ORDER BY o.order_id")]),
        Step("Totals", "The two answers side by side.",
             tables=[Show("as-of (correct)", "SELECT dc.loyalty_tier AS tier, COUNT(*) AS orders FROM src_order o JOIN dim_customer dc ON dc.customer_code = o.customer_code AND CAST(o.order_ts AS DATE) BETWEEN dc.effective_from AND dc.effective_to GROUP BY 1 ORDER BY 1"),
                     Show("current (wrong)", "SELECT dc.loyalty_tier AS tier, COUNT(*) AS orders, CASE WHEN dc.loyalty_tier = 'GOLD' THEN 'bad' END AS _mark FROM src_order o JOIN dim_customer dc ON dc.customer_code = o.customer_code AND dc.is_current GROUP BY 1 ORDER BY 1")]),
    ],
    trace_alt="Three steps: each order matched to the customer version valid on its date; the same orders matched to the current version, mislabelling two March orders as GOLD; and the totals, BRONZE 2, GOLD 1, SILVER 1 against GOLD 3, SILVER 1.",
    check="Grain: one row per order, because the windows don't overlap. NULL: a window with a NULL end date would match nothing; that's why the sentinel `9999-12-31` exists.",
)

q26 = Q(
    id="q26",
    title="Additive, semi-additive and non-additive measures",
    level="Medium",
    pattern="Measures",
    prompt="""
From two small facts, compute (1) total revenue for March, (2) total stock on hand at the end of March across both products, and (3) the March margin %. Then show the wrong answer each one gets if you aggregate it like revenue.
""",
    setup="""
CREATE TABLE fact_sales_daily (sale_date DATE, product VARCHAR, revenue DECIMAL(10,2), cost DECIMAL(10,2));
INSERT INTO fact_sales_daily VALUES
    (DATE '2025-03-01', 'Mouse', 100.00, 60.00), (DATE '2025-03-01', 'Keyboard', 900.00, 810.00),
    (DATE '2025-03-31', 'Mouse', 300.00, 150.00), (DATE '2025-03-31', 'Keyboard', 100.00, 90.00);
CREATE TABLE fact_inventory (snapshot_date DATE, product VARCHAR, on_hand INT);
INSERT INTO fact_inventory VALUES
    (DATE '2025-03-01', 'Mouse', 40), (DATE '2025-03-01', 'Keyboard', 10),
    (DATE '2025-03-31', 'Mouse', 25), (DATE '2025-03-31', 'Keyboard', 12);
""",
    show=["fact_sales_daily", "fact_inventory"],
    answer="""
SELECT
    (SELECT SUM(revenue) FROM fact_sales_daily)                                   AS revenue,
    (SELECT SUM(on_hand) FROM fact_inventory
      WHERE snapshot_date = (SELECT MAX(snapshot_date) FROM fact_inventory))     AS month_end_on_hand,
    (SELECT ROUND(100 * SUM(revenue - cost) / NULLIF(SUM(revenue), 0), 1)
       FROM fact_sales_daily)                                                     AS margin_pct;
""",
    hint="Revenue adds up across anything. Stock is a level, not a flow. A percentage is a ratio of two sums.",
    explain="""
- **Additive (revenue):** sums correctly across every dimension, including time. $1,400.
- **Semi-additive (stock on hand):** you can sum it across products at one moment, but not across dates: the 40 mice on 1 March and the 25 on 31 March are partly the same mice. Across time you take the **end-of-period** value (or an average). Summing all four snapshots gives 87, an amount of stock that never existed.
- **Non-additive (margin %):** a ratio can't be summed *or* averaged. Recompute it from its parts: `SUM(revenue − cost) ÷ SUM(revenue)` = 290 ÷ 1,400 = 20.7%. The average of the four daily percentages is 27.5%, because it gives the $100 keyboard day the same weight as the $900 one. `NULLIF(…, 0)` avoids dividing by zero.

The rule for fact design follows: store the additive parts (revenue, cost), never the ratio, so any aggregation can rebuild the ratio correctly.
""",
    steps=[
        Step("Wrong", "Each measure aggregated like revenue.",
             tables=[Show("naive", "SELECT (SELECT SUM(revenue) FROM fact_sales_daily) AS revenue, (SELECT SUM(on_hand) FROM fact_inventory) AS sum_of_all_snapshots, (SELECT ROUND(AVG(100 * (revenue - cost) / revenue), 1) FROM fact_sales_daily) AS avg_of_daily_margins, 'bad' AS _mark")]),
        Step("Right", "Revenue summed, stock taken at month end, margin recomputed from its parts.",
             tables=[Show("correct", "SELECT (SELECT SUM(revenue) FROM fact_sales_daily) AS revenue, (SELECT SUM(on_hand) FROM fact_inventory WHERE snapshot_date = (SELECT MAX(snapshot_date) FROM fact_inventory)) AS month_end_on_hand, (SELECT ROUND(100 * SUM(revenue - cost) / NULLIF(SUM(revenue), 0), 1) FROM fact_sales_daily) AS margin_pct, 'keep' AS _mark")]),
    ],
    trace_alt="Two steps: the naive aggregation giving stock 87 and an average margin of 27.5 percent; the correct one giving revenue 1400, month-end stock 37 and margin 20.7 percent.",
    check="Grain: know each measure's additivity before you sum it. NULL: `NULLIF(denominator, 0)` turns divide-by-zero into NULL rather than an error.",
)

# ------------------------------------------------------------------ incremental

q27 = Q(
    id="q27",
    title="An incremental load with a watermark that can't skip rows",
    level="Hard",
    pattern="Watermarking",
    prompt="""
Load only new rows from `src_sales_feed` into `fact_sales` on each run, tracking progress in `load_control`. The load must:

- not skip a row that lands **while the load is running**,
- not skip an order that arrives late (an old `order_ts` that lands today),
- leave the watermark alone when a run finds nothing new.
""",
    setup="""
CREATE TABLE src_sales_feed (order_id VARCHAR, line_no INT, amount DECIMAL(10,2), order_ts TIMESTAMP, _loaded_at TIMESTAMP);
INSERT INTO src_sales_feed VALUES
    ('SO-1', 1, 49.98, TIMESTAMP '2025-03-01 10:00', TIMESTAMP '2025-03-01 10:05'),
    ('SO-2', 1, 79.00, TIMESTAMP '2025-03-01 11:00', TIMESTAMP '2025-03-01 11:02'),
    ('SO-3', 1, 15.00, TIMESTAMP '2025-03-02 09:00', TIMESTAMP '2025-03-02 09:01');
CREATE TABLE fact_sales (order_id VARCHAR, line_no INT, amount DECIMAL(10,2), order_ts TIMESTAMP, _loaded_at TIMESTAMP);
CREATE TABLE load_control (table_name VARCHAR, watermark_ts TIMESTAMP);
INSERT INTO load_control VALUES ('fact_sales', TIMESTAMP '1900-01-01');
""",
    show=["src_sales_feed", "load_control"],
    answer="""
-- 1. Fix this run's upper bound BEFORE loading anything
CREATE OR REPLACE TEMP TABLE batch AS
SELECT
    (SELECT watermark_ts FROM load_control WHERE table_name = 'fact_sales') AS lower_ts,
    MAX(_loaded_at)                                                         AS upper_ts
FROM src_sales_feed
WHERE _loaded_at > (SELECT watermark_ts FROM load_control WHERE table_name = 'fact_sales');

-- 2. Load exactly the rows in (lower, upper]
INSERT INTO fact_sales
SELECT f.*
FROM src_sales_feed f, batch b
WHERE f._loaded_at >  b.lower_ts
  AND f._loaded_at <= b.upper_ts;

-- 3. Advance to the bound you loaded up to; an empty run leaves it unchanged
UPDATE load_control
SET watermark_ts = COALESCE((SELECT upper_ts FROM batch), watermark_ts)
WHERE table_name = 'fact_sales';
""",
    result="SELECT (SELECT count(*) FROM fact_sales) AS rows_loaded, (SELECT watermark_ts FROM load_control) AS watermark_ts",
    rerun=True,
    hint="Three decisions: which column the watermark follows, when you read the upper bound, and what the watermark becomes when `MAX` finds no rows.",
    explain="""
- **Follow the ingestion time (`_loaded_at`), not the business time (`order_ts`).** A late order has an old `order_ts`, so a watermark on `order_ts` has already passed it and skips it forever. `_loaded_at` says when the row reached you, which is what "new since last run" means.
- **Fix the upper bound first, then load `(lower, upper]`.** The common version inserts `WHERE _loaded_at > watermark` and *afterwards* sets the watermark to `MAX(_loaded_at)`. A row that lands between those two statements is above the old watermark but below the new one: never loaded, never seen again. Freezing `upper_ts` in step 1 and loading up to it closes the gap; anything that lands later has `_loaded_at > upper_ts` and waits for the next run.
- **`COALESCE(upper_ts, watermark_ts)`** keeps the watermark when the batch is empty (`MAX` over no rows is NULL). Don't reach for `GREATEST(old, new)` here: in Snowflake, `GREATEST` returns NULL if any argument is NULL ([docs](https://docs.snowflake.com/en/sql-reference/functions/greatest)), so an empty run would set the watermark to NULL, and the next run's `> NULL` filter would match nothing, ever. (`GREATEST_IGNORE_NULLS` exists for this.) DuckDB's and Postgres's `GREATEST` ignore NULLs, so the bug never appears in local testing.
- **Re-run:** the second run finds nothing above the watermark and leaves both the fact and the watermark unchanged. The build verified it.
""",
    after="""
One gap remains, and it's about how `_loaded_at` is assigned rather than about this SQL: a slow writer can commit a row whose `_loaded_at` is earlier than one already loaded. If your source can do that, re-read a small safety window (`_loaded_at > watermark − 10 minutes`) and load with `MERGE` on the grain, so the overlap is absorbed instead of duplicated.
""",
    steps=[
        Step("Run 1", "The first run loads all three rows and sets the watermark to the newest _loaded_at.",
             run="""CREATE OR REPLACE TEMP TABLE batch AS SELECT (SELECT watermark_ts FROM load_control WHERE table_name = 'fact_sales') AS lower_ts, MAX(_loaded_at) AS upper_ts FROM src_sales_feed WHERE _loaded_at > (SELECT watermark_ts FROM load_control WHERE table_name = 'fact_sales');
INSERT INTO fact_sales SELECT f.* FROM src_sales_feed f, batch b WHERE f._loaded_at > b.lower_ts AND f._loaded_at <= b.upper_ts;
UPDATE load_control SET watermark_ts = COALESCE((SELECT upper_ts FROM batch), watermark_ts) WHERE table_name = 'fact_sales';""",
             tables=[Show("fact_sales", "SELECT order_id, amount, order_ts, _loaded_at, 'new' AS _mark FROM fact_sales ORDER BY _loaded_at"), Show("load_control", "SELECT * FROM load_control")]),
        Step("Late order lands", "SO-0 was placed on 28 February but reaches the feed on 3 March. Its order_ts is older than everything loaded.",
             run="INSERT INTO src_sales_feed VALUES ('SO-0', 1, 120.00, TIMESTAMP '2025-02-28 16:00', TIMESTAMP '2025-03-03 08:00')",
             tables=[Show("src_sales_feed", "SELECT order_id, amount, order_ts, _loaded_at, CASE WHEN order_id = 'SO-0' THEN 'hit' END AS _mark FROM src_sales_feed ORDER BY _loaded_at")]),
        Step("Run 2", "The watermark follows _loaded_at, so the late order is picked up. A watermark on order_ts would have skipped it.",
             run="""CREATE OR REPLACE TEMP TABLE batch AS SELECT (SELECT watermark_ts FROM load_control WHERE table_name = 'fact_sales') AS lower_ts, MAX(_loaded_at) AS upper_ts FROM src_sales_feed WHERE _loaded_at > (SELECT watermark_ts FROM load_control WHERE table_name = 'fact_sales');
INSERT INTO fact_sales SELECT f.* FROM src_sales_feed f, batch b WHERE f._loaded_at > b.lower_ts AND f._loaded_at <= b.upper_ts;
UPDATE load_control SET watermark_ts = COALESCE((SELECT upper_ts FROM batch), watermark_ts) WHERE table_name = 'fact_sales';""",
             tables=[Show("fact_sales", "SELECT order_id, amount, order_ts, _loaded_at, CASE WHEN order_id = 'SO-0' THEN 'new' END AS _mark FROM fact_sales ORDER BY _loaded_at"), Show("load_control", "SELECT *, 'upd' AS _mark FROM load_control")]),
        Step("Empty run", "Nothing new: upper_ts is NULL, and COALESCE keeps the watermark where it was.",
             run="""CREATE OR REPLACE TEMP TABLE batch AS SELECT (SELECT watermark_ts FROM load_control WHERE table_name = 'fact_sales') AS lower_ts, MAX(_loaded_at) AS upper_ts FROM src_sales_feed WHERE _loaded_at > (SELECT watermark_ts FROM load_control WHERE table_name = 'fact_sales');
INSERT INTO fact_sales SELECT f.* FROM src_sales_feed f, batch b WHERE f._loaded_at > b.lower_ts AND f._loaded_at <= b.upper_ts;
UPDATE load_control SET watermark_ts = COALESCE((SELECT upper_ts FROM batch), watermark_ts) WHERE table_name = 'fact_sales';""",
             tables=[Show("batch", "SELECT * FROM batch"), Show("load_control", "SELECT * FROM load_control")]),
    ],
    trace_alt="Four steps: the first run loads three rows and sets the watermark; a late order with an old order date lands; the second run picks it up because the watermark follows load time; an empty run leaves the watermark unchanged.",
    check="Grain: one row per order line, provided each run's window `(lower, upper]` doesn't overlap the last. Run twice: verified unchanged. NULL: an empty batch's `MAX` is NULL, so the watermark update must be NULL-proof, and in Snowflake `GREATEST` is not.",
)

q28 = Q(
    id="q28",
    title="Reload one day without duplicates or leftovers",
    level="Hard",
    pattern="Idempotent reprocessing",
    prompt="""
Upstream fixed 27 March: one line's quantity changed, one line was **deleted** in the source, and one line was added. Reload only that day in `fact_sales`, leaving other days alone, with no duplicates and no leftover rows. Compare a delete-and-insert with a `MERGE` on the grain.
""",
    setup="""
CREATE TABLE fact_sales (sale_date DATE, order_id VARCHAR, line_no INT, quantity INT, net_amount DECIMAL(10,2));
INSERT INTO fact_sales VALUES
    (DATE '2025-03-26', 'SO-7', 1, 1, 10.00),
    (DATE '2025-03-27', 'SO-8', 1, 2, 40.00),
    (DATE '2025-03-27', 'SO-8', 2, 1, 15.00),
    (DATE '2025-03-27', 'SO-9', 1, 1, 30.00);
CREATE TABLE src_fixed (sale_date DATE, order_id VARCHAR, line_no INT, quantity INT, net_amount DECIMAL(10,2));
INSERT INTO src_fixed VALUES
    (DATE '2025-03-27', 'SO-8', 1, 3, 60.00),    -- quantity corrected
                                                  -- SO-8 line 2 deleted upstream
    (DATE '2025-03-27', 'SO-9', 1, 1, 30.00),    -- unchanged
    (DATE '2025-03-27', 'SO-9', 2, 1, 12.00);    -- new line
""",
    show=["fact_sales", "src_fixed"],
    answer="""
BEGIN TRANSACTION;

DELETE FROM fact_sales WHERE sale_date = DATE '2025-03-27';

INSERT INTO fact_sales
SELECT sale_date, order_id, line_no, quantity, net_amount
FROM src_fixed
WHERE sale_date = DATE '2025-03-27';

COMMIT;
""",
    result="SELECT * FROM fact_sales ORDER BY sale_date, order_id, line_no",
    rerun=True,
    hint="One of the two approaches can't see rows that disappeared from the source.",
    explain="""
- **Delete the day, insert the day.** Whatever the fact held for 27 March is replaced by exactly what the source now holds. The corrected quantity, the new line *and the deletion* all come through, and 26 March is untouched.
- **The transaction** means no reader ever sees the day half-deleted. Without it, a dashboard refreshing mid-load shows 27 March as empty.
- **`MERGE` on `(order_id, line_no)`** handles the update and the new line, but not the deletion: SO-8 line 2 is no longer in the source, so it never matches anything, and it stays in the fact as a $15 leftover (step 2). Some engines can fix this with `WHEN NOT MATCHED BY SOURCE … THEN DELETE` (DuckDB, SQL Server, Databricks), but Snowflake's `MERGE` has no such clause ([syntax](https://docs.snowflake.com/en/sql-reference/sql/merge)), and you'd also have to limit it to the one day.
- **Re-run:** deleting and re-inserting the same day gives the same result. The build verified it.

Use delete-and-insert by partition when the source can delete; `MERGE` is lighter when it only inserts and updates.
""",
    steps=[
        Step("Before", "The fact holds the old version of 27 March.",
             tables=[Show("fact_sales", "SELECT *, CASE WHEN sale_date = DATE '2025-03-27' THEN 'hit' END AS _mark FROM fact_sales ORDER BY 1, 2, 3")]),
        Step("MERGE", "A MERGE on the grain updates SO-8 line 1 and adds SO-9 line 2, but the deleted line stays.",
             run="""CREATE TABLE merged AS SELECT * FROM fact_sales;
MERGE INTO merged t USING src_fixed s ON t.order_id = s.order_id AND t.line_no = s.line_no WHEN MATCHED THEN UPDATE SET quantity = s.quantity, net_amount = s.net_amount WHEN NOT MATCHED THEN INSERT VALUES (s.sale_date, s.order_id, s.line_no, s.quantity, s.net_amount);""",
             tables=[Show("after MERGE", "SELECT *, CASE WHEN order_id = 'SO-8' AND line_no = 2 THEN 'bad' WHEN order_id = 'SO-9' AND line_no = 2 THEN 'new' WHEN order_id = 'SO-8' AND line_no = 1 THEN 'upd' END AS _mark FROM merged ORDER BY 1, 2, 3")]),
        Step("Delete + insert", "Replacing the whole day also removes the deleted line.",
             run="""BEGIN TRANSACTION; DELETE FROM fact_sales WHERE sale_date = DATE '2025-03-27'; INSERT INTO fact_sales SELECT * FROM src_fixed WHERE sale_date = DATE '2025-03-27'; COMMIT;""",
             tables=[Show("after delete + insert", "SELECT *, CASE WHEN sale_date = DATE '2025-03-27' THEN 'new' END AS _mark FROM fact_sales ORDER BY 1, 2, 3")]),
        Step("Totals", "27 March's net amount under each approach. The source now totals $102.",
             tables=[Show("27 March net", "SELECT 'MERGE' AS approach, SUM(net_amount) AS net_amount, 'bad' AS _mark FROM merged WHERE sale_date = DATE '2025-03-27' UNION ALL SELECT 'delete + insert', SUM(net_amount), 'keep' FROM fact_sales WHERE sale_date = DATE '2025-03-27'")]),
    ],
    trace_alt="Four steps: the old 27 March rows; a MERGE that updates and inserts but leaves the deleted line; a delete and insert of the whole day that removes it; and the day's totals, 117 after the MERGE against the correct 102.",
    check="Grain: one row per order line within the day. Run twice: verified unchanged. NULL: the delete must target exactly the reloaded partition; a NULL `sale_date` would survive every day's delete, so keep it `NOT NULL`.",
)

q29 = Q(
    id="q29",
    title="A late-arriving dimension: the inferred member",
    level="Hard",
    pattern="Late-arriving dimension",
    prompt="""
An order line references `SKU-009`, which the product feed hasn't sent yet. Don't drop the line, and don't route it to `-1` (that loses which product it was). Insert an **inferred** placeholder product, load the fact against it, and when the real product arrives, fill the placeholder in so every fact that already points at it gets the right attributes.
""",
    setup="""
CREATE SEQUENCE product_sk_seq START 100;
CREATE TABLE dim_product (product_sk INTEGER DEFAULT nextval('product_sk_seq'), product_code VARCHAR,
                          product_name VARCHAR, category VARCHAR, is_inferred BOOLEAN DEFAULT FALSE);
INSERT INTO dim_product (product_code, product_name, category) VALUES ('SKU-001', 'Wireless Mouse', 'Accessories');
CREATE TABLE src_order_line (order_id VARCHAR, line_no INT, product_code VARCHAR, net_amount DECIMAL(10,2));
INSERT INTO src_order_line VALUES ('SO-1', 1, 'SKU-001', 49.98), ('SO-1', 2, 'SKU-009', 120.00);
CREATE TABLE fact_sales (order_id VARCHAR, line_no INT, product_sk INT, net_amount DECIMAL(10,2));
CREATE TABLE stg_product_late (product_code VARCHAR, product_name VARCHAR, category VARCHAR);
INSERT INTO stg_product_late VALUES ('SKU-009', '4K Monitor', 'Displays');
""",
    show=["dim_product", "src_order_line", "stg_product_late"],
    answer="""
-- 1. Before the fact load: a placeholder for every unknown product code
INSERT INTO dim_product (product_code, product_name, category, is_inferred)
SELECT DISTINCT ol.product_code, 'UNKNOWN', 'UNKNOWN', TRUE
FROM src_order_line ol
WHERE NOT EXISTS (SELECT 1 FROM dim_product d WHERE d.product_code = ol.product_code);

-- 2. The fact load now resolves every code to a real surrogate key
INSERT INTO fact_sales
SELECT ol.order_id, ol.line_no, d.product_sk, ol.net_amount
FROM src_order_line ol
JOIN dim_product d ON d.product_code = ol.product_code;

-- 3. Later, when the product feed delivers it: fill the placeholder in place
UPDATE dim_product AS t
SET product_name = s.product_name, category = s.category, is_inferred = FALSE
FROM stg_product_late s
WHERE t.product_code = s.product_code AND t.is_inferred;
""",
    result="SELECT f.order_id, f.line_no, f.product_sk, d.product_name, d.category, d.is_inferred, f.net_amount FROM fact_sales f JOIN dim_product d USING (product_sk) ORDER BY 1, 2",
    hint="The placeholder needs a real surrogate key and the real natural key; only its attributes are unknown.",
    explain="""
- **Step 1** creates a real dimension row for SKU-009, with the known natural key, a new surrogate key, placeholder attributes and `is_inferred = TRUE` so it can be monitored.
- **Step 2** can now use an inner join safely: every code resolves. The $120 line keeps its link to *which* product it was.
- **Step 3** fills the placeholder **in place** (a Type 1 fill), keeping the same surrogate key. Every fact row already pointing at product 101 shows "4K Monitor, Displays" immediately, with no fact update.
- **Why not `-1`?** Unknown loses the natural key: when the real product arrives, nothing tells you which `-1` facts were SKU-009.
- **Why not a new surrogate key for the real product?** Then every fact pointing at the placeholder must be re-pointed: a large, risky fact `UPDATE`. Filling in place avoids it entirely.
""",
    steps=[
        Step("Placeholder", "SKU-009 gets a real surrogate key and placeholder attributes.",
             run="INSERT INTO dim_product (product_code, product_name, category, is_inferred) SELECT DISTINCT ol.product_code, 'UNKNOWN', 'UNKNOWN', TRUE FROM src_order_line ol WHERE NOT EXISTS (SELECT 1 FROM dim_product d WHERE d.product_code = ol.product_code)",
             tables=[Show("dim_product", "SELECT *, CASE WHEN is_inferred THEN 'new' END AS _mark FROM dim_product ORDER BY product_sk")]),
        Step("Fact load", "Both lines load. Line 2 points at the placeholder's key, 101.",
             run="INSERT INTO fact_sales SELECT ol.order_id, ol.line_no, d.product_sk, ol.net_amount FROM src_order_line ol JOIN dim_product d ON d.product_code = ol.product_code",
             tables=[Show("fact_sales joined to dim_product", "SELECT f.order_id, f.line_no, f.product_sk, d.product_name, f.net_amount, CASE WHEN d.is_inferred THEN 'hit' END AS _mark FROM fact_sales f JOIN dim_product d USING (product_sk) ORDER BY 1, 2")]),
        Step("Product arrives", "The placeholder is filled in place, and the fact picks up the real name with no fact update.",
             run="UPDATE dim_product AS t SET product_name = s.product_name, category = s.category, is_inferred = FALSE FROM stg_product_late s WHERE t.product_code = s.product_code AND t.is_inferred",
             tables=[Show("dim_product", "SELECT *, CASE WHEN product_code = 'SKU-009' THEN 'upd' END AS _mark FROM dim_product ORDER BY product_sk"),
                     Show("fact_sales joined to dim_product", "SELECT f.order_id, f.line_no, f.product_sk, d.product_name, f.net_amount, CASE WHEN f.product_sk = 101 THEN 'upd' END AS _mark FROM fact_sales f JOIN dim_product d USING (product_sk) ORDER BY 1, 2")]),
    ],
    trace_alt="Three steps: an inferred placeholder row for SKU-009 is inserted with key 101; the fact loads with line 2 pointing at 101; the real product arrives and fills the placeholder, so the fact shows 4K Monitor without being updated.",
    check="Grain: unchanged on both tables. Run twice: Step 1's `NOT EXISTS` and Step 3's `is_inferred` filter make both dimension steps re-runnable; Step 2 is a plain fact insert. Monitor how many inferred rows stay unfilled, and for how long.",
)

# ------------------------------------------------------------------ other fact types

q30 = Q(
    id="q30",
    title="A factless fact: promoted but never sold",
    level="Medium",
    pattern="Factless fact",
    prompt="""
`fact_promotion_coverage` records that a product was on promotion on a date. It has no measures. Which products were on promotion on a day when they sold **nothing**?
""",
    setup="""
CREATE TABLE fact_promotion_coverage (sale_date DATE, product VARCHAR);
INSERT INTO fact_promotion_coverage VALUES
    (DATE '2025-03-10', 'Mouse'), (DATE '2025-03-10', 'Keyboard'), (DATE '2025-03-11', 'Mouse'), (DATE '2025-03-11', 'Webcam');
CREATE TABLE fact_sales (sale_date DATE, product VARCHAR, quantity INT);
INSERT INTO fact_sales VALUES
    (DATE '2025-03-10', 'Mouse', 3), (DATE '2025-03-11', 'Mouse', 1), (DATE '2025-03-11', 'Keyboard', 2);
""",
    show=["fact_promotion_coverage", "fact_sales"],
    answer="""
SELECT pc.sale_date, pc.product
FROM fact_promotion_coverage pc
WHERE NOT EXISTS (
    SELECT 1 FROM fact_sales fs
    WHERE fs.sale_date = pc.sale_date AND fs.product = pc.product
)
ORDER BY 1, 2;
""",
    hint="The sales fact can't show a sale that didn't happen. Start from the table that records what *could* have happened.",
    explain="""
- A **factless fact** records that an event or a condition happened, with keys and no numbers: a promotion ran, a student was enrolled, a product was eligible.
- It answers **what didn't happen**, which a measure fact can't: the sales fact has no row for the keyboard on 10 March, so you can't ask it "which promotions sold nothing?". Starting from the coverage table and anti-joining to sales (`NOT EXISTS`) finds the promoted-but-unsold product-days.
- The keyboard sold on 11 March, but it wasn't promoted that day, so it isn't counted as a promotion success. The anti-join matches on both date and product.
""",
    check="Grain: one row per promoted product-day. NULL: `NOT EXISTS` is safe even if a sales key is NULL; `NOT IN` wouldn't be (Q14).",
)

q31 = Q(
    id="q31",
    title="A bridge table that doesn't inflate revenue",
    level="Hard",
    pattern="Bridge and allocation",
    prompt="""
An order can use several coupons. Report revenue by coupon so that the coupon totals add up to the real revenue. Show how a plain join to the coupon list inflates it.
""",
    setup="""
CREATE TABLE fact_sales (order_id VARCHAR, line_no INT, net_amount DECIMAL(10,2));
INSERT INTO fact_sales VALUES ('SO-1', 1, 60.00), ('SO-1', 2, 40.00), ('SO-2', 1, 50.00);
CREATE TABLE order_coupon (order_id VARCHAR, coupon_code VARCHAR);
INSERT INTO order_coupon VALUES ('SO-1', 'SPRING'), ('SO-1', 'FREESHIP'), ('SO-2', 'SPRING');
""",
    show=["fact_sales", "order_coupon"],
    answer="""
CREATE OR REPLACE TABLE bridge_order_coupon AS
SELECT order_id, coupon_code,
       1.0 / COUNT(*) OVER (PARTITION BY order_id) AS weight     -- weights per order sum to 1
FROM order_coupon;

SELECT b.coupon_code,
       ROUND(SUM(fs.net_amount * b.weight), 2) AS attributed_revenue
FROM fact_sales fs
JOIN bridge_order_coupon b ON b.order_id = fs.order_id
GROUP BY b.coupon_code
ORDER BY b.coupon_code;
""",
    hint="Each order's revenue has to be split among its coupons, not copied to each of them.",
    explain="""
- **The fan-out:** joining order lines to an order-level coupon list repeats each line once per coupon. SO-1's $100 appears under SPRING *and* under FREESHIP, so the coupon totals sum to $250 for $150 of real revenue (step 2).
- **The bridge** (`bridge_order_coupon`) resolves the many-to-many relationship and carries a **weight**: `1 / number of coupons on the order`. SO-1's two coupons get 0.5 each.
- **`SUM(net_amount × weight)`** splits each order's revenue across its coupons, so the totals sum to exactly the real revenue. An even split is the simplest rule; a business can weight by coupon value instead, as long as each order's weights sum to 1.
""",
    steps=[
        Step("Fan-out", "The plain join repeats SO-1's lines once per coupon.",
             tables=[Show("fact_sales JOIN order_coupon", "SELECT fs.order_id, fs.line_no, fs.net_amount, oc.coupon_code, CASE WHEN fs.order_id = 'SO-1' THEN 'bad' END AS _mark FROM fact_sales fs JOIN order_coupon oc USING (order_id) ORDER BY 1, 2, 4")]),
        Step("Totals", "Naive coupon totals add up to 250; weighted ones to the real 150.",
             run="CREATE OR REPLACE TABLE bridge_order_coupon AS SELECT order_id, coupon_code, 1.0 / COUNT(*) OVER (PARTITION BY order_id) AS weight FROM order_coupon",
             tables=[Show("naive", "SELECT oc.coupon_code, SUM(fs.net_amount) AS revenue, 'bad' AS _mark FROM fact_sales fs JOIN order_coupon oc USING (order_id) GROUP BY 1 UNION ALL SELECT 'TOTAL', SUM(fs.net_amount), 'bad' FROM fact_sales fs JOIN order_coupon oc USING (order_id) ORDER BY 1"),
                     Show("weighted", "SELECT b.coupon_code, ROUND(SUM(fs.net_amount * b.weight), 2) AS revenue, 'keep' AS _mark FROM fact_sales fs JOIN bridge_order_coupon b USING (order_id) GROUP BY 1 UNION ALL SELECT 'TOTAL', ROUND(SUM(fs.net_amount * b.weight), 2), 'keep' FROM fact_sales fs JOIN bridge_order_coupon b USING (order_id) ORDER BY 1")]),
        Step("Bridge", "The bridge with its weights.",
             tables=[Show("bridge_order_coupon", "SELECT * FROM bridge_order_coupon ORDER BY 1, 2")]),
    ],
    trace_alt="Three steps: the plain join repeating order SO-1's lines per coupon; coupon totals summing to 250 naively and to the real 150 with weights; and the bridge table with weight 0.5 for each of SO-1's coupons.",
    check="Grain: the bridge is one row per order and coupon; the report is one row per coupon. Check: `SUM(weight)` per order is exactly 1, and the weighted total equals the fact total.",
)

q32 = Q(
    id="q32",
    title="Month-end stock from a snapshot fact",
    level="Medium",
    pattern="Periodic snapshot",
    prompt="""
`fact_inventory_snapshot` holds end-of-day stock per store. Report stock on hand **at the end of each month** per store. February's snapshot for the 28th failed to run, so February's last available snapshot is the 27th.
""",
    setup="""
CREATE TABLE fact_inventory_snapshot (snapshot_date DATE, store VARCHAR, product VARCHAR, on_hand INT);
INSERT INTO fact_inventory_snapshot VALUES
    (DATE '2025-01-30', 'Downtown', 'Mouse', 50), (DATE '2025-01-31', 'Downtown', 'Mouse', 48), (DATE '2025-01-31', 'Downtown', 'Keyboard', 12),
    (DATE '2025-02-26', 'Downtown', 'Mouse', 30), (DATE '2025-02-27', 'Downtown', 'Mouse', 28), (DATE '2025-02-27', 'Downtown', 'Keyboard', 9);
""",
    show=["fact_inventory_snapshot"],
    answer="""
WITH last_snapshot AS (
    SELECT *
    FROM fact_inventory_snapshot
    QUALIFY snapshot_date = MAX(snapshot_date)
            OVER (PARTITION BY date_trunc('month', snapshot_date), store)
)
SELECT CAST(date_trunc('month', snapshot_date) AS DATE) AS month,
       store,
       MAX(snapshot_date)                 AS snapshot_used,
       SUM(on_hand)                       AS month_end_on_hand
FROM last_snapshot
GROUP BY ALL
ORDER BY month, store;
""",
    hint="On-hand stock can be summed across products but not across days. Pick one day per month first; which day, if the calendar's last day is missing?",
    explain="""
- **Stock is semi-additive** (Q26): sum across products at one moment, never across days. So each month has to collapse to a single snapshot day first.
- **The CTE's `QUALIFY snapshot_date = MAX(snapshot_date) OVER (…)`** keeps the rows of the **last available** snapshot of each month and store. It has to happen in its own step: `QUALIFY` runs after `GROUP BY`, so it can't filter rows before they're summed. The outer query then adds up the products on that one day.
- **The calendar-month-end version** (join to the last calendar day of each month) loses February completely, because 28 February has no rows (step 2). A month disappearing from a stock report is worse than a slightly stale number, and the last-available rule degrades gracefully.
- **`snapshot_used`** shows which day each figure comes from, so a missing month-end snapshot is visible in the report instead of hidden. Alert when it isn't the calendar month end.
""",
    steps=[
        Step("Last available", "The rows on each month's last available snapshot date are kept.",
             tables=[Show("snapshots", "SELECT *, CASE WHEN snapshot_date = MAX(snapshot_date) OVER (PARTITION BY date_trunc('month', snapshot_date), store) THEN 'keep' ELSE 'drop' END AS _mark FROM fact_inventory_snapshot ORDER BY 1, 3")]),
        Step("Calendar month end", "Joining to the calendar's last day finds nothing for February, so the month vanishes.",
             tables=[Show("calendar-month-end version", "SELECT CAST(date_trunc('month', s.snapshot_date) AS DATE) AS month, s.store, SUM(s.on_hand) AS month_end_on_hand FROM fact_inventory_snapshot s WHERE s.snapshot_date = last_day(s.snapshot_date) GROUP BY ALL ORDER BY 1")]),
    ],
    trace_alt="Two steps: the snapshot rows, keeping each month's last available date; the calendar-month-end version, which returns January only because 28 February is missing.",
    check="Grain: one row per month and store. NULL: a month with no snapshots at all still disappears; join to a month spine if the report must show it.",
)

q33 = Q(
    id="q33",
    title="An accumulating snapshot of order fulfilment",
    level="Hard",
    pattern="Accumulating snapshot",
    prompt="""
`fact_order_fulfillment` has one row per order and a date column per milestone, filled in as the order progresses. Stamp the **shipped** date from today's `shipping_events`, then report the average days from order to delivery and the share of orders delivered.
""",
    setup="""
CREATE TABLE fact_order_fulfillment (order_id VARCHAR PRIMARY KEY, ordered_date DATE, shipped_date DATE, delivered_date DATE);
INSERT INTO fact_order_fulfillment VALUES
    ('SO-1', DATE '2025-03-01', DATE '2025-03-02', DATE '2025-03-05'),
    ('SO-2', DATE '2025-03-02', NULL, NULL),
    ('SO-3', DATE '2025-03-03', DATE '2025-03-04', DATE '2025-03-10');
CREATE TABLE shipping_events (order_id VARCHAR, ship_ts TIMESTAMP);
INSERT INTO shipping_events VALUES ('SO-2', TIMESTAMP '2025-03-06 14:00');
""",
    show=["fact_order_fulfillment", "shipping_events"],
    answer="""
MERGE INTO fact_order_fulfillment t
USING (SELECT order_id, MIN(CAST(ship_ts AS DATE)) AS ship_date FROM shipping_events GROUP BY order_id) s
   ON t.order_id = s.order_id
WHEN MATCHED AND t.shipped_date IS NULL THEN UPDATE SET shipped_date = s.ship_date;

SELECT
    ROUND(AVG(datediff('day', ordered_date, delivered_date)), 1)          AS avg_days_to_deliver,
    ROUND(100.0 * COUNT(delivered_date) / COUNT(*), 1)                     AS pct_delivered
FROM fact_order_fulfillment;
""",
    hint="Unlike other facts, this one is updated as orders move. And which rows should an average of 'days to deliver' include?",
    explain="""
- **An accumulating snapshot** has one row per process instance (an order) with a date per milestone. Rows are **updated** as milestones happen, unlike transaction facts, which only receive inserts.
- **The `MERGE` source is grouped per order**, so two shipping events for one order can't make the merge nondeterministic (Q10), and `MIN` keeps the first shipment.
- **`AND t.shipped_date IS NULL`** stamps a milestone once and never overwrites it, which makes the statement safe to re-run with the same events.
- **`AVG(datediff(…))`** skips SO-2, because its `delivered_date` is NULL and so is the difference. That's correct: an undelivered order has no delivery time yet. The share delivered uses `COUNT(delivered_date)` (non-NULL only) over `COUNT(*)`.
- The payoff of the design: lag between any two milestones is a single subtraction.
""",
    diff=("fact_order_fulfillment", "order_id"),
    check="Grain: one row per order, updated in place. Run twice: the `IS NULL` guard makes the stamp idempotent. NULL: open milestones are NULL, and the averages correctly leave them out.",
)

q34 = Q(
    id="q34",
    title="Drill across two facts without fanning out",
    level="Medium",
    pattern="Conformed dimensions",
    prompt="""
`fact_sales` and `fact_returns` share the conformed `dim_product` and a month. Report net revenue after refunds per category and month. Explain why joining the two facts directly gives the wrong answer.
""",
    setup="""
CREATE TABLE dim_product (product_sk INT, category VARCHAR);
INSERT INTO dim_product VALUES (100, 'Accessories'), (101, 'Displays');
CREATE TABLE fact_sales (month DATE, product_sk INT, net_amount DECIMAL(10,2));
INSERT INTO fact_sales VALUES (DATE '2025-03-01', 100, 100.00), (DATE '2025-03-01', 100, 50.00), (DATE '2025-03-01', 101, 300.00);
CREATE TABLE fact_returns (month DATE, product_sk INT, refund_amount DECIMAL(10,2));
INSERT INTO fact_returns VALUES (DATE '2025-03-01', 100, 20.00), (DATE '2025-03-01', 100, 10.00), (DATE '2025-04-01', 101, 300.00);
""",
    show=["fact_sales", "fact_returns"],
    answer="""
WITH sales AS (
    SELECT p.category, s.month, SUM(s.net_amount) AS revenue
    FROM fact_sales s JOIN dim_product p USING (product_sk)
    GROUP BY ALL
),
returns AS (
    SELECT p.category, r.month, SUM(r.refund_amount) AS refunds
    FROM fact_returns r JOIN dim_product p USING (product_sk)
    GROUP BY ALL
)
SELECT
    COALESCE(s.category, r.category)               AS category,
    COALESCE(s.month, r.month)                     AS month,
    COALESCE(s.revenue, 0)                         AS revenue,
    COALESCE(r.refunds, 0)                         AS refunds,
    COALESCE(s.revenue, 0) - COALESCE(r.refunds, 0) AS net_after_refunds
FROM sales s
FULL OUTER JOIN returns r ON r.category = s.category AND r.month = s.month
ORDER BY month, category;
""",
    hint="Bring each fact to the shared grain on its own first, then combine the results.",
    explain="""
- **Aggregate each fact separately** to the shared grain (category, month), then join the two results. This is **drill-across**, and it works because both facts use the same, *conformed* product dimension and calendar.
- **Joining the facts directly** matches every sale row with every return row of the same product: the Accessories sales ($150 in two rows) meet two refunds, so revenue is counted twice and refunds twice (step 2).
- **`FULL OUTER JOIN`** keeps a category-month that has sales but no returns (Displays in March) and one with returns but no sales (Displays in April, a return of an earlier sale).
- **`COALESCE(…, 0)` before subtracting**, because revenue minus a missing refund total would otherwise be NULL.
""",
    steps=[
        Step("Direct join", "Joining the facts row to row pairs every sale with every refund for the product.",
             tables=[Show("fact_sales JOIN fact_returns", "SELECT s.month, s.product_sk, s.net_amount, r.refund_amount, 'bad' AS _mark FROM fact_sales s JOIN fact_returns r ON r.product_sk = s.product_sk AND r.month = s.month ORDER BY 1, 2, 3")]),
        Step("Totals", "Accessories in March: the direct join doubles both sides; drill-across gets 150 − 30.",
             tables=[Show("direct join (wrong)", "SELECT p.category, s.month, SUM(s.net_amount) AS revenue, SUM(r.refund_amount) AS refunds, 'bad' AS _mark FROM fact_sales s JOIN fact_returns r ON r.product_sk = s.product_sk AND r.month = s.month JOIN dim_product p ON p.product_sk = s.product_sk GROUP BY ALL"),
                     Show("drill-across (right)", "WITH sales AS (SELECT p.category, s.month, SUM(s.net_amount) AS revenue FROM fact_sales s JOIN dim_product p USING (product_sk) GROUP BY ALL), returns AS (SELECT p.category, r.month, SUM(r.refund_amount) AS refunds FROM fact_returns r JOIN dim_product p USING (product_sk) GROUP BY ALL) SELECT COALESCE(s.category, r.category) AS category, COALESCE(s.month, r.month) AS month, COALESCE(s.revenue, 0) AS revenue, COALESCE(r.refunds, 0) AS refunds, 'keep' AS _mark FROM sales s FULL OUTER JOIN returns r ON r.category = s.category AND r.month = s.month ORDER BY 2, 1")]),
    ],
    trace_alt="Two steps: the direct join pairing each Accessories sale with each refund; the totals, where the direct join shows revenue 300 and refunds 60 for Accessories in March, while drill-across shows 150 and 30.",
    check="Grain: never join two facts at their own grains; meet at a shared, coarser grain. NULL: `COALESCE` each side to 0 after the `FULL OUTER JOIN`.",
)

# ------------------------------------------------------------------ quality and serving

q35 = Q(
    id="q35",
    title="A quality gate before publishing",
    level="Hard",
    pattern="Data quality assertions",
    prompt="""
Before `fact_sales` is published, return **every** violation of three rules in one query: the grain `(order_id, line_no)` is unique, `net_amount` is not negative, and every `product_sk` exists in `dim_product`. An empty result means the gate passes.
""",
    setup="""
CREATE TABLE dim_product (product_sk INT);
INSERT INTO dim_product VALUES (-1), (100), (101);
CREATE TABLE fact_sales (order_id VARCHAR, line_no INT, product_sk INT, net_amount DECIMAL(10,2));
INSERT INTO fact_sales VALUES
    ('SO-1', 1, 100, 49.98), ('SO-1', 2, 101, 79.00),
    ('SO-2', 1, 100, 15.00), ('SO-2', 1, 100, 15.00),
    ('SO-3', 1, 101, -5.00),
    ('SO-4', 1, 555, 20.00);
""",
    show=["fact_sales"],
    answer="""
SELECT 'DUPLICATE_GRAIN' AS rule, order_id, line_no, COUNT(*) AS rows_found
FROM fact_sales
GROUP BY order_id, line_no
HAVING COUNT(*) > 1

UNION ALL
SELECT 'NEGATIVE_NET', order_id, line_no, 1
FROM fact_sales
WHERE net_amount < 0

UNION ALL
SELECT 'ORPHAN_PRODUCT', order_id, line_no, 1
FROM fact_sales f
WHERE NOT EXISTS (SELECT 1 FROM dim_product d WHERE d.product_sk = f.product_sk)

ORDER BY rule, order_id;
""",
    hint="Write each rule as a query that returns the rows breaking it, then stack them.",
    explain="""
- **Each `UNION ALL` branch is one assertion**, written as "return the rows that break it", and labelled so a failure says which rule broke and where.
- **Uniqueness:** `GROUP BY` the grain, `HAVING COUNT(*) > 1`. This is the test that stands in for the primary key Snowflake doesn't enforce.
- **Business rule:** `net_amount < 0`.
- **Referential integrity:** `NOT EXISTS` against the dimension, never `NOT IN` (Q14).
- **How a pipeline uses it:** load into a staging copy, run the gate, and only if it returns nothing swap the staging table in (or merge it into the published table). If it returns rows, fail the run and report them. It's far cheaper to block here than to explain a wrong dashboard later. This is what dbt tests and similar tools generate for you.
""",
    check="Grain: the gate checks it. Run twice: read-only. NULL: a NULL `net_amount` passes `< 0` and a NULL `order_id` groups as one key; add explicit `IS NULL` rules if those matter.",
)

q36 = Q(
    id="q36",
    title="Reconcile the fact against its source",
    level="Hard",
    pattern="Reconciliation",
    prompt="""
Per day, compare `SUM(net_amount)` in `fact_sales` with the same total recomputed from `src_order_line`, and return only the days that differ by more than one cent, including days that exist on only one side. Then explain why matching row counts would not have been enough.
""",
    setup="""
CREATE TABLE src_order_line (order_date DATE, order_id VARCHAR, line_no INT, quantity INT, unit_price DECIMAL(10,2), discount_amt DECIMAL(10,2));
INSERT INTO src_order_line VALUES
    (DATE '2025-03-01', 'SO-1', 1, 2, 24.99, 0.00), (DATE '2025-03-01', 'SO-1', 2, 1, 89.00, 10.00),
    (DATE '2025-03-02', 'SO-2', 1, 3, 5.00, 0.00),
    (DATE '2025-03-03', 'SO-3', 1, 1, 30.00, 0.00);
CREATE TABLE fact_sales (sale_date DATE, order_id VARCHAR, line_no INT, net_amount DECIMAL(10,2));
INSERT INTO fact_sales VALUES
    (DATE '2025-03-01', 'SO-1', 1, 49.98), (DATE '2025-03-01', 'SO-1', 2, 69.00),
    (DATE '2025-03-02', 'SO-2', 1, 15.00);
""",
    show=["src_order_line", "fact_sales"],
    answer="""
WITH fact_daily AS (
    SELECT sale_date AS d, SUM(net_amount) AS fact_net, COUNT(*) AS fact_rows
    FROM fact_sales GROUP BY sale_date
),
src_daily AS (
    SELECT order_date AS d,
           SUM(quantity * unit_price - COALESCE(discount_amt, 0)) AS src_net,
           COUNT(*) AS src_rows
    FROM src_order_line GROUP BY order_date
)
SELECT COALESCE(f.d, s.d) AS d, s.src_rows, f.fact_rows, s.src_net, f.fact_net,
       COALESCE(f.fact_net, 0) - COALESCE(s.src_net, 0) AS diff
FROM fact_daily f
FULL OUTER JOIN src_daily s ON s.d = f.d
WHERE ABS(COALESCE(f.fact_net, 0) - COALESCE(s.src_net, 0)) > 0.01
ORDER BY d;
""",
    hint="Compute the same total two ways, line them up by day, and keep a day that appears on only one side.",
    explain="""
- **Two CTEs compute the same measure two ways:** from the published fact, and from the source with the same business rule. That is a **control total**.
- **`FULL OUTER JOIN` on the day** surfaces a day missing from the fact (3 March was never loaded) as well as a day the source doesn't know.
- **`> 0.01`** is the tolerance for rounding, so only material differences are reported.
- **Why counts aren't enough:** 1 March has two rows on both sides, so a row-count check passes, but the fact's line 2 holds 69.00 where the source says 79.00 (the $10 discount was applied twice). Counts catch missing and duplicated rows; sums catch wrong values. Mature pipelines check both.
""",
    check="Grain: one row per day with a discrepancy. Run twice: read-only. NULL: a day missing on one side gives NULL totals, so `COALESCE` before subtracting, or the missing day is filtered out by the `WHERE`.",
)

q37 = Q(
    id="q37",
    title="Top three categories per month, with subtotals",
    level="Hard",
    pattern="Top-N with GROUPING SETS",
    prompt="""
For each month, return the **top three categories** by revenue, a subtotal row for the month (all categories, not just the top three), and one grand-total row, in a single query.
""",
    setup="""
CREATE TABLE v_sales_mart (month DATE, category VARCHAR, net_amount DECIMAL(10,2));
INSERT INTO v_sales_mart VALUES
    (DATE '2025-03-01', 'Accessories', 500), (DATE '2025-03-01', 'Displays', 900),
    (DATE '2025-03-01', 'Audio', 300), (DATE '2025-03-01', 'Cables', 100),
    (DATE '2025-04-01', 'Accessories', 200), (DATE '2025-04-01', 'Displays', 400),
    (DATE '2025-04-01', 'Audio', 700), (DATE '2025-04-01', 'Cables', 250);
""",
    show=["v_sales_mart"],
    answer="""
WITH rolled AS (
    SELECT month, category, SUM(net_amount) AS revenue,
           GROUPING(month)    AS g_month,
           GROUPING(category) AS g_cat
    FROM v_sales_mart
    GROUP BY GROUPING SETS ((month, category), (month), ())
),
ranked AS (
    SELECT *,
           ROW_NUMBER() OVER (PARTITION BY month, g_cat ORDER BY revenue DESC) AS rnk
    FROM rolled
)
SELECT
    CASE WHEN g_month = 1 THEN 'GRAND TOTAL' ELSE CAST(month AS VARCHAR) END AS month,
    CASE WHEN g_cat = 1 THEN 'ALL' ELSE category END                        AS category,
    revenue
FROM ranked
WHERE g_cat = 1 OR rnk <= 3
ORDER BY g_month, ranked.month, g_cat, revenue DESC;
""",
    hint="`GROUPING SETS` gives you all three levels in one pass. When you rank, make sure the subtotal rows aren't competing with the categories.",
    explain="""
- **`GROUPING SETS ((month, category), (month), ())`** computes per-category rows, a subtotal per month and the grand total in one scan; three `UNION ALL` queries would scan the data three times.
- **`GROUPING(col)`** returns 1 on rows where that column was rolled up, which tells a subtotal apart from a category that is genuinely NULL.
- **`PARTITION BY month, g_cat` is the fix.** The obvious `PARTITION BY month` puts the month's subtotal row in the same ranking as its categories. The subtotal is always the largest number, so it takes rank 1 and pushes the real third category out: the query returns the top **two** (step 2). Partitioning by `g_cat` as well ranks categories only against categories.
- **`WHERE g_cat = 1 OR rnk <= 3`** keeps every subtotal and total row, and the top three categories.
- The subtotal sums *all* categories (March: 1,800, including Cables), which is usually what a report means by "month total". If you want the total of only the top three, compute it after filtering.
""",
    steps=[
        Step("Rolled up", "GROUPING SETS produces the category rows, a subtotal per month and a grand total.",
             tables=[Show("rolled", "SELECT month, category, SUM(net_amount) AS revenue, GROUPING(month) AS g_month, GROUPING(category) AS g_cat, CASE WHEN GROUPING(category) = 1 THEN 'hit' END AS _mark FROM v_sales_mart GROUP BY GROUPING SETS ((month, category), (month), ()) ORDER BY g_month, month, g_cat, revenue DESC")]),
        Step("The bug", "Ranking with PARTITION BY month alone: the subtotal takes rank 1, so only two categories survive per month.",
             tables=[Show("PARTITION BY month", "WITH rolled AS (SELECT month, category, SUM(net_amount) AS revenue, GROUPING(category) AS g_cat FROM v_sales_mart GROUP BY GROUPING SETS ((month, category), (month), ())) SELECT month, category, revenue, ROW_NUMBER() OVER (PARTITION BY month ORDER BY revenue DESC) AS rnk, CASE WHEN g_cat = 1 THEN 'bad' WHEN ROW_NUMBER() OVER (PARTITION BY month ORDER BY revenue DESC) = 4 THEN 'drop' END AS _mark FROM rolled WHERE month IS NOT NULL ORDER BY month, rnk")]),
        Step("Fixed", "Partitioning by month and g_cat ranks categories only against each other.",
             tables=[Show("result", "WITH rolled AS (SELECT month, category, SUM(net_amount) AS revenue, GROUPING(month) AS g_month, GROUPING(category) AS g_cat FROM v_sales_mart GROUP BY GROUPING SETS ((month, category), (month), ())), ranked AS (SELECT *, ROW_NUMBER() OVER (PARTITION BY month, g_cat ORDER BY revenue DESC) AS rnk FROM rolled) SELECT CASE WHEN g_month = 1 THEN 'GRAND TOTAL' ELSE CAST(month AS VARCHAR) END AS month, CASE WHEN g_cat = 1 THEN 'ALL' ELSE category END AS category, revenue, CASE WHEN g_cat = 1 THEN 'hit' ELSE 'keep' END AS _mark FROM ranked WHERE g_cat = 1 OR rnk <= 3 ORDER BY g_month, ranked.month, g_cat, revenue DESC")]),
    ],
    trace_alt="Three steps: the rolled-up rows with subtotals; the buggy ranking where each month's subtotal takes rank 1 and the third category is lost; and the fixed result with the top three categories, a subtotal per month and a grand total.",
    check="Grain: mixed on purpose (category rows, subtotals, a total), so label each row's level clearly for consumers. NULL: rolled-up columns are NULL; use `GROUPING()` rather than `IS NULL` to detect them.",
)


INTRO = f"""
ShopWave is an online retailer whose orders, product catalog and customer records feed a warehouse. This post builds that warehouse as a **Kimball star schema**: a sales fact at order-line grain, dimensions with surrogate keys and history, and the loads, checks and reports around them. Each question uses small, self-contained tables, so you can run any of them on its own.

{series_callout(SLUG)}

The post covers five areas:

- Modeling the star: grain, SCD scaffolding, staging and change detection
- Keeping history: SCD Types 1, 2 and 3, and point-in-time lookups
- Loading facts: Unknown members, measure types, watermarks, reloads and late-arriving dimensions
- Other fact types: factless, bridge, periodic and accumulating snapshots, drill-across
- Quality and serving: a pre-publish gate, reconciliation, and a top-N report with subtotals

## How to use this post

{HOW_TO_READ.strip()} Every answer ends with an **Engineer check**: the grain, what happens if it runs twice, and what NULL does. The [first post](/blog/de-sql-foundations#how-the-answers-are-checked) explains how the answers were run and checked.

![The ShopWave star schema: fact_sales at order-line grain in the middle, with surrogate keys to dim_date, dim_customer (SCD Type 2 with a validity window), dim_product (SCD Types 1 and 3, inferred members) and dim_store, each with a -1 Unknown member, plus the other facts in this post: returns, inventory snapshots, order fulfilment and promotion coverage](/images/data-engineering/de-sql/de-sql-dimensional-warehouse/star-schema.svg)
"""

OUTRO = """
## Summary

A dimensional warehouse is a set of promises, and each question here is one of them. The fact table promises a grain, so every load either replaces a partition or merges on the grain. Dimensions promise history: SCD2 closes one window the day before the next opens, and facts pick the version valid when they happened. Missing keys never become NULL; they become the Unknown member, or an inferred member that's filled in later without touching the facts. Measures promise to add up, which holds only if you know which ones are additive, split many-to-many relationships with weights, and never join two facts directly. And before anything is published, a gate checks the promises, and a reconciliation checks the money.

![A map of this post in five columns. Model: grain, SCD scaffolding with an Unknown member, clean staging and a NULL-safe hash. History: Type 1 overwrite, Type 2 expire-then-insert, Type 3 previous value, as-of joins. Load: Unknown routing, additivity, a race-free watermark, partition reloads, inferred members. Fact types: factless, bridge with weights, periodic and accumulating snapshots, drill-across. Quality: a pre-publish gate, a control-total reconciliation and top-N with subtotals](/images/data-engineering/de-sql/de-sql-dimensional-warehouse/summary-map.svg)

### Concepts at a glance

| Concept | In one line | Why it matters |
| --- | --- | --- |
| **Grain** | What one fact row represents | Every load, join and sum has to respect it |
| **Unknown member (`-1`)** | The row facts point at when a key is missing | Totals stay complete and visible |
| **NULL-safe hash** | Separator plus a NULL placeholder, then `md5` | Change detection without false matches |
| **SCD Type 1 / 2 / 3** | Overwrite / new row per version / one previous value | Corrections vs history vs "current vs previous" |
| **Point-in-time join** | Match the version whose window contains the event date | Reports show what was true when it happened |
| **Additivity** | Additive, semi-additive, non-additive | Stock isn't summed over time; ratios are recomputed |
| **Race-free watermark** | Fix the upper bound, load `(lower, upper]`, advance with `COALESCE` | No skipped rows, and empty runs are safe |
| **Partition reload** | Delete the day, insert the day, in one transaction | Handles deletions that `MERGE` can't see |
| **Inferred member** | A placeholder with the real natural key | Late dimensions fill in without fact updates |
| **Bridge with weights** | Split a value across many-to-many links | Totals don't inflate |
| **Drill-across** | Aggregate each fact, then join on conformed dimensions | Two facts never fan each other out |
| **Quality gate and control totals** | Assertions that must return nothing; sums compared with the source | Problems are stopped before anyone sees them |

### Test yourself

<details>
<summary>Why does an SCD2 load set the old row's `effective_to` to the load date minus one?</summary>

So the windows are contiguous and never overlap: the old version ends the day before the new one starts. A point-in-time join then finds exactly one version for any date.

</details>

<details>
<summary>An empty incremental run sets the watermark to `GREATEST(old_watermark, MAX(_loaded_at))`. What goes wrong in Snowflake?</summary>

`MAX` over no rows is NULL, and Snowflake's `GREATEST` returns NULL if any argument is NULL, so the watermark becomes NULL and the next run's `> NULL` filter never matches again. Use `COALESCE(MAX(...), old_watermark)` or `GREATEST_IGNORE_NULLS`.

</details>

<details>
<summary>A source can delete rows. Why is a `MERGE` on the grain not enough to reload a day?</summary>

A deleted row isn't in the source any more, so it never matches anything and stays in the fact. Deleting the whole day and inserting it again removes it.

</details>

<details>
<summary>An order has two coupons. How do you report revenue per coupon without inflating the total?</summary>

Use a bridge table with a weight per coupon that sums to 1 per order (0.5 each here), and sum `net_amount × weight`.

</details>

<details>
<summary>Why does ranking categories with `PARTITION BY month` lose a category when the input has `GROUPING SETS` subtotals?</summary>

The month's subtotal row is in the same partition and is always the largest, so it takes rank 1. Partition by the `GROUPING()` flag as well.

</details>

## Sources

- Kimball Group: [dimensional modeling techniques](https://www.kimballgroup.com/data-warehouse-business-intelligence-resources/kimball-techniques/dimensional-modeling-techniques/) (grain, SCD types, factless facts, bridge tables, snapshots, conformed dimensions)
- Snowflake: [MERGE](https://docs.snowflake.com/en/sql-reference/sql/merge), [GREATEST](https://docs.snowflake.com/en/sql-reference/functions/greatest) and [GREATEST_IGNORE_NULLS](https://docs.snowflake.com/en/sql-reference/functions/greatest_ignore_nulls), [CONCAT_WS](https://docs.snowflake.com/en/sql-reference/functions/concat_ws), [QUALIFY](https://docs.snowflake.com/en/sql-reference/constructs/qualify), [constraints and join elimination](https://docs.snowflake.com/en/user-guide/join-elimination)
- DuckDB: [MERGE INTO](https://duckdb.org/docs/current/sql/statements/merge_into), [GROUPING SETS](https://duckdb.org/docs/stable/sql/query_syntax/grouping_sets)
- PostgreSQL: [identity columns](https://www.postgresql.org/docs/current/sql-createtable.html)
"""

POST = Post(
    slug=SLUG,
    title="SQL for Data Engineers: Building a Dimensional Warehouse",
    description="Part 2 of a data engineering SQL practice bank: a retail star schema built question by question, with grain, SCD Types 1 to 3, point-in-time joins, race-free watermarks, partition reloads, inferred members, bridge tables, snapshots and quality gates. Every answer is run on real sample data.",
    order=2,
    tags=["Data Engineering", "SQL", "Practice", "Data Modeling"],
    intro=INTRO,
    groups=[
        Group("Modeling the star", "Before any load, decide what a row means and how each dimension will keep its history.", [q16, q17, q18, q19, q20]),
        Group("Keeping history", "Three ways a dimension can respond to change, and the join that reads history back correctly.", [q21, q22, q23]),
        Group("Loading facts", "Loading the sales fact so that missing keys, late rows, retries and corrections can't corrupt it.", [q24, q25, q26, q27, q28, q29]),
        Group("Other kinds of fact", "Not every fact is a row per transaction. These record conditions, many-to-many links, balances and processes.", [q30, q31, q32, q33, q34]),
        Group("Quality and serving", "Checking the warehouse before anyone reads it, and one report that is easy to get subtly wrong.", [q35, q36, q37]),
    ],
    outro=OUTRO,
)
