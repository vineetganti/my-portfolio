from build import Group, Post, Q, Show, Step
from posts.common import HOW_TO_READ, series_callout

SLUG = "de-sql-foundations"

# ------------------------------------------------------------------ DDL

q1 = Q(
    id="q01",
    title="Create a typed table with constraints",
    level="Easy",
    pattern="DDL and constraints",
    prompt="""
Create a `customers` table for an e-commerce source system:

- `customer_sk`: an integer surrogate key filled by the database.
- `customer_code`: the business key, required and unique.
- `email`: required.
- `country_code`: exactly two characters.
- `credit_limit`: money, defaulting to 0, never negative.
- `created_at`: a timestamp that defaults to the time of the insert.

Then say which of these rules a cloud warehouse will actually stop a bad row for.
""",
    setup="",
    answer="""
CREATE SEQUENCE customer_seq START 1;

CREATE TABLE customers (
    customer_sk   INTEGER       PRIMARY KEY DEFAULT nextval('customer_seq'),
    customer_code VARCHAR(50)   NOT NULL UNIQUE,
    email         VARCHAR(255)  NOT NULL,
    country_code  CHAR(2),
    credit_limit  DECIMAL(12,2) NOT NULL DEFAULT 0,
    created_at    TIMESTAMP     NOT NULL DEFAULT current_timestamp,
    CONSTRAINT chk_credit_nonneg CHECK (credit_limit >= 0)
);
""",
    display="""
CREATE TABLE customers (
    customer_sk   NUMBER        AUTOINCREMENT PRIMARY KEY,   -- Postgres: INT GENERATED ALWAYS AS IDENTITY
    customer_code VARCHAR(50)   NOT NULL UNIQUE,
    email         VARCHAR(255)  NOT NULL,
    country_code  CHAR(2),
    credit_limit  NUMBER(12,2)  NOT NULL DEFAULT 0,
    created_at    TIMESTAMP_NTZ NOT NULL DEFAULT CURRENT_TIMESTAMP(),
    CONSTRAINT chk_credit_nonneg CHECK (credit_limit >= 0)
);
""",
    show_expected=False,
    hint="Every rule is a column constraint except the non-negative limit, which is a named `CHECK`. For the second part, look up which constraint types your warehouse enforces on standard tables.",
    explain="""
- `customer_sk … DEFAULT nextval('customer_seq')` makes the database fill the surrogate key. Snowflake spells it `AUTOINCREMENT` (or `IDENTITY`), Postgres `GENERATED ALWAYS AS IDENTITY`. A `PRIMARY KEY` implies `NOT NULL` and `UNIQUE`.
- `customer_code … NOT NULL UNIQUE` declares the business key as an alternate key, which later loads use for lookups and dedup.
- `DECIMAL(12,2)` stores money exactly. Never use `FLOAT` for currency: binary floating point can't represent 0.10 exactly, and sums drift.
- `DEFAULT 0` and `DEFAULT current_timestamp` fill columns an insert leaves out.
- `CONSTRAINT chk_credit_nonneg CHECK (…)` names the rule, so the error message tells you which rule broke.

**Which rules are enforced depends on the engine.** DuckDB and Postgres enforce all of them, as the step-through shows. Snowflake does **not** enforce `PRIMARY KEY`, `UNIQUE` or `FOREIGN KEY` on standard tables: they are metadata for modeling and the optimizer ([Snowflake docs](https://docs.snowflake.com/en/user-guide/join-elimination)). It does enforce `NOT NULL`, and since the April 2026 release it also enforces `CHECK` constraints ([release notes](https://docs.snowflake.com/en/release-notes/2026/10_12)). So on Snowflake a duplicate `customer_code` loads silently, and your pipeline has to test for it (Q14 and post 02's quality gate).
""",
    steps=[
        Step("Create", "The table is created and two valid rows go in. The second omits credit_limit, so the default 0 fills it.",
             run="""CREATE SEQUENCE customer_seq START 1;
CREATE TABLE customers (customer_sk INTEGER PRIMARY KEY DEFAULT nextval('customer_seq'), customer_code VARCHAR(50) NOT NULL UNIQUE, email VARCHAR(255) NOT NULL, country_code CHAR(2), credit_limit DECIMAL(12,2) NOT NULL DEFAULT 0, created_at TIMESTAMP NOT NULL DEFAULT current_timestamp, CONSTRAINT chk_credit_nonneg CHECK (credit_limit >= 0));
INSERT INTO customers (customer_code, email, country_code, credit_limit) VALUES ('C-001', 'ana@example.com', 'US', 500);
INSERT INTO customers (customer_code, email, country_code) VALUES ('C-002', 'raj@example.com', 'IN');""",
             tables=[Show("customers", "SELECT customer_sk, customer_code, email, country_code, credit_limit, created_at IS NOT NULL AS created_at_filled, 'new' AS _mark FROM customers ORDER BY 1")]),
        Step("Negative limit", "A row with credit_limit = -50 is rejected by the CHECK constraint.",
             error="INSERT INTO customers (customer_code, email, credit_limit) VALUES ('C-003', 'li@example.com', -50)"),
        Step("Duplicate key", "A second C-001 is rejected by UNIQUE. On Snowflake this row would load.",
             error="INSERT INTO customers (customer_code, email) VALUES ('C-001', 'other@example.com')"),
        Step("Missing email", "A NULL email is rejected by NOT NULL, which every engine enforces.",
             error="INSERT INTO customers (customer_code, email) VALUES ('C-004', NULL)"),
    ],
    trace_alt="Four steps: two valid inserts succeed, then a negative credit limit, a duplicate customer code and a missing email are each rejected with the engine's error message.",
    check="Grain: one row per customer, guaranteed by the unique business key only where the engine enforces it. Run twice: `CREATE TABLE` fails the second time, so deployment scripts use `CREATE TABLE IF NOT EXISTS` or versioned migrations. NULL: `NOT NULL` is the one rule every engine enforces, so it's the cheapest quality check you have.",
)

q2 = Q(
    id="q02",
    title="DROP, TRUNCATE or DELETE",
    level="Easy",
    pattern="DDL vs DML",
    prompt="""
Write one statement for each job and say whether it is DDL or DML:

1. Empty the staging table `stg_orders` before a full reload, keeping the table.
2. Remove only the 2025-03-26 rows from `app_log`.
3. Remove the obsolete table `deprecated_table` completely.
""",
    setup="""
CREATE TABLE stg_orders (order_id INT, amount DECIMAL(10,2));
INSERT INTO stg_orders VALUES (1, 20.00), (2, 35.50), (3, 12.00);

CREATE TABLE app_log (log_id INT, log_date DATE, message VARCHAR);
INSERT INTO app_log VALUES
    (1, DATE '2025-03-25', 'start'),
    (2, DATE '2025-03-26', 'retry'),
    (3, DATE '2025-03-26', 'fail'),
    (4, DATE '2025-03-27', 'ok');

CREATE TABLE deprecated_table (id INT);
""",
    show=["stg_orders", "app_log"],
    answer="""
TRUNCATE TABLE stg_orders;                               -- DDL: empty it, keep it

DELETE FROM app_log WHERE log_date = DATE '2025-03-26';  -- DML: filtered row removal

DROP TABLE deprecated_table;                             -- DDL: rows and definition gone
""",
    result="""
SELECT 'stg_orders' AS table_name, (SELECT count(*) FROM stg_orders) AS rows_left
UNION ALL SELECT 'app_log', (SELECT count(*) FROM app_log)
UNION ALL SELECT 'deprecated_table', (SELECT count(*) FROM information_schema.tables WHERE table_name = 'deprecated_table')
""",
    expected_title="Expected state (`rows_left` for deprecated_table counts whether the table still exists)",
    hint="Only one of the three jobs needs a `WHERE` clause, and only one removes the table's definition.",
    explain="""
- `TRUNCATE TABLE` removes every row in one operation and keeps the table, its columns and grants. It can't take a `WHERE`. It's classed as DDL because it works on the table's storage, not row by row.
- `DELETE … WHERE` is DML: it removes only the rows that match, and it can be rolled back inside a transaction.
- `DROP TABLE` removes the rows **and** the definition. Snowflake keeps dropped tables for its Time Travel period, so `UNDROP TABLE` can bring one back ([docs](https://docs.snowflake.com/en/sql-reference/sql/undrop-table)); most engines can't.

The trap is reaching for `DELETE FROM stg_orders` (no `WHERE`) to empty a staging table. It works, but it is the slow, logged path, and on a large table `TRUNCATE` is the right tool.
""",
    steps=[
        Step("Input", "Three tables before the statements run.", tables=[Show("stg_orders", "SELECT * FROM stg_orders"), Show("app_log", "SELECT * FROM app_log")]),
        Step("TRUNCATE", "stg_orders keeps its definition but loses every row.", run="TRUNCATE TABLE stg_orders",
             tables=[Show("stg_orders", "SELECT * FROM stg_orders")]),
        Step("DELETE", "Only the two 2025-03-26 rows leave app_log.",
             tables=[Show("app_log", "SELECT *, CASE WHEN log_date = DATE '2025-03-26' THEN 'drop' END AS _mark FROM app_log")]),
        Step("After DELETE", "The other days are untouched.", run="DELETE FROM app_log WHERE log_date = DATE '2025-03-26'",
             tables=[Show("app_log", "SELECT * FROM app_log")]),
        Step("DROP", "deprecated_table no longer exists, so selecting from it fails.", run="DROP TABLE deprecated_table",
             error="SELECT * FROM deprecated_table"),
    ],
    trace_alt="Five steps: the input tables, stg_orders emptied by TRUNCATE, the two 2025-03-26 rows highlighted and then deleted from app_log, and a select on the dropped table failing.",
    check="Run twice: `TRUNCATE` and the `DELETE` are harmless the second time, but `DROP TABLE` errors, so scripts write `DROP TABLE IF EXISTS`. NULL: a `DELETE … WHERE log_date = …` never removes rows whose `log_date` is NULL, which is usually what you want, but worth knowing.",
)

q3 = Q(
    id="q03",
    title="Evolve a schema without breaking a re-run",
    level="Easy",
    pattern="Schema evolution",
    prompt="""
An upstream team added a loyalty tier. Change `customers` so that:

- a `loyalty_tier VARCHAR(10)` column exists, defaulting to `'BRONZE'` for existing and new rows,
- the column `phone` is renamed to `phone_e164`,
- the obsolete `fax` column is gone.

Write it so the add and the drop can be run again safely by a deployment pipeline.
""",
    setup="""
CREATE TABLE customers (customer_sk INT, customer_code VARCHAR, phone VARCHAR, fax VARCHAR);
INSERT INTO customers VALUES
    (1, 'C-001', '+14155550101', NULL),
    (2, 'C-002', '+919800000002', '+919800000099');
""",
    show=["customers"],
    answer="""
ALTER TABLE customers ADD COLUMN IF NOT EXISTS loyalty_tier VARCHAR(10) DEFAULT 'BRONZE';
ALTER TABLE customers RENAME COLUMN phone TO phone_e164;
ALTER TABLE customers DROP COLUMN IF EXISTS fax;
""",
    result="SELECT * FROM customers ORDER BY customer_sk",
    hint="Look for the `IF NOT EXISTS` and `IF EXISTS` forms of `ADD COLUMN` and `DROP COLUMN`.",
    explain="""
- `ADD COLUMN … DEFAULT 'BRONZE'` adds the column, and existing rows read the default, as the output shows. On Postgres 11 and later, adding a column with a constant default doesn't rewrite the table ([docs](https://www.postgresql.org/docs/current/sql-altertable.html)).
- `IF NOT EXISTS` / `IF EXISTS` make the add and the drop safe to run again: a second run is a no-op instead of an error. Snowflake, Postgres and DuckDB all accept these forms.
- `RENAME COLUMN` moves no data, but it breaks every downstream query that uses the old name, so it's a coordinated change, not a silent one.
""",
    after="""
<Callout type="warning" title="The rename is the one that can't be re-run">

`RENAME COLUMN` has no `IF EXISTS` guard in most engines: a second run fails because `phone` no longer exists. Real pipelines solve this with versioned migrations (each change runs once, recorded in a migrations table), which is what tools like Flyway, Liquibase and schemachange do.

</Callout>
""",
    diff=("customers", "customer_sk"),
    check="Run twice: the add and drop are idempotent thanks to the guards; the rename is not. NULL: rows that exist when the column is added get the default; a later insert that explicitly writes `NULL` gets NULL, not the default.",
)

q4 = Q(
    id="q04",
    title="Type a raw table, and catch the values that don't parse",
    level="Easy",
    pattern="CTAS and safe casting",
    prompt="""
`raw_orders` arrived from CSV, so every column is text. In one statement, create a typed `stg_orders` with `amount DECIMAL(12,2)` and `order_ts TIMESTAMP`. A malformed value must not abort the load, and the bad rows must be easy to find afterwards.
""",
    setup="""
CREATE TABLE raw_orders (order_id VARCHAR, cust_id VARCHAR, amount_str VARCHAR, ts_str VARCHAR);
INSERT INTO raw_orders VALUES
    ('1001', 'C-001', '19.99',    '2025-03-01 10:00:00'),
    ('1002', 'C-002', '1,250.00', '2025-03-01 11:30:00'),
    ('1003', 'C-001', 'n/a',      '2025-03-02 09:15:00'),
    ('1004', 'C-003', '42.50',    '2025-02-30 08:00:00'),
    ('1005', 'C-004', NULL,       '2025-03-03 14:45:00');
""",
    show=["raw_orders"],
    answer="""
CREATE TABLE stg_orders AS
SELECT
    CAST(order_id AS INT)                     AS order_id,
    cust_id,
    TRY_CAST(amount_str AS DECIMAL(12,2))     AS amount,
    TRY_CAST(ts_str     AS TIMESTAMP)         AS order_ts,
    (amount_str IS NOT NULL AND TRY_CAST(amount_str AS DECIMAL(12,2)) IS NULL)
      OR (ts_str IS NOT NULL AND TRY_CAST(ts_str AS TIMESTAMP) IS NULL)  AS has_parse_error
FROM raw_orders;
""",
    result="SELECT * FROM stg_orders ORDER BY order_id",
    hint="`CAST` fails the whole statement on one bad value. Which variant returns NULL instead? Then: how do you tell a NULL that was in the source from a NULL the cast produced?",
    explain="""
- `CREATE TABLE … AS SELECT` (CTAS) creates and fills the table in one statement; its column types come from the query.
- `TRY_CAST(…)` returns NULL instead of raising an error when a value doesn't parse ([Snowflake docs](https://docs.snowflake.com/en/sql-reference/functions-conversion)). `'1,250.00'` (thousands separator), `'n/a'` and the impossible date `2025-02-30` all become NULL.
- `has_parse_error` is the part most answers forget. After `TRY_CAST`, a NULL `amount` could mean "the source had no amount" (order 1005, fine) or "the source had garbage" (orders 1002 and 1003, a problem). The flag is true only when the source had a value **and** the cast failed, so the bad rows can be counted, quarantined or alerted on.
""",
    after="Order 1002 is the dangerous one: `1,250.00` is a real amount that a stricter parser rejected. A silent `TRY_CAST` without the flag would drop $1,250 of revenue from every report.",
    steps=[
        Step("Input", "Everything is text, including three values that won't parse.", tables=[Show("raw_orders", "SELECT *, CASE WHEN order_id IN ('1002','1003','1004') THEN 'hit' END AS _mark FROM raw_orders")]),
        Step("Typed", "TRY_CAST turned the bad values into NULL, and the flag marks the rows that lost data. Order 1005's NULL came from the source, so it isn't flagged.",
             run="""CREATE TABLE stg_orders AS SELECT CAST(order_id AS INT) AS order_id, cust_id, TRY_CAST(amount_str AS DECIMAL(12,2)) AS amount, TRY_CAST(ts_str AS TIMESTAMP) AS order_ts, (amount_str IS NOT NULL AND TRY_CAST(amount_str AS DECIMAL(12,2)) IS NULL) OR (ts_str IS NOT NULL AND TRY_CAST(ts_str AS TIMESTAMP) IS NULL) AS has_parse_error FROM raw_orders""",
             tables=[Show("stg_orders", "SELECT *, CASE WHEN has_parse_error THEN 'bad' ELSE 'keep' END AS _mark FROM stg_orders ORDER BY order_id")]),
    ],
    check="Run twice: CTAS fails if the table exists; use `CREATE OR REPLACE TABLE` for a staging table that is rebuilt every run. NULL: distinguish a NULL from the source from a NULL produced by a failed cast, or you'll quietly lose data.",
)

q5 = Q(
    id="q05",
    title="An empty load target, and a full copy for testing",
    level="Easy",
    pattern="CTAS, LIKE and CLONE",
    prompt="""
You need two copies of `dim_product`:

1. `dim_product_load`: the same columns, **no rows**, to use as a load target.
2. `dim_product_dev`: the same columns **and** data, for testing a risky change.

Show the portable way, then the Snowflake way, and say what each one does and doesn't copy.
""",
    setup="""
CREATE TABLE dim_product (product_sk INT, product_code VARCHAR, name VARCHAR, list_price DECIMAL(10,2) DEFAULT 0);
INSERT INTO dim_product VALUES (1, 'SKU-001', 'Wireless Mouse', 24.99), (2, 'SKU-002', 'Keyboard', 89.00), (3, 'SKU-003', 'USB Hub', 19.00);
""",
    show=["dim_product"],
    answer="""
-- 1. empty target: a query that returns no rows
CREATE TABLE dim_product_load AS SELECT * FROM dim_product WHERE FALSE;

-- 2. full copy for testing
CREATE TABLE dim_product_dev AS SELECT * FROM dim_product;
""",
    display="""
-- 1. empty target with the same column definitions, defaults and constraints
CREATE TABLE dim_product_load LIKE dim_product;

-- 2. zero-copy clone: instant, shares storage until either side changes
CREATE TABLE dim_product_dev CLONE dim_product;
""",
    result="""
SELECT 'dim_product_load' AS table_name, count(*) AS row_count FROM dim_product_load
UNION ALL SELECT 'dim_product_dev', count(*) FROM dim_product_dev
""",
    hint="A `WHERE` clause that is always false gives you the columns without the rows. On Snowflake, one keyword copies only the structure and another copies the data without moving it.",
    explain="""
- `CREATE TABLE … AS SELECT … WHERE FALSE` gives the right columns and types with zero rows. It does **not** copy defaults or constraints, because CTAS only knows the query's result shape.
- Snowflake's `CREATE TABLE … LIKE` makes an empty table with the column definitions, defaults and constraints ([docs](https://docs.snowflake.com/en/sql-reference/sql/create-table)). That's the better empty target.
- `CLONE` copies the data **without** physically copying it: the clone shares the original's micro-partitions, and the two diverge only as either is changed ([docs](https://docs.snowflake.com/en/sql-reference/sql/create-clone)). It's the right tool for the dev copy, and the wrong one for an empty target, because it brings every row along.
""",
    check="Run twice: both statements fail if the target exists, so use `CREATE OR REPLACE` for throwaway copies. Watch out: a clone of a production table in a dev schema is still production data, so the same access rules apply.",
)

q6 = Q(
    id="q06",
    title="Make an insert survive a schema change",
    level="Easy",
    pattern="DML hygiene",
    prompt="""
This insert ran every night until someone added an `is_active BOOLEAN DEFAULT TRUE` column to `dim_product`:

```sql
INSERT INTO dim_product VALUES (1004, 'SKU-004', 'Webcam', 'Video', 49.00);
```

Explain why it now fails, and rewrite it so it doesn't care about new columns.
""",
    setup="""
CREATE TABLE dim_product (product_sk INT, product_code VARCHAR, name VARCHAR, category VARCHAR, list_price DECIMAL(10,2));
INSERT INTO dim_product VALUES (1001, 'SKU-001', 'Wireless Mouse', 'Accessories', 24.99);
ALTER TABLE dim_product ADD COLUMN is_active BOOLEAN DEFAULT TRUE;
""",
    show=["dim_product"],
    answer="""
INSERT INTO dim_product (product_sk, product_code, name, category, list_price)
VALUES (1004, 'SKU-004', 'Webcam', 'Video', 49.00);
""",
    result="SELECT * FROM dim_product ORDER BY product_sk",
    hint="A `VALUES` list without a column list has to supply every column, in table order.",
    explain="""
- A positional insert must supply a value for **every** column, in the table's order. The table now has six columns and the insert gives five, so the engine rejects it, as the step-through shows.
- Naming the columns makes the insert independent of column count and order. Columns you don't name, like `is_active`, get their default.
- The failure is the *good* outcome. The bad one is when two columns of the same type are added or reordered: a positional insert then loads cleanly into the wrong columns, and nothing errors.
""",
    steps=[
        Step("Old insert", "The positional insert supplies five values for a six-column table.",
             error="INSERT INTO dim_product VALUES (1004, 'SKU-004', 'Webcam', 'Video', 49.00)"),
        Step("Fixed insert", "With a column list the insert works, and is_active takes its default.",
             run="INSERT INTO dim_product (product_sk, product_code, name, category, list_price) VALUES (1004, 'SKU-004', 'Webcam', 'Video', 49.00)",
             tables=[Show("dim_product", "SELECT *, CASE WHEN product_sk = 1004 THEN 'new' END AS _mark FROM dim_product ORDER BY product_sk")]),
    ],
    check="Run twice: this insert adds a second SKU-004 row, because a plain `INSERT` is never idempotent. Q10 makes it safe with `MERGE`.",
)

q7 = Q(
    id="q07",
    title="Surrogate keys from a sequence, and why they don't dedupe",
    level="Easy",
    pattern="Surrogate keys",
    prompt="""
Create `dim_store` whose `store_sk` is filled from a sequence, and insert two stores without supplying the key. Then answer: what happens if the load runs twice?
""",
    setup="",
    answer="""
CREATE SEQUENCE store_seq START 1;

CREATE TABLE dim_store (
    store_sk   INTEGER PRIMARY KEY DEFAULT nextval('store_seq'),
    store_code VARCHAR(20) NOT NULL,
    store_name VARCHAR(100)
);

INSERT INTO dim_store (store_code, store_name)
VALUES ('ST-01', 'Downtown'), ('ST-02', 'Airport');
""",
    display="""
CREATE SEQUENCE store_seq START = 1 INCREMENT = 1;

CREATE TABLE dim_store (
    store_sk   NUMBER DEFAULT store_seq.NEXTVAL,   -- or: store_sk NUMBER AUTOINCREMENT
    store_code VARCHAR(20) NOT NULL,
    store_name VARCHAR(100)
);

INSERT INTO dim_store (store_code, store_name)
VALUES ('ST-01', 'Downtown'), ('ST-02', 'Airport');
""",
    result="SELECT * FROM dim_store ORDER BY store_sk",
    hint="The sequence hands out a new number on every insert. Does it know anything about `store_code`?",
    explain="""
- `CREATE SEQUENCE` makes a standalone number generator, and `DEFAULT nextval(…)` pulls the next value whenever an insert leaves `store_sk` out.
- Surrogate keys are meaningless integers on purpose: they insulate the warehouse from source keys that change format, get reused or collide across systems.
- Sequences guarantee unique, increasing values, **not** gap-free ones: a rolled-back insert or a cached block skips numbers ([Snowflake docs](https://docs.snowflake.com/en/sql-reference/sql/create-sequence)). Never use them as a row count.

The re-run is the real lesson. The sequence knows nothing about `store_code`, so running the load again inserts ST-01 and ST-02 a second time under new keys 3 and 4. Surrogate keys make rows unique, not *entities*. The natural key needs its own guard, and that's the job of `MERGE` (Q10).
""",
    steps=[
        Step("First load", "Each store gets the next sequence value.",
             run="""CREATE SEQUENCE store_seq START 1;
CREATE TABLE dim_store (store_sk INTEGER PRIMARY KEY DEFAULT nextval('store_seq'), store_code VARCHAR(20) NOT NULL, store_name VARCHAR(100));
INSERT INTO dim_store (store_code, store_name) VALUES ('ST-01', 'Downtown'), ('ST-02', 'Airport');""",
             tables=[Show("dim_store", "SELECT *, 'new' AS _mark FROM dim_store ORDER BY store_sk")]),
        Step("Load runs again", "The same two stores come in again with new keys: two duplicate entities, and no error.",
             run="INSERT INTO dim_store (store_code, store_name) VALUES ('ST-01', 'Downtown'), ('ST-02', 'Airport')",
             tables=[Show("dim_store", "SELECT *, CASE WHEN store_sk > 2 THEN 'bad' END AS _mark FROM dim_store ORDER BY store_sk")]),
    ],
    trace_alt="Two steps: the first load gives ST-01 and ST-02 keys 1 and 2; running the load again adds them a second time as keys 3 and 4, shown as unwanted duplicates.",
    check="Grain: unique per row, not per store, until a natural-key check exists. Run twice: duplicates. NULL: `store_code NOT NULL` is worth having, because a NULL business key can never be matched or deduplicated later.",
)

q8 = Q(
    id="q08",
    title="Partition for pruning, and the filter that defeats it",
    level="Medium",
    pattern="Physical design",
    prompt="""
`events` is huge and almost every query filters on a date range. Give the BigQuery DDL that partitions it by `event_date`, and say what Snowflake does instead. Then fix this dashboard query, which scans the whole table even though the table is partitioned:

```sql
SELECT count(*) FROM events WHERE YEAR(event_date) = 2025 AND MONTH(event_date) = 3;
```
""",
    setup="""
CREATE TABLE events (event_id INT, user_id VARCHAR, event_date DATE);
INSERT INTO events VALUES
    (1, 'u1', DATE '2025-02-27'), (2, 'u2', DATE '2025-03-01'),
    (3, 'u1', DATE '2025-03-15'), (4, 'u3', DATE '2025-03-31'),
    (5, 'u2', DATE '2025-04-01');
""",
    show=["events"],
    display="""
-- BigQuery: one partition per day of event_date
CREATE TABLE analytics.events (
    event_id   INT64,
    user_id    STRING,
    event_date DATE
)
PARTITION BY event_date;

-- Snowflake: no declared partitions; micro-partitions are automatic,
-- and a clustering key keeps rows with nearby dates together
CREATE TABLE events (event_id NUMBER, user_id STRING, event_date DATE)
CLUSTER BY (event_date);

-- The rewrite (both engines): a range on the bare column
SELECT count(*) FROM events
WHERE event_date >= DATE '2025-03-01' AND event_date < DATE '2025-04-01';
""",
    display_label="BigQuery and Snowflake",
    answer="""
SELECT count(*) AS march_events
FROM events
WHERE event_date >= DATE '2025-03-01'
  AND event_date <  DATE '2025-04-01';
""",
    hint="The engine decides which partitions to skip by comparing your filter with each partition's date range. Can it do that when the column is wrapped in a function?",
    explain="""
- `PARTITION BY event_date` stores each day separately, so a filter on `event_date` reads only the matching days. That's **partition pruning**.
- Snowflake has no declared partitions. It keeps min/max metadata for every micro-partition and skips the ones a filter rules out; `CLUSTER BY` keeps nearby dates in the same micro-partitions so that skipping works well on very large tables ([docs](https://docs.snowflake.com/en/user-guide/tables-clustering-micropartitions)).
- `YEAR(event_date) = 2025` asks the engine about a *computed* value, so it can't compare the filter with a partition's date range and reads everything. Google's guidance is the same: isolate the partition column on one side of the comparison ([BigQuery docs](https://cloud.google.com/bigquery/docs/querying-partitioned-tables)).
- A half-open range `>= '2025-03-01' AND < '2025-04-01'` returns the same rows, as the output shows, but prunes. It also handles month ends without knowing whether March has 31 days, and works for timestamps without a `23:59:59.999` hack.
""",
    steps=[
        Step("Input", "The rows the filter should keep are the three in March.",
             tables=[Show("events", "SELECT *, CASE WHEN event_date >= DATE '2025-03-01' AND event_date < DATE '2025-04-01' THEN 'hit' END AS _mark FROM events")]),
        Step("Both filters", "The function filter and the range filter return the same count. Only the range lets the engine skip partitions.",
             tables=[Show("compare", "SELECT 'YEAR() and MONTH()' AS filter, count(*) AS rows_found, 'reads every partition' AS pruning FROM events WHERE YEAR(event_date) = 2025 AND MONTH(event_date) = 3 UNION ALL SELECT 'half-open range', count(*), 'reads only March' FROM events WHERE event_date >= DATE '2025-03-01' AND event_date < DATE '2025-04-01'")]),
    ],
    check="Grain is unchanged; this is purely about cost and speed. Correctness: the half-open range is also the safe way to filter timestamps, because `BETWEEN '2025-03-01' AND '2025-03-31'` misses everything after midnight on the 31st.",
)

q9 = Q(
    id="q09",
    title="View, snapshot or materialized view",
    level="Easy",
    pattern="Views",
    prompt="""
Create a view `v_active_products` over the active rows of `dim_product`. A teammate instead copies the active rows into a table each morning. Show what each returns after a product is deactivated and a new one is added, and say where a materialized view fits.
""",
    setup="""
CREATE TABLE dim_product (product_sk INT, name VARCHAR, is_active BOOLEAN);
INSERT INTO dim_product VALUES (1, 'Wireless Mouse', TRUE), (2, 'Keyboard', TRUE), (3, 'Fax Machine', FALSE);
""",
    show=["dim_product"],
    answer="""
CREATE VIEW v_active_products AS
SELECT product_sk, name
FROM dim_product
WHERE is_active;
""",
    result="SELECT * FROM v_active_products ORDER BY product_sk",
    hint="A view stores a query, a table stores rows. Which one sees a change made after it was created?",
    explain="""
- A **view** stores only the query, so every read runs it against the current table. It's always fresh, and you pay for the query on every read.
- A **table snapshot** (the teammate's copy) stores rows. It's fast to read, but it's only as fresh as its last rebuild, as the step-through shows.
- A **materialized view** stores rows *and* keeps them in sync. How it stays in sync is the difference that matters:
  - **Snowflake** maintains it automatically in the background and always returns current results; the cost is the background maintenance compute. It's limited to a single table, with no joins or window functions ([docs](https://docs.snowflake.com/en/user-guide/views-materialized)).
  - **Postgres** materialized views are stale until you run `REFRESH MATERIALIZED VIEW` ([docs](https://www.postgresql.org/docs/current/rules-materializedviews.html)).
  - For multi-table pipelines in Snowflake, **dynamic tables** fill the gap: you set a target lag and Snowflake refreshes them, incrementally when it can ([docs](https://docs.snowflake.com/en/user-guide/overview-view-mview-dts)).

Promote a view to something materialized when it is expensive and read far more often than its inputs change.
""",
    steps=[
        Step("Create", "The view and the morning snapshot agree when they are created.",
             run="CREATE VIEW v_active_products AS SELECT product_sk, name FROM dim_product WHERE is_active; CREATE TABLE active_snapshot AS SELECT * FROM v_active_products",
             tables=[Show("v_active_products", "SELECT * FROM v_active_products ORDER BY 1"), Show("active_snapshot", "SELECT * FROM active_snapshot ORDER BY 1")]),
        Step("Base changes", "The keyboard is deactivated and a webcam is added.",
             run="UPDATE dim_product SET is_active = FALSE WHERE product_sk = 2; INSERT INTO dim_product VALUES (4, 'Webcam', TRUE)",
             tables=[Show("dim_product", "SELECT *, CASE WHEN product_sk = 2 THEN 'upd' WHEN product_sk = 4 THEN 'new' END AS _mark FROM dim_product ORDER BY 1")]),
        Step("Read again", "The view reflects both changes. The snapshot still shows the keyboard and misses the webcam until it is rebuilt.",
             tables=[Show("v_active_products", "SELECT *, CASE WHEN product_sk = 4 THEN 'new' END AS _mark FROM v_active_products ORDER BY 1"),
                     Show("active_snapshot", "SELECT *, CASE WHEN product_sk = 2 THEN 'bad' END AS _mark FROM active_snapshot ORDER BY 1")]),
    ],
    trace_alt="Three steps: a view and a table snapshot agree at first; the keyboard is deactivated and a webcam added; the view shows the change while the snapshot is stale.",
    check="Freshness is the trade-off: a view is always current, a snapshot is current only as of its last build, and a materialized view's freshness depends on the engine.",
)

# ------------------------------------------------------------------ DML

q10 = Q(
    id="q10",
    title="An upsert that is safe to run twice",
    level="Easy",
    pattern="MERGE and upsert",
    prompt="""
`src_currency` holds today's currency list. Apply it to `dim_currency` so that existing codes are updated and new codes are inserted, and so that running the statement again changes nothing.
""",
    setup="""
CREATE TABLE dim_currency (currency_code CHAR(3) PRIMARY KEY, currency_name VARCHAR, symbol VARCHAR);
INSERT INTO dim_currency VALUES ('USD', 'Dollar', '$'), ('GBP', 'Pound Sterling', '£');

CREATE TABLE src_currency (currency_code CHAR(3), currency_name VARCHAR, symbol VARCHAR);
INSERT INTO src_currency VALUES ('USD', 'US Dollar', '$'), ('EUR', 'Euro', '€');
""",
    show=["dim_currency", "src_currency"],
    answer="""
MERGE INTO dim_currency t
USING src_currency s
   ON t.currency_code = s.currency_code
WHEN MATCHED THEN UPDATE SET
    currency_name = s.currency_name,
    symbol        = s.symbol
WHEN NOT MATCHED THEN INSERT (currency_code, currency_name, symbol)
    VALUES (s.currency_code, s.currency_name, s.symbol);
""",
    result="SELECT * FROM dim_currency ORDER BY currency_code",
    diff=("dim_currency", "currency_code"),
    rerun=True,
    hint="You need one statement with two branches: one for codes that already exist, one for codes that don't.",
    explain="""
- `MERGE INTO … USING … ON` joins the target to the source on the key; each source row either matches a target row or doesn't.
- `WHEN MATCHED THEN UPDATE` refreshes USD's name. `WHEN NOT MATCHED THEN INSERT` adds EUR. GBP isn't in the source, so it's left alone.
- Running it again finds every source row matched and writes the same values, so the table doesn't change. The build ran it twice to check.

Postgres's older form does the same with `INSERT … ON CONFLICT (currency_code) DO UPDATE SET currency_name = EXCLUDED.currency_name` ([docs](https://www.postgresql.org/docs/current/sql-insert.html)); `EXCLUDED` is the row that would have been inserted.
""",
    after="""
<Callout type="warning" title="Deduplicate the source first">

If the source holds two rows for the same key, `MERGE` can't decide which one wins. Snowflake raises an error by default (`ERROR_ON_NONDETERMINISTIC_MERGE`), and if that's turned off it picks one arbitrarily ([docs](https://docs.snowflake.com/en/sql-reference/sql/merge)). Reduce the source to one row per key before merging, which is Q11.

</Callout>
""",
    check="Grain: one row per currency code. Run twice: no change, which the build verified. NULL: a source row with a NULL `currency_code` never matches anything (NULL = NULL is not true), so it is inserted every run. Filter NULL keys out of the source.",
)

q11 = Q(
    id="q11",
    title="Keep the latest row per key, and watch where NULLs sort",
    level="Easy",
    pattern="Deduplication",
    prompt="""
`stg_customer` holds several CDC pulls per customer. Return exactly one row per `customer_code`: the one with the latest `updated_at`, breaking ties by the greater `email`. One row has a NULL `updated_at` (a pull that lost its timestamp). It must not win.
""",
    setup="""
CREATE TABLE stg_customer (customer_code VARCHAR, email VARCHAR, updated_at TIMESTAMP);
INSERT INTO stg_customer VALUES
    ('C-001', 'ana@old.com',  TIMESTAMP '2025-01-01 09:00'),
    ('C-001', 'ana@new.com',  TIMESTAMP '2025-02-01 09:00'),
    ('C-001', 'ana@lost.com', NULL),
    ('C-002', 'raj@a.com',    TIMESTAMP '2025-03-01 12:00'),
    ('C-002', 'raj@b.com',    TIMESTAMP '2025-03-01 12:00'),
    ('C-003', 'li@x.com',     TIMESTAMP '2025-01-15 08:30');
""",
    show=["stg_customer"],
    answer="""
SELECT customer_code, email, updated_at
FROM stg_customer
QUALIFY ROW_NUMBER() OVER (
    PARTITION BY customer_code
    ORDER BY updated_at DESC NULLS LAST, email DESC
) = 1
ORDER BY customer_code;
""",
    hint="Number the rows within each customer, newest first, and keep number 1. Then check where your engine puts NULL in a descending sort.",
    explain="""
- `ROW_NUMBER() OVER (PARTITION BY customer_code ORDER BY …)` numbers the rows within each customer, starting at 1 for the winner.
- `QUALIFY … = 1` filters on that number in the same query. It's to window functions what `HAVING` is to aggregates. Postgres has no `QUALIFY`, so you wrap the query in a subquery and filter `WHERE rn = 1` ([Snowflake docs](https://docs.snowflake.com/en/sql-reference/constructs/qualify)).
- `email DESC` is the tiebreaker that makes C-002's winner deterministic. Without it, the two rows with the same timestamp could swap places between runs.
- `ROW_NUMBER`, not `RANK`: `RANK` gives both tied rows rank 1 and you'd keep both.

**`NULLS LAST` is the part most answers miss.** Snowflake and Postgres sort NULL as larger than any value, so in a descending sort NULLs come **first** ([Snowflake](https://docs.snowflake.com/en/sql-reference/constructs/order-by), [Postgres](https://www.postgresql.org/docs/current/queries-order.html)). Without `NULLS LAST`, C-001's winner is the row with no timestamp, `ana@lost.com`. DuckDB happens to sort NULLs last by default ([docs](https://duckdb.org/docs/stable/sql/query_syntax/orderby)), which is exactly how this bug hides in testing and appears in production. Write the null ordering explicitly.
""",
    steps=[
        Step("Numbered", "Each customer's rows numbered newest first, with NULLS LAST. Row 1 wins.",
             tables=[Show("numbered", "SELECT customer_code, email, updated_at, ROW_NUMBER() OVER (PARTITION BY customer_code ORDER BY updated_at DESC NULLS LAST, email DESC) AS rn, CASE WHEN ROW_NUMBER() OVER (PARTITION BY customer_code ORDER BY updated_at DESC NULLS LAST, email DESC) = 1 THEN 'keep' ELSE 'drop' END AS _mark FROM stg_customer ORDER BY customer_code, rn")]),
        Step("Without NULLS LAST", "With Snowflake's and Postgres's default (NULLs first in a descending sort), the row with no timestamp wins for C-001.",
             tables=[Show("numbered (NULLs first)", "SELECT customer_code, email, updated_at, ROW_NUMBER() OVER (PARTITION BY customer_code ORDER BY updated_at DESC NULLS FIRST, email DESC) AS rn, CASE WHEN ROW_NUMBER() OVER (PARTITION BY customer_code ORDER BY updated_at DESC NULLS FIRST, email DESC) = 1 THEN (CASE WHEN updated_at IS NULL THEN 'bad' ELSE 'keep' END) END AS _mark FROM stg_customer ORDER BY customer_code, rn")]),
        Step("Result", "One row per customer, the latest real pull.",
             tables=[Show("result", "SELECT customer_code, email, updated_at FROM stg_customer QUALIFY ROW_NUMBER() OVER (PARTITION BY customer_code ORDER BY updated_at DESC NULLS LAST, email DESC) = 1 ORDER BY customer_code")]),
    ],
    trace_alt="Three steps: rows numbered within each customer with NULLs last; the same numbering with NULLs first, where a row with no timestamp wrongly wins; and the one-row-per-customer result.",
    check="Grain: exactly one row per `customer_code`, guaranteed by `ROW_NUMBER`. Run twice: deterministic only because of the full tiebreak. NULL: always state `NULLS LAST` in a newest-first dedup.",
)

q12 = Q(
    id="q12",
    title="Not equal, including the NULLs",
    level="Easy",
    pattern="NULL semantics",
    prompt="""
Return every order whose `coupon_code` is **not** `'PROMO10'`, including orders with no coupon at all. Explain why `WHERE coupon_code <> 'PROMO10'` gets this wrong.
""",
    setup="""
CREATE TABLE orders (order_id INT, coupon_code VARCHAR, amount DECIMAL(10,2));
INSERT INTO orders VALUES
    (1, 'PROMO10', 50.00), (2, 'SPRING', 20.00), (3, NULL, 35.00),
    (4, 'PROMO10', 15.00), (5, NULL, 80.00);
""",
    show=["orders"],
    answer="""
SELECT *
FROM orders
WHERE coupon_code IS DISTINCT FROM 'PROMO10'
ORDER BY order_id;
""",
    hint="Work out what `NULL <> 'PROMO10'` evaluates to. It's not TRUE, and it's not FALSE.",
    explain="""
- SQL logic has three values: TRUE, FALSE and UNKNOWN. Comparing NULL with anything gives UNKNOWN, and `WHERE` keeps only TRUE rows, so `coupon_code <> 'PROMO10'` silently drops orders 3 and 5. The step-through shows the UNKNOWN (NULL) result on those rows.
- `IS DISTINCT FROM` treats NULL as an ordinary value: NULL is distinct from `'PROMO10'`, so those rows are kept.
- The portable spelling is `WHERE coupon_code <> 'PROMO10' OR coupon_code IS NULL`.

Here the naive filter loses $115 of no-coupon revenue, and nothing errors.
""",
    steps=[
        Step("Evaluate", "What each predicate returns per row. The plain comparison is NULL (unknown) for the no-coupon orders.",
             tables=[Show("predicates", "SELECT order_id, coupon_code, coupon_code <> 'PROMO10' AS \"<> 'PROMO10'\", coupon_code IS DISTINCT FROM 'PROMO10' AS \"IS DISTINCT FROM\", CASE WHEN coupon_code IS NULL THEN 'hit' END AS _mark FROM orders ORDER BY order_id")]),
        Step("Naive filter", "WHERE keeps only TRUE, so the two NULL-coupon orders disappear.",
             tables=[Show("WHERE coupon_code <> 'PROMO10'", "SELECT *, CASE WHEN coupon_code <> 'PROMO10' THEN 'keep' ELSE 'drop' END AS _mark FROM orders ORDER BY order_id")]),
        Step("Correct filter", "IS DISTINCT FROM keeps them.",
             tables=[Show("WHERE … IS DISTINCT FROM 'PROMO10'", "SELECT *, CASE WHEN coupon_code IS DISTINCT FROM 'PROMO10' THEN 'keep' ELSE 'drop' END AS _mark FROM orders ORDER BY order_id")]),
    ],
    trace_alt="Three steps: each order's result under the two predicates, with NULL for the no-coupon orders under the plain comparison; the naive filter dropping orders 3 and 5; the correct filter keeping them.",
    check="NULL: any `<>`, `NOT IN` or `NOT LIKE` filter on a nullable column needs a decision about NULLs. Make it explicit.",
)

q13 = Q(
    id="q13",
    title="Several totals in one pass",
    level="Easy",
    pattern="Conditional aggregation",
    prompt="""
In one pass over `payments`, return per `method`: the total amount, the captured amount, and the number of failed payments. Use no `WHERE`. A method with nothing captured must show `0.00`, not NULL.
""",
    setup="""
CREATE TABLE payments (payment_id INT, method VARCHAR, status VARCHAR, amount DECIMAL(10,2));
INSERT INTO payments VALUES
    (1, 'card',   'CAPTURED', 50.00), (2, 'card',   'FAILED',   20.00),
    (3, 'card',   'CAPTURED', 30.00), (4, 'wallet', 'FAILED',   15.00),
    (5, 'wallet', 'PENDING',  10.00), (6, 'bank',   'CAPTURED', NULL);
""",
    show=["payments"],
    answer="""
SELECT
    method,
    COALESCE(SUM(amount), 0)                                          AS total_amount,
    COALESCE(SUM(CASE WHEN status = 'CAPTURED' THEN amount END), 0)   AS captured_amount,
    COUNT(CASE WHEN status = 'FAILED' THEN 1 END)                     AS failed_count
FROM payments
GROUP BY method
ORDER BY method;
""",
    hint="Put a `CASE` inside each aggregate so that rows that don't belong contribute nothing. Then check what `SUM` returns when every value it sees is NULL.",
    explain="""
- `SUM(CASE WHEN status = 'CAPTURED' THEN amount END)`: rows that aren't captured become NULL, and `SUM` ignores NULLs, so one scan produces a filtered total.
- `COUNT(CASE WHEN status = 'FAILED' THEN 1 END)`: `COUNT` of an expression counts only non-NULL values, so only failures are counted.
- `COALESCE(…, 0)`: `SUM` over only NULLs returns **NULL**, not 0. That's the wallet's captured amount (nothing captured) and the bank's total (its one amount is NULL). `COALESCE` turns those into 0.00 so a dashboard shows a number.
- One pass replaces three queries with three `WHERE` clauses joined back together.
""",
    steps=[
        Step("Per row", "What each row contributes to each total. Blank cells are NULL and are ignored.",
             tables=[Show("contributions", "SELECT payment_id, method, status, amount, CASE WHEN status = 'CAPTURED' THEN amount END AS to_captured, CASE WHEN status = 'FAILED' THEN 1 END AS to_failed FROM payments ORDER BY method, payment_id")]),
        Step("Grouped", "The sums before COALESCE: wallet's captured amount and bank's total are NULL.",
             tables=[Show("before COALESCE", "SELECT method, SUM(amount) AS total_amount, SUM(CASE WHEN status = 'CAPTURED' THEN amount END) AS captured_amount, COUNT(CASE WHEN status = 'FAILED' THEN 1 END) AS failed_count, CASE WHEN SUM(amount) IS NULL OR SUM(CASE WHEN status = 'CAPTURED' THEN amount END) IS NULL THEN 'hit' END AS _mark FROM payments GROUP BY method ORDER BY method")]),
        Step("Result", "COALESCE replaces the NULL totals with 0.",
             tables=[Show("result", "SELECT method, COALESCE(SUM(amount), 0) AS total_amount, COALESCE(SUM(CASE WHEN status = 'CAPTURED' THEN amount END), 0) AS captured_amount, COUNT(CASE WHEN status = 'FAILED' THEN 1 END) AS failed_count FROM payments GROUP BY method ORDER BY method")]),
    ],
    trace_alt="Three steps: each payment's contribution to the captured total and the failed count; the grouped sums with NULLs for the wallet's captures and the bank's total; and the final result with those turned into zero.",
    check="Grain: one row per method. NULL: `SUM` of nothing is NULL and `COUNT` of nothing is 0, so wrap sums in `COALESCE` when a 0 is the honest answer.",
)

q14 = Q(
    id="q14",
    title="Find orphan keys, and why NOT IN finds none",
    level="Easy",
    pattern="Referential integrity",
    prompt="""
Cloud warehouses don't enforce foreign keys. Find every `customer_sk` in `fact_sales` that has no row in `dim_customer`. A colleague tried `WHERE customer_sk NOT IN (SELECT customer_sk FROM dim_customer)` and got no rows. Explain why.
""",
    setup="""
CREATE TABLE dim_customer (customer_sk INT, customer_code VARCHAR);
INSERT INTO dim_customer VALUES (1, 'C-001'), (2, 'C-002'), (3, 'C-003'), (NULL, 'C-BAD');

CREATE TABLE fact_sales (sale_id INT, customer_sk INT, amount DECIMAL(10,2));
INSERT INTO fact_sales VALUES (101, 1, 20.00), (102, 2, 35.00), (103, 7, 12.00), (104, 9, 40.00), (105, 7, 8.00);
""",
    show=["dim_customer", "fact_sales"],
    answer="""
SELECT DISTINCT f.customer_sk
FROM fact_sales f
WHERE NOT EXISTS (
    SELECT 1 FROM dim_customer d WHERE d.customer_sk = f.customer_sk
)
ORDER BY f.customer_sk;
""",
    hint="`x NOT IN (1, 2, 3, NULL)` means `x <> 1 AND x <> 2 AND x <> 3 AND x <> NULL`. What is `x <> NULL`?",
    explain="""
- `NOT EXISTS (…)` keeps a fact row when the subquery finds no dimension row with its key. Keys 7 and 9 have none, so they're the orphans.
- `NOT IN` breaks on the dimension's bad row with a NULL key: `7 NOT IN (1, 2, 3, NULL)` expands to `… AND 7 <> NULL`, which is UNKNOWN, so the whole condition is never TRUE and **every** row is filtered out. One NULL in the subquery and the check silently reports no problems.
- `LEFT JOIN dim_customer d ON … WHERE d.customer_sk IS NULL` is the other safe form (an anti-join).

A referential check that can't fail is worse than no check, because it tells you the data is clean.
""",
    steps=[
        Step("Input", "The dimension has a bad row with a NULL key; the fact references keys 7 and 9, which don't exist.",
             tables=[Show("dim_customer", "SELECT *, CASE WHEN customer_sk IS NULL THEN 'hit' END AS _mark FROM dim_customer"), Show("fact_sales", "SELECT *, CASE WHEN customer_sk IN (7, 9) THEN 'hit' END AS _mark FROM fact_sales")]),
        Step("NOT IN", "The NULL in the subquery makes every comparison unknown, so NOT IN returns nothing.",
             tables=[Show("NOT IN result", "SELECT DISTINCT customer_sk FROM fact_sales WHERE customer_sk NOT IN (SELECT customer_sk FROM dim_customer)")]),
        Step("NOT EXISTS", "NOT EXISTS isn't affected by the NULL and finds both orphan keys.",
             tables=[Show("NOT EXISTS result", "SELECT DISTINCT f.customer_sk, 'hit' AS _mark FROM fact_sales f WHERE NOT EXISTS (SELECT 1 FROM dim_customer d WHERE d.customer_sk = f.customer_sk) ORDER BY 1")]),
    ],
    trace_alt="Three steps: the inputs, with a NULL key in the dimension and orphan keys 7 and 9 in the fact; NOT IN returning no rows; NOT EXISTS returning 7 and 9.",
    check="NULL: never use `NOT IN` with a subquery that can return NULL. A fact row whose own key is NULL is also returned by `NOT EXISTS`, which is right: it's an orphan too.",
)

q15 = Q(
    id="q15",
    title="A date spine, so empty days still show up",
    level="Easy",
    pattern="Generated data",
    prompt="""
`daily_orders` has no row for days with no orders. Build a calendar for 2025-03-01 to 2025-03-07 with `date_key` (YYYYMMDD as an integer), the day name and an `is_weekend` flag, and use it to report orders per day with **0** for the missing days.
""",
    setup="""
CREATE TABLE daily_orders (order_date DATE, orders INT);
INSERT INTO daily_orders VALUES
    (DATE '2025-03-01', 12), (DATE '2025-03-02', 9),
    (DATE '2025-03-04', 15), (DATE '2025-03-07', 4);
""",
    show=["daily_orders"],
    answer="""
WITH spine AS (
    SELECT CAST(d AS DATE) AS full_date
    FROM generate_series(DATE '2025-03-01', DATE '2025-03-07', INTERVAL 1 DAY) AS t(d)
)
SELECT
    CAST(strftime(s.full_date, '%Y%m%d') AS INT) AS date_key,
    s.full_date,
    dayname(s.full_date)                         AS day_name,
    isodow(s.full_date) IN (6, 7)                AS is_weekend,
    COALESCE(o.orders, 0)                        AS orders
FROM spine s
LEFT JOIN daily_orders o ON o.order_date = s.full_date
ORDER BY s.full_date;
""",
    display="""
WITH spine AS (
    SELECT DATEADD(day, ROW_NUMBER() OVER (ORDER BY SEQ4()) - 1, DATE '2025-03-01') AS full_date
    FROM TABLE(GENERATOR(ROWCOUNT => 7))
)
SELECT
    TO_NUMBER(TO_CHAR(s.full_date, 'YYYYMMDD')) AS date_key,
    s.full_date,
    DAYNAME(s.full_date)                        AS day_name,
    DAYOFWEEKISO(s.full_date) IN (6, 7)         AS is_weekend,
    COALESCE(o.orders, 0)                       AS orders
FROM spine s
LEFT JOIN daily_orders o ON o.order_date = s.full_date
ORDER BY s.full_date;
""",
    hint="Generate one row per day first, independent of the data, then `LEFT JOIN` the facts onto it.",
    explain="""
- The **spine** is a gapless list of days that doesn't depend on the data: Snowflake builds it from `GENERATOR`, Postgres and DuckDB from `generate_series`.
- `LEFT JOIN daily_orders` keeps every calendar day; days with no orders get NULL, and `COALESCE(…, 0)` reports them as 0. Grouping the orders directly would simply omit March 3, 5 and 6, and a chart would draw a straight line across the gap.
- `date_key` as a `YYYYMMDD` integer is the classic warehouse date key: compact, sortable and readable.
- `isodow` / `DAYOFWEEKISO` returns 6 and 7 for Saturday and Sunday under ISO rules, which avoids locale differences over which day is day 1.

**Why `ROW_NUMBER()` and not `SEQ4()` alone in Snowflake.** `SEQ4()` gives unique, increasing numbers but doesn't guarantee they're gap-free, especially at scale, so `DATEADD(day, SEQ4(), …)` can silently skip dates. Snowflake's own docs recommend `ROW_NUMBER() OVER (ORDER BY SEQ4())` for a gap-free sequence ([docs](https://docs.snowflake.com/en/sql-reference/functions/seq1)).
""",
    steps=[
        Step("Spine", "Seven generated days, with no reference to the data.",
             tables=[Show("spine", "SELECT CAST(d AS DATE) AS full_date FROM generate_series(DATE '2025-03-01', DATE '2025-03-07', INTERVAL 1 DAY) AS t(d)")]),
        Step("Facts", "The data has no rows for March 3, 5 and 6.",
             tables=[Show("daily_orders", "SELECT * FROM daily_orders")]),
        Step("Joined", "The LEFT JOIN keeps every day, and the missing days are filled with 0.",
             tables=[Show("result", "WITH spine AS (SELECT CAST(d AS DATE) AS full_date FROM generate_series(DATE '2025-03-01', DATE '2025-03-07', INTERVAL 1 DAY) AS t(d)) SELECT CAST(strftime(s.full_date, '%Y%m%d') AS INT) AS date_key, s.full_date, dayname(s.full_date) AS day_name, isodow(s.full_date) IN (6, 7) AS is_weekend, COALESCE(o.orders, 0) AS orders, CASE WHEN o.orders IS NULL THEN 'new' END AS _mark FROM spine s LEFT JOIN daily_orders o ON o.order_date = s.full_date ORDER BY s.full_date")]),
    ],
    trace_alt="Three steps: a generated spine of seven days; the order data with three days missing; the joined result with the missing days filled with zero orders.",
    check="Grain: one row per calendar day, guaranteed by the spine. NULL: missing days come back as NULL from the `LEFT JOIN` and must be turned into 0 explicitly.",
)


INTRO = f"""
Most SQL practice online is written for analysts: `SELECT`, joins and window functions over clean tables. The SQL a data engineer writes is different. It defines tables and their rules, loads data so that a re-run doesn't double it, keeps history, applies change streams, and proves the result is right before anyone sees it. I couldn't find a practice bank built around that, so this series is one.

{series_callout(SLUG)}

This first post covers the foundations the rest of the series assumes: defining and changing tables, and the loading habits that keep a pipeline correct. Most questions are short, and each one carries a trap that real pipelines fall into.

- Defining tables (DDL)
- Loading and changing rows (DML)
- How the answers are checked, and how to run them yourself

## How to use this bank

{HOW_TO_READ.strip()}

After every answer, ask the three questions that separate an engineer's answer from an analyst's. Each answer ends with an **Engineer check** that answers them:

1. **What's the grain?** What does one row of the output represent, and what guarantees it?
2. **What happens if it runs twice?** Pipelines retry. A load that doubles its data on a retry is a bug.
3. **What does NULL do here?** Most silent data loss in SQL comes from three-valued logic.

![The series as a map: post 01 builds the foundations, then three case studies (ShopWave retail warehouse, NovaBank medallion and CDC, StreamLoop product analytics) each drill a family of patterns, followed by hard problems across industries and capstone pipelines](/images/data-engineering/de-sql/de-sql-foundations/series-map.svg)

### How the answers are checked

Every question's sample data was loaded into a fresh [DuckDB](https://duckdb.org) 2.0 database and its answer was run there. The sample tables, the expected outputs and the step-throughs are copied from those runs by a build script, not typed by hand. Answers marked as safe to re-run were run twice, and the build fails if the second run changes anything.

The answers are written in Snowflake-flavored SQL, because Snowflake is where I write SQL at work. Where Snowflake's syntax differs from what DuckDB runs (`GENERATOR`, `AUTOINCREMENT`, `CLONE`, `IFF`, `DATEADD`), the answer shows the Snowflake version first and the runnable version under it. Snowflake behaviour is taken from its documentation and linked; I haven't run these on a Snowflake account.
"""

OUTRO = """
## How to run these yourself

Everything in this series runs on a laptop for free.

1. **Install DuckDB.** The CLI is a single binary, or `pip install duckdb` for Python ([installation docs](https://duckdb.org/docs/installation/)). Start it with `duckdb practice.db`.
2. **Load a question's data.** Open "Sample data as SQL" under the question and paste it into the DuckDB prompt.
3. **Write your answer**, run it, and compare with the expected output. Run it a second time to test idempotency.
4. **Postgres** is the other free option, and it's closer to many OLTP sources. Most answers run there unchanged; replace `QUALIFY` with a subquery and `MERGE` needs version 15 or later ([docs](https://www.postgresql.org/docs/current/sql-merge.html)).
5. **Snowflake** has a [free trial](https://signup.snowflake.com/) if you want to run the Snowflake versions as written.

## Summary

The foundations come down to a few habits. Declare constraints, but know that a cloud warehouse enforces only some of them, so test the rest in SQL. Name your columns, cast defensively and flag what didn't parse. Make loads idempotent with `MERGE`, and deduplicate the source before merging. Be explicit about NULLs everywhere they can hide: in `<>` filters, `NOT IN` subqueries, descending sorts and sums over nothing. Generate a spine when missing rows matter.

### Concepts at a glance

| Concept | In one line | Why it matters |
| --- | --- | --- |
| **Surrogate key** | A meaningless integer the warehouse assigns | Insulates you from source keys, but doesn't deduplicate entities |
| **Enforced vs informational constraints** | Snowflake enforces `NOT NULL` and `CHECK`, not `PRIMARY KEY`, `UNIQUE` or `FOREIGN KEY` | Duplicates and orphans load silently unless you test for them |
| **`TRY_CAST` plus a flag** | Bad values become NULL, and a flag records that it happened | Loads don't abort, and data loss stays visible |
| **`LIKE` vs `CLONE`** | Structure only vs zero-copy data | The right empty target vs the right test copy |
| **Partition pruning** | Filter the bare partition column with a range | Functions on the column make the engine read everything |
| **`MERGE`** | Update matches, insert the rest | An idempotent load, once the source has one row per key |
| **`QUALIFY ROW_NUMBER() = 1`** | Keep one row per key | Needs a full tiebreak and an explicit `NULLS LAST` |
| **Three-valued logic** | NULL compared with anything is UNKNOWN | `<>` and `NOT IN` silently drop rows |
| **Date spine** | A generated, gapless list of dates | Days with no data still appear, as zero |

### Test yourself

<details>
<summary>Why can a newest-first dedup keep a row with no timestamp on Snowflake but not on DuckDB?</summary>

Snowflake and Postgres sort NULL as the largest value, so `ORDER BY updated_at DESC` puts NULLs first and the NULL row gets row number 1. DuckDB sorts NULLs last by default. Writing `NULLS LAST` makes the query behave the same everywhere.

</details>

<details>
<summary>A dimension table has one row with a NULL key. What does `fact.key NOT IN (SELECT key FROM dim)` return?</summary>

No rows at all. Every comparison with the NULL is unknown, so the `NOT IN` condition is never true. `NOT EXISTS` or a `LEFT JOIN … IS NULL` anti-join is the safe form.

</details>

<details>
<summary>You run a `MERGE` whose source has two rows for the same key. What happens on Snowflake?</summary>

By default it fails with a nondeterministic-merge error, because it can't tell which source row should win. Deduplicate the source to one row per key first.

</details>

<details>
<summary>Why does `WHERE YEAR(event_date) = 2025` read the whole partitioned table?</summary>

The engine skips partitions by comparing the filter with each partition's range of `event_date` values, and it can't do that for a computed expression. A range on the bare column, `event_date >= '2025-01-01' AND event_date < '2026-01-01'`, prunes.

</details>

<details>
<summary>A load assigns surrogate keys from a sequence. Is it safe to re-run?</summary>

No. The sequence knows nothing about the business key, so a re-run inserts the same entities again under new keys. Match on the business key with `MERGE` instead.

</details>

## Sources

- Snowflake: [constraints and join elimination](https://docs.snowflake.com/en/user-guide/join-elimination), [CHECK constraint release notes](https://docs.snowflake.com/en/release-notes/2026/10_12), [CREATE TABLE](https://docs.snowflake.com/en/sql-reference/sql/create-table), [CLONE](https://docs.snowflake.com/en/sql-reference/sql/create-clone), [MERGE](https://docs.snowflake.com/en/sql-reference/sql/merge), [QUALIFY](https://docs.snowflake.com/en/sql-reference/constructs/qualify), [ORDER BY and NULL ordering](https://docs.snowflake.com/en/sql-reference/constructs/order-by), [SEQ4 and gaps](https://docs.snowflake.com/en/sql-reference/functions/seq1), [CREATE SEQUENCE](https://docs.snowflake.com/en/sql-reference/sql/create-sequence), [conversion functions and TRY_CAST](https://docs.snowflake.com/en/sql-reference/functions-conversion), [micro-partitions and clustering](https://docs.snowflake.com/en/user-guide/tables-clustering-micropartitions), [materialized views](https://docs.snowflake.com/en/user-guide/views-materialized), [views, materialized views and dynamic tables](https://docs.snowflake.com/en/user-guide/overview-view-mview-dts), [UNDROP TABLE](https://docs.snowflake.com/en/sql-reference/sql/undrop-table)
- PostgreSQL: [ALTER TABLE](https://www.postgresql.org/docs/current/sql-altertable.html), [INSERT … ON CONFLICT](https://www.postgresql.org/docs/current/sql-insert.html), [MERGE](https://www.postgresql.org/docs/current/sql-merge.html), [sorting and NULLs](https://www.postgresql.org/docs/current/queries-order.html), [materialized views](https://www.postgresql.org/docs/current/rules-materializedviews.html)
- BigQuery: [querying partitioned tables](https://cloud.google.com/bigquery/docs/querying-partitioned-tables)
- DuckDB: [installation](https://duckdb.org/docs/installation/), [ORDER BY and NULL ordering](https://duckdb.org/docs/stable/sql/query_syntax/orderby), [MERGE INTO](https://duckdb.org/docs/current/sql/statements/merge_into)
"""

POST = Post(
    slug=SLUG,
    title="SQL for Data Engineers: Foundations, from DDL to the NULL Traps",
    description="A practice bank for data engineering SQL, part 1: defining and evolving tables, safe casting, idempotent upserts, deduplication and the NULL traps that silently lose rows. Every answer is run on real sample data.",
    order=1,
    tags=["Data Engineering", "SQL", "Practice"],
    intro=INTRO,
    groups=[
        Group("Defining tables (DDL)", "DDL decides what a table can hold and how it is stored. These questions cover declaring rules, changing a table that already has data, and the physical choices that decide what a query costs.",
              [q1, q2, q3, q4, q5, q6, q7, q8, q9]),
        Group("Loading and changing rows (DML)", "DML is where pipelines go wrong quietly. These questions cover upserts, deduplication and the NULL behaviour that drops rows without an error.",
              [q10, q11, q12, q13, q14, q15]),
    ],
    outro=OUTRO,
)
