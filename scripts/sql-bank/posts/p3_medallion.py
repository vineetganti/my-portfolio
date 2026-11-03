from build import Group, Post, Q, Show, Step
from posts.common import HOW_TO_READ, series_callout

SLUG = "de-sql-medallion-cdc"

CDC_COLS = "op VARCHAR, account_id VARCHAR, balance DECIMAL(12,2), status VARCHAR, source_ts TIMESTAMP, seq_no INT, _ingested_at TIMESTAMP"

# ------------------------------------------------------------------ bronze

q38 = Q(
    id="q38",
    title="Land raw files in Bronze without losing a row",
    level="Medium",
    pattern="Bronze ingestion",
    prompt="""
Two CSV files of transactions arrived. One has an amount that isn't a number, and one row was delivered in both files. Create `bronze_txn` and load both files so that **nothing is rejected**, every row records which file it came from, and the batch is identifiable.
""",
    setup="""
COPY (SELECT * FROM (VALUES
    ('T-1', 'ACC-1', '2025-03-01 09:00', '120.00', 'CREDIT', 'Payroll'),
    ('T-2', 'ACC-1', '2025-03-01 12:30', '45.50',  'debit',  'Cafe')
) t(txn_id, account_id, txn_ts, amount, direction, merchant)) TO 'txn_2025-03-01.csv' (HEADER);

COPY (SELECT * FROM (VALUES
    ('T-3', 'ACC-2', '2025-03-02 08:15', 'n/a',    'DEBIT',  'Grocer'),
    ('T-2', 'ACC-1', '2025-03-01 12:30', '45.50',  'debit',  'Cafe')
) t(txn_id, account_id, txn_ts, amount, direction, merchant)) TO 'txn_2025-03-02.csv' (HEADER);
""",
    answer="""
CREATE TABLE bronze_txn (
    txn_id       VARCHAR,
    account_id   VARCHAR,
    txn_ts       VARCHAR,     -- everything lands as text: typing happens in Silver
    amount       VARCHAR,
    direction    VARCHAR,
    merchant     VARCHAR,
    _file_name   VARCHAR,     -- lineage: which file
    _ingested_at TIMESTAMP,   -- lineage: when it landed
    _batch_id    VARCHAR      -- lineage: which run
);

INSERT INTO bronze_txn
SELECT txn_id, account_id, txn_ts, amount, direction, merchant,
       filename, current_timestamp, 'B-2025-03-02'
FROM read_csv('txn_*.csv', header = true, all_varchar = true, filename = true);
""",
    display="""
CREATE FILE FORMAT ff_csv TYPE = CSV SKIP_HEADER = 1 FIELD_OPTIONALLY_ENCLOSED_BY = '"';

CREATE TABLE bronze_txn (
    txn_id STRING, account_id STRING, txn_ts STRING, amount STRING, direction STRING, merchant STRING,
    _file_name STRING, _ingested_at TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(), _batch_id STRING
);

COPY INTO bronze_txn (txn_id, account_id, txn_ts, amount, direction, merchant, _file_name, _batch_id)
FROM (SELECT $1, $2, $3, $4, $5, $6, METADATA$FILENAME, 'B-2025-03-02' FROM @raw_stage/txn/)
FILE_FORMAT = (FORMAT_NAME = ff_csv);
""",
    result="SELECT txn_id, account_id, amount, direction, _file_name, _batch_id FROM bronze_txn ORDER BY _file_name, txn_id",
    hint="Bronze is the archive you rebuild everything else from. What would you lose if a column's type rejected a row here?",
    explain="""
- **Everything lands as text.** If `amount` were `DECIMAL`, the load would fail on `'n/a'` (or, with error-skipping turned on, drop the row). Bronze's job is to keep exactly what arrived, so typing and validation happen in Silver, where a bad row can be quarantined with a reason (Q50).
- **Lineage columns:** `_file_name` (DuckDB's `filename = true`, Snowflake's `METADATA$FILENAME` ([docs](https://docs.snowflake.com/en/user-guide/querying-metadata))), `_ingested_at` and `_batch_id` let you trace any row to its file and run, and replay or delete one bad file's rows.
- **Duplicates stay.** T-2 is in both files, and Bronze keeps both copies. Deduplication is a Silver decision (Q39, Q44); dropping rows at the door would make the archive incomplete.
- **Bronze is append-only.** Never update or delete it. Because it is complete and immutable, Silver and Gold can be rebuilt whenever their logic changes.
""",
    after="Snowflake's `COPY INTO` also remembers which files it has already loaded and skips them on a re-run, which makes the load itself idempotent for unchanged files ([docs](https://docs.snowflake.com/en/sql-reference/sql/copy-into-table)). DuckDB's `read_csv` has no such memory, so a re-run there loads the files again.",
    check="Grain: one row per row *delivered*, duplicates included. Run twice: on Snowflake, `COPY INTO`'s load history skips files it has seen; elsewhere, track loaded files yourself. NULL: an empty CSV field arrives as NULL or empty string depending on the file format, so decide which before Silver relies on it.",
)

q39 = Q(
    id="q39",
    title="Drop redelivered change events",
    level="Medium",
    pattern="Deduplication",
    prompt="""
The CDC tool delivers each change **at least once**, so the same change can appear twice in `bronze_account_cdc`. A change is identified by `(account_id, seq_no)`, where `seq_no` is the source log position. Reduce Bronze to one row per change, keeping the most recent delivery.
""",
    setup=f"""
CREATE TABLE bronze_account_cdc ({CDC_COLS});
INSERT INTO bronze_account_cdc VALUES
    ('I', 'ACC-1', 100.00, 'OPEN', TIMESTAMP '2025-03-01 09:00', 101, TIMESTAMP '2025-03-01 09:01'),
    ('I', 'ACC-1', 100.00, 'OPEN', TIMESTAMP '2025-03-01 09:00', 101, TIMESTAMP '2025-03-01 09:07'),
    ('U', 'ACC-1',  80.00, 'OPEN', TIMESTAMP '2025-03-01 12:00', 102, TIMESTAMP '2025-03-01 12:01'),
    ('I', 'ACC-2', 500.00, 'OPEN', TIMESTAMP '2025-03-01 10:00', 201, TIMESTAMP '2025-03-01 10:02');
""",
    show=["bronze_account_cdc"],
    answer="""
SELECT op, account_id, balance, status, source_ts, seq_no, _ingested_at
FROM bronze_account_cdc
QUALIFY ROW_NUMBER() OVER (PARTITION BY account_id, seq_no
                           ORDER BY _ingested_at DESC) = 1
ORDER BY account_id, seq_no;
""",
    hint="Which columns identify one change, as opposed to one account?",
    explain="""
- **`PARTITION BY account_id, seq_no`**: one *change* is one log position for one key. The two deliveries of change 101 collapse to one.
- **Not `PARTITION BY account_id`:** that would also collapse ACC-1's two *different* changes (101 and 102) into one. Removing redeliveries and reducing many changes to the latest are two separate steps, and confusing them loses history (Q40, Q42).
- **`ORDER BY _ingested_at DESC`**: the copies are identical, so either is fine; taking the latest delivery is a deterministic rule.
""",
    steps=[
        Step("Ranked", "Copies of the same change are numbered; only the first of each survives.",
             tables=[Show("bronze_account_cdc", "SELECT op, account_id, balance, seq_no, _ingested_at, ROW_NUMBER() OVER (PARTITION BY account_id, seq_no ORDER BY _ingested_at DESC) AS rn, CASE WHEN ROW_NUMBER() OVER (PARTITION BY account_id, seq_no ORDER BY _ingested_at DESC) = 1 THEN 'keep' ELSE 'drop' END AS _mark FROM bronze_account_cdc ORDER BY account_id, seq_no, rn")]),
        Step("Wrong key", "Partitioning by account alone also throws away ACC-1's first change.",
             tables=[Show("PARTITION BY account_id", "SELECT op, account_id, balance, seq_no, CASE WHEN ROW_NUMBER() OVER (PARTITION BY account_id ORDER BY seq_no DESC, _ingested_at DESC) = 1 THEN 'keep' WHEN seq_no = 101 THEN 'bad' ELSE 'drop' END AS _mark FROM bronze_account_cdc ORDER BY account_id, seq_no")]),
    ],
    trace_alt="Two steps: the duplicate delivery of change 101 is dropped while all three distinct changes survive; partitioning by account alone wrongly discards change 101.",
    check="Grain: one row per change `(account_id, seq_no)`. Run twice: read-only and deterministic. NULL: a change with a NULL `seq_no` can't be ordered or deduplicated reliably; reject it at Silver.",
)

q40 = Q(
    id="q40",
    title="Collapse a batch to the last change per account",
    level="Hard",
    pattern="CDC ordering",
    prompt="""
Before applying a batch to the current-state table, reduce it to the **last** change per account. Two of ACC-1's updates share the same `source_ts` (they committed in the same second). Pick the order key that gets the right final balance, and explain why.
""",
    setup=f"""
CREATE TABLE cdc_batch ({CDC_COLS});
INSERT INTO cdc_batch VALUES
    ('I', 'ACC-1', 100.00, 'OPEN', TIMESTAMP '2025-03-01 09:00:00', 101, TIMESTAMP '2025-03-01 09:01'),
    ('U', 'ACC-1',  50.00, 'OPEN', TIMESTAMP '2025-03-01 09:00:05', 102, TIMESTAMP '2025-03-01 09:01'),
    ('U', 'ACC-1',  80.00, 'OPEN', TIMESTAMP '2025-03-01 09:00:05', 103, TIMESTAMP '2025-03-01 09:01'),
    ('I', 'ACC-2', 500.00, 'OPEN', TIMESTAMP '2025-03-01 10:00:00', 201, TIMESTAMP '2025-03-01 10:02');
""",
    show=["cdc_batch"],
    answer="""
SELECT *
FROM cdc_batch
QUALIFY ROW_NUMBER() OVER (PARTITION BY account_id
                           ORDER BY seq_no DESC) = 1
ORDER BY account_id;
""",
    hint="Two rows have the same timestamp. Which column still tells you which one committed last?",
    explain="""
- **`seq_no` is the commit order.** It's the source database's log position, assigned in exactly the order changes were committed. ACC-1 went 100 → 50 → 80, so the final balance is 80.
- **`source_ts` can tie or skew.** Two commits in the same second share a timestamp, and timestamps from different source nodes can disagree. Ordered by `source_ts`, changes 102 and 103 tie, and the engine may pick 50: a balance the account no longer has (step 2).
- **Why collapse at all:** the `MERGE` that applies the batch (Q41) must see at most one source row per key, or it's nondeterministic and Snowflake rejects it ([docs](https://docs.snowflake.com/en/sql-reference/sql/merge)).
- Collapse only for the **current-state** table. A history table needs every change (Q42).
""",
    steps=[
        Step("By seq_no", "Ordered by log position, the last change is 103: balance 80.",
             tables=[Show("ordered by seq_no", "SELECT op, account_id, balance, source_ts, seq_no, CASE WHEN ROW_NUMBER() OVER (PARTITION BY account_id ORDER BY seq_no DESC) = 1 THEN 'keep' ELSE 'drop' END AS _mark FROM cdc_batch ORDER BY account_id, seq_no")]),
        Step("By source_ts", "Ordered by time, 102 and 103 tie, so either can win. Here the tie is broken the wrong way, as an engine is free to do.",
             tables=[Show("ordered by source_ts (tie broken badly)", "SELECT op, account_id, balance, source_ts, seq_no, CASE WHEN ROW_NUMBER() OVER (PARTITION BY account_id ORDER BY source_ts DESC, seq_no ASC) = 1 THEN (CASE WHEN seq_no = 102 THEN 'bad' ELSE 'keep' END) ELSE 'drop' END AS _mark FROM cdc_batch ORDER BY account_id, seq_no")]),
    ],
    trace_alt="Two steps: ordered by seq_no, ACC-1's last change is 103 with balance 80; ordered by the tied source timestamps, change 102 with balance 50 can win instead.",
    check="Grain: one row per account. Run twice: deterministic, because `seq_no` is unique per account. NULL: never order changes by a nullable or non-unique column.",
)

q41 = Q(
    id="q41",
    title="Apply inserts, updates and deletes with one MERGE",
    level="Hard",
    pattern="CDC apply",
    prompt="""
`silver_account` is the current state of every account. Apply the collapsed change set: insert on `I`, update on `U`, and **soft-delete** on `D` (set `is_deleted`). It must be safe to re-apply, including an `I` for an account that already exists and a `D` for one that never did.
""",
    setup=f"""
CREATE TABLE silver_account (account_id VARCHAR PRIMARY KEY, balance DECIMAL(12,2), status VARCHAR, is_deleted BOOLEAN, _updated_at TIMESTAMP);
INSERT INTO silver_account VALUES
    ('ACC-1', 100.00, 'OPEN', FALSE, TIMESTAMP '2025-02-28 09:00'),
    ('ACC-3', 900.00, 'OPEN', FALSE, TIMESTAMP '2025-02-28 09:00'),
    ('ACC-5', 300.00, 'OPEN', FALSE, TIMESTAMP '2025-02-28 09:00');
CREATE TABLE changes ({CDC_COLS});
INSERT INTO changes VALUES
    ('U', 'ACC-1',  80.00, 'OPEN',   TIMESTAMP '2025-03-01 09:00', 103, NULL),
    ('I', 'ACC-2', 500.00, 'OPEN',   TIMESTAMP '2025-03-01 10:00', 201, NULL),
    ('D', 'ACC-3',   NULL, NULL,     TIMESTAMP '2025-03-01 11:00', 301, NULL),
    ('D', 'ACC-4',   NULL, NULL,     TIMESTAMP '2025-03-01 11:30', 401, NULL),
    ('I', 'ACC-5', 300.00, 'FROZEN', TIMESTAMP '2025-03-01 12:00', 501, NULL);
""",
    show=["silver_account", "changes"],
    answer="""
MERGE INTO silver_account t
USING changes s
   ON t.account_id = s.account_id
WHEN MATCHED AND s.op = 'D' THEN UPDATE SET
    is_deleted = TRUE, _updated_at = s.source_ts
WHEN MATCHED AND s.op IN ('I', 'U') THEN UPDATE SET
    balance = s.balance, status = s.status, is_deleted = FALSE, _updated_at = s.source_ts
WHEN NOT MATCHED AND s.op IN ('I', 'U') THEN INSERT
    VALUES (s.account_id, s.balance, s.status, FALSE, s.source_ts);
""",
    result="SELECT * FROM silver_account ORDER BY account_id",
    diff=("silver_account", "account_id"),
    rerun=True,
    hint="`MERGE` can have several `WHEN MATCHED` branches, each with its own extra condition. What should happen to a `D` that matches nothing?",
    explain="""
- **Conditional branches** (`WHEN MATCHED AND s.op = 'D'`) let one statement handle all three operations. Branches are checked in order and the first that applies wins.
- **Soft delete:** ACC-3 stays, with `is_deleted = TRUE`. Readers filter `WHERE NOT is_deleted`. Physically deleting in Silver would lose the fact that the account existed and was closed, which history (Q42), downstream incremental loads and audits all need, and a replay from Bronze couldn't tell "deleted" from "never loaded".
- **An `I` for an existing key is treated as an update** (ACC-5). After a replay or an at-least-once redelivery, an insert can arrive for a row that's already there; treating it as an upsert keeps the statement idempotent instead of failing on the primary key.
- **A `D` for an unknown key does nothing** (ACC-4): no branch handles `NOT MATCHED` with `op = 'D'`, so it falls through. Deleting what isn't there is a no-op.
- `is_deleted = FALSE` on updates revives an account that's re-inserted after a delete.
""",
    check="Grain: one row per account, current state. Run twice: verified unchanged. NULL: the delete events carry NULL balances, which is fine because the delete branch doesn't copy them.",
)

q42 = Q(
    id="q42",
    title="SCD2 history from a change stream, keeping every change",
    level="Hard",
    pattern="SCD2 from CDC",
    prompt="""
Build `silver_account_history` from the full, deduplicated change set: one version per `I` or `U`, valid from its `source_ts` until the next change, with a `D` closing the account's last version without opening a new one. ACC-1 was frozen for a few hours on 1 March; that version must appear in the history.
""",
    setup=f"""
CREATE TABLE changes ({CDC_COLS});
INSERT INTO changes VALUES
    ('I', 'ACC-1', 100.00, 'OPEN',   TIMESTAMP '2025-03-01 09:00', 101, NULL),
    ('U', 'ACC-1', 100.00, 'FROZEN', TIMESTAMP '2025-03-01 12:00', 102, NULL),
    ('U', 'ACC-1',  80.00, 'OPEN',   TIMESTAMP '2025-03-02 08:00', 103, NULL),
    ('I', 'ACC-2', 500.00, 'OPEN',   TIMESTAMP '2025-03-01 10:00', 201, NULL),
    ('D', 'ACC-2',   NULL, NULL,     TIMESTAMP '2025-03-03 09:00', 202, NULL);
""",
    show=["changes"],
    answer="""
CREATE OR REPLACE TABLE silver_account_history AS
WITH ordered AS (
    SELECT *,
           LEAD(source_ts) OVER (PARTITION BY account_id ORDER BY seq_no) AS next_ts
    FROM changes
)
SELECT
    account_id, balance, status,
    source_ts                                       AS effective_from,
    COALESCE(next_ts, TIMESTAMP '9999-12-31 00:00')  AS effective_to,
    next_ts IS NULL                                 AS is_current,
    ROW_NUMBER() OVER (PARTITION BY account_id ORDER BY seq_no) AS version
FROM ordered
WHERE op IN ('I', 'U')
ORDER BY account_id, version;
""",
    result="SELECT * FROM silver_account_history ORDER BY account_id, version",
    hint="Don't collapse to the latest change here. Each change's window ends where the account's next change (of any kind) begins.",
    explain="""
- **Use every change, not the collapsed batch.** Collapsing to the last change per account (Q40) is right for the *current-state* table and wrong for history: ACC-1's FROZEN version would vanish, because a later change in the same batch replaced it (step 2). The original version of this exercise made exactly that mistake.
- **`LEAD(source_ts) OVER (PARTITION BY account_id ORDER BY seq_no)`** is the start of the next change, which is where this version's window ends. Ordering by `seq_no` (Q40) keeps it correct even when timestamps tie.
- **The `D` row is used, then dropped.** It's still in `ordered` when `LEAD` runs, so ACC-2's last version ends at the delete time. Then `WHERE op IN ('I', 'U')` removes the `D` row itself, so no version is opened for it. ACC-2 has no current version: correctly, it no longer exists.
- **`is_current = next_ts IS NULL`**: only the last version of a live account is open.

To maintain this incrementally, process each new batch the same way, and close the account's currently open version at the timestamp of its first new change.
""",
    steps=[
        Step("Windows", "Each change gets the next change's time as its end, including the delete that ends ACC-2's version.",
             tables=[Show("ordered changes", "SELECT op, account_id, status, balance, source_ts, LEAD(source_ts) OVER (PARTITION BY account_id ORDER BY seq_no) AS next_ts, CASE WHEN op = 'D' THEN 'drop' ELSE 'keep' END AS _mark FROM changes ORDER BY account_id, seq_no")]),
        Step("Collapsed (wrong)", "Built from the last change per account, the history loses ACC-1's FROZEN version.",
             tables=[Show("history from the collapsed batch", "SELECT account_id, status, balance, source_ts AS effective_from, 'bad' AS _mark FROM changes WHERE op IN ('I','U') QUALIFY ROW_NUMBER() OVER (PARTITION BY account_id ORDER BY seq_no DESC) = 1 ORDER BY 1")]),
        Step("History", "Every version, with contiguous windows. ACC-2's version closes at the delete and nothing is open after it.",
             run="CREATE OR REPLACE TABLE silver_account_history AS WITH ordered AS (SELECT *, LEAD(source_ts) OVER (PARTITION BY account_id ORDER BY seq_no) AS next_ts FROM changes) SELECT account_id, balance, status, source_ts AS effective_from, COALESCE(next_ts, TIMESTAMP '9999-12-31 00:00') AS effective_to, next_ts IS NULL AS is_current, ROW_NUMBER() OVER (PARTITION BY account_id ORDER BY seq_no) AS version FROM ordered WHERE op IN ('I', 'U')",
             tables=[Show("silver_account_history", "SELECT *, CASE WHEN status = 'FROZEN' THEN 'hit' ELSE 'new' END AS _mark FROM silver_account_history ORDER BY account_id, version")]),
    ],
    trace_alt="Three steps: each change paired with the next change's time, with the delete marked to be dropped after use; the collapsed history losing ACC-1's FROZEN version; and the full history with four versions and contiguous windows.",
    check="Grain: one row per account version. Run twice: `CREATE OR REPLACE` rebuilds the same table. NULL: the open version's end is a sentinel, not NULL, so as-of queries (post 06) can use a plain range predicate.",
)

# ------------------------------------------------------------------ silver loads

q43 = Q(
    id="q43",
    title="Which days did this batch touch?",
    level="Medium",
    pattern="Late-arriving facts",
    prompt="""
Gold has daily aggregates that already ran up to 4 March. Today's batch (everything in Bronze ingested after the watermark) contains transactions dated in the past. For each account, return the **earliest day** the batch touched and the list of days, so the pipeline knows which Gold days to recompute.
""",
    setup="""
CREATE TABLE bronze_txn (txn_id VARCHAR, account_id VARCHAR, txn_ts TIMESTAMP, amount DECIMAL(10,2), _ingested_at TIMESTAMP);
INSERT INTO bronze_txn VALUES
    ('T-1', 'ACC-1', TIMESTAMP '2025-03-01 09:00', 120.00, TIMESTAMP '2025-03-01 09:05'),
    ('T-2', 'ACC-1', TIMESTAMP '2025-03-04 18:00',  40.00, TIMESTAMP '2025-03-04 18:01'),
    ('T-7', 'ACC-1', TIMESTAMP '2025-03-02 11:00',  15.00, TIMESTAMP '2025-03-05 07:00'),
    ('T-8', 'ACC-2', TIMESTAMP '2025-03-05 06:30',  60.00, TIMESTAMP '2025-03-05 07:00'),
    ('T-9', 'ACC-1', TIMESTAMP '2025-03-05 06:45',  10.00, TIMESTAMP '2025-03-05 07:00');
CREATE TABLE etl_control (table_name VARCHAR, watermark_ts TIMESTAMP);
INSERT INTO etl_control VALUES ('silver_txn', TIMESTAMP '2025-03-04 23:59');
""",
    show=["bronze_txn", "etl_control"],
    answer="""
SELECT account_id,
       MIN(CAST(txn_ts AS DATE))                                       AS recompute_from,
       string_agg(DISTINCT CAST(CAST(txn_ts AS DATE) AS VARCHAR), ', ' ORDER BY CAST(CAST(txn_ts AS DATE) AS VARCHAR)) AS days_touched
FROM bronze_txn
WHERE _ingested_at > (SELECT watermark_ts FROM etl_control WHERE table_name = 'silver_txn')
GROUP BY account_id
ORDER BY account_id;
""",
    hint="Filter the batch by when it arrived, then group it by when the transactions happened.",
    explain="""
- **Select the batch by arrival** (`_ingested_at > watermark`), then **describe it by event time** (`txn_ts`). Mixing the two up is the root of most late-data bugs (Q27).
- **T-7 is late:** it happened on 2 March and arrived on 5 March, after 2 March's Gold aggregate had already run. Without this step, 2 March stays wrong forever.
- **`recompute_from`** matters for *cumulative* measures like a closing balance: a late row on 2 March changes 2 March **and every day after it**, so Q45 recomputes from this day forward, not just the late day itself.
- `string_agg(DISTINCT …)` lists the days for a log message; the pipeline uses `recompute_from`.
""",
    check="Grain: one row per account with new data. Run twice: read-only. NULL: a NULL `txn_ts` can't be placed on a day; quarantine it before this step.",
)

q44 = Q(
    id="q44",
    title="Keep the first delivery, and flag the ones that disagree",
    level="Medium",
    pattern="Deduplication",
    prompt="""
Transactions are immutable events, but the feed redelivers some. Load one row per `txn_id` into Silver, keeping the **first** delivery. One redelivery came back with a different amount; that's not a duplicate but a conflict, and it must be flagged rather than silently resolved.
""",
    setup="""
CREATE TABLE bronze_txn (txn_id VARCHAR, account_id VARCHAR, amount DECIMAL(10,2), merchant VARCHAR, _ingested_at TIMESTAMP);
INSERT INTO bronze_txn VALUES
    ('T-1', 'ACC-1', 120.00, 'Payroll', TIMESTAMP '2025-03-01 09:05'),
    ('T-2', 'ACC-1',  45.50, 'Cafe',    TIMESTAMP '2025-03-01 12:31'),
    ('T-2', 'ACC-1',  45.50, 'Cafe',    TIMESTAMP '2025-03-02 08:00'),
    ('T-3', 'ACC-2',  60.00, 'Grocer',  TIMESTAMP '2025-03-02 08:16'),
    ('T-3', 'ACC-2',  66.00, 'Grocer',  TIMESTAMP '2025-03-02 09:40');
""",
    show=["bronze_txn"],
    answer="""
SELECT
    txn_id, account_id, amount, merchant, _ingested_at,
    MIN(md5(concat_ws('|', account_id, amount, merchant))) OVER w
      <> MAX(md5(concat_ws('|', account_id, amount, merchant))) OVER w   AS has_conflict
FROM bronze_txn
WINDOW w AS (PARTITION BY txn_id)
QUALIFY ROW_NUMBER() OVER (PARTITION BY txn_id ORDER BY _ingested_at) = 1
ORDER BY txn_id;
""",
    hint="Keep-first is `ORDER BY _ingested_at` ascending. To spot a conflict, compare a fingerprint of the payload across all deliveries of the same id.",
    explain="""
- **Keep first for events, keep latest for records.** A transaction happened once, so its first record is the truth and later copies are redeliveries. A customer record genuinely changes, so there the latest version wins (Q11). Choosing the wrong rule either resurrects stale values or silently overwrites real ones.
- **T-2's copies are identical**, so dropping the second is safe.
- **T-3's copies disagree** (60.00 then 66.00). Keep-first would silently keep 60, keep-latest would silently keep 66, and either way nobody learns that the source sent two different stories. The window compares the smallest and largest payload fingerprint per `txn_id`; if they differ, the deliveries conflict. Route those rows to review (Q50) instead of letting a rule decide.
- In Postgres, which has no `QUALIFY`, wrap the query and filter on the row number.
""",
    steps=[
        Step("Deliveries", "Every delivery with its fingerprint. T-3's two fingerprints differ.",
             tables=[Show("bronze_txn", "SELECT txn_id, amount, _ingested_at, left(md5(concat_ws('|', account_id, amount, merchant)), 8) AS fingerprint, CASE WHEN txn_id = 'T-3' THEN 'hit' END AS _mark FROM bronze_txn ORDER BY txn_id, _ingested_at")]),
        Step("Result", "First delivery per id, with the conflict flagged.",
             tables=[Show("result", "SELECT txn_id, account_id, amount, merchant, MIN(md5(concat_ws('|', account_id, amount, merchant))) OVER w <> MAX(md5(concat_ws('|', account_id, amount, merchant))) OVER w AS has_conflict, CASE WHEN MIN(md5(concat_ws('|', account_id, amount, merchant))) OVER w <> MAX(md5(concat_ws('|', account_id, amount, merchant))) OVER w THEN 'bad' ELSE 'keep' END AS _mark FROM bronze_txn WINDOW w AS (PARTITION BY txn_id) QUALIFY ROW_NUMBER() OVER (PARTITION BY txn_id ORDER BY _ingested_at) = 1 ORDER BY txn_id")]),
    ],
    trace_alt="Two steps: every delivery with a payload fingerprint, where T-3's two fingerprints differ; and the result with one row per transaction and T-3 flagged as a conflict.",
    check="Grain: one row per `txn_id`. NULL: `concat_ws` skips NULLs on DuckDB and Postgres, so for a real fingerprint use Q19's NULL-safe recipe.",
)

q45 = Q(
    id="q45",
    title="Recompute a cumulative Gold table after late data",
    level="Hard",
    pattern="Idempotent Gold",
    prompt="""
`gold_daily_balance` has one row per account per day from 1 to 4 March: the closing balance (opening balance plus all transactions to date) and the day's transaction count, including days with no transactions. A late transaction for 2 March just arrived (`affected` comes from Q43). Recompute only what it changed, idempotently.
""",
    setup="""
CREATE TABLE account_opening (account_id VARCHAR, opening_balance DECIMAL(12,2));
INSERT INTO account_opening VALUES ('ACC-1', 1000.00);
CREATE TABLE silver_txn (txn_id VARCHAR, account_id VARCHAR, txn_ts TIMESTAMP, signed_amount DECIMAL(12,2));
INSERT INTO silver_txn VALUES
    ('T-1', 'ACC-1', TIMESTAMP '2025-03-01 09:00', 120.00),
    ('T-2', 'ACC-1', TIMESTAMP '2025-03-04 18:00', -40.00);
CREATE TABLE gold_daily_balance AS
WITH days AS (SELECT CAST(d AS DATE) AS d FROM generate_series(DATE '2025-03-01', DATE '2025-03-04', INTERVAL 1 DAY) t(d)),
daily AS (
    SELECT a.account_id, days.d,
           COALESCE(SUM(t.signed_amount), 0) AS net_change, COUNT(t.txn_id) AS txn_count
    FROM account_opening a CROSS JOIN days
    LEFT JOIN silver_txn t ON t.account_id = a.account_id AND CAST(t.txn_ts AS DATE) = days.d
    GROUP BY ALL
)
SELECT d AS balance_date, daily.account_id,
       a.opening_balance + SUM(net_change) OVER (PARTITION BY daily.account_id ORDER BY d) AS closing_balance,
       txn_count
FROM daily JOIN account_opening a USING (account_id);

INSERT INTO silver_txn VALUES ('T-7', 'ACC-1', TIMESTAMP '2025-03-02 11:00', -15.00);   -- the late arrival
CREATE TABLE affected AS SELECT 'ACC-1' AS account_id, DATE '2025-03-02' AS recompute_from;
""",
    show=["gold_daily_balance", "silver_txn", "affected"],
    answer="""
DELETE FROM gold_daily_balance g
USING affected a
WHERE g.account_id = a.account_id
  AND g.balance_date >= a.recompute_from;

INSERT INTO gold_daily_balance
WITH days AS (
    SELECT CAST(d AS DATE) AS d
    FROM generate_series(DATE '2025-03-01', DATE '2025-03-04', INTERVAL 1 DAY) t(d)
),
daily AS (                                     -- every account x every day, empty days included
    SELECT o.account_id, days.d,
           COALESCE(SUM(t.signed_amount), 0) AS net_change,
           COUNT(t.txn_id)                   AS txn_count
    FROM account_opening o
    CROSS JOIN days
    LEFT JOIN silver_txn t
           ON t.account_id = o.account_id AND CAST(t.txn_ts AS DATE) = days.d
    GROUP BY ALL
),
running AS (                                   -- cumulative over the FULL history
    SELECT daily.*,
           o.opening_balance + SUM(net_change) OVER (PARTITION BY daily.account_id ORDER BY d) AS closing_balance
    FROM daily JOIN account_opening o USING (account_id)
)
SELECT r.d, r.account_id, r.closing_balance, r.txn_count
FROM running r
JOIN affected a ON a.account_id = r.account_id AND r.d >= a.recompute_from;
""",
    result="SELECT * FROM gold_daily_balance ORDER BY account_id, balance_date",
    diff=("gold_daily_balance", "balance_date, account_id"),
    rerun=True,
    hint="A late row on 2 March changes the closing balance of 2 March and of every day after it. And days with no transactions still need a row.",
    explain="""
- **Recompute from the earliest affected day forward.** The closing balance is cumulative, so T-7 lowers 2, 3 and 4 March by $15. Recomputing only 2 March would leave 3 and 4 March contradicting it.
- **The running sum runs over the full history**, then the final `JOIN affected` keeps only the rows to replace. Computing the running sum over only the affected days would restart it from zero.
- **The opening balance** is the starting point of every account's running sum. Without it, the "closing balance" is just the sum of transactions, which is wrong for any account that existed before the warehouse.
- **The day spine** gives 3 March a row (no transactions, balance carried forward). Grouping the transactions alone would skip it, and a balance chart would have a hole.
- **Delete-then-insert** over the affected range makes the step idempotent: run it twice and the same rows are replaced with the same values. The build verified it. A `MERGE` on `(balance_date, account_id)` would also work here, but delete-then-insert is simpler when whole ranges are recomputed.
""",
    check="Grain: one row per account per day, every day. Run twice: verified unchanged. NULL: `COALESCE(SUM(...), 0)` turns an empty day's NULL into a zero change, so the running sum carries the balance forward.",
)

q46 = Q(
    id="q46",
    title="A running balance that doesn't jump on ties",
    level="Hard",
    pattern="Window frames",
    prompt="""
Show the balance after **each** transaction for ACC-1, starting from an opening balance of 1,000. Two transactions share the same timestamp. Each row must show the balance after that row alone, in a repeatable order.
""",
    setup="""
CREATE TABLE silver_txn (txn_id VARCHAR, account_id VARCHAR, txn_ts TIMESTAMP, signed_amount DECIMAL(12,2));
INSERT INTO silver_txn VALUES
    ('T-1', 'ACC-1', TIMESTAMP '2025-03-01 09:00', 120.00),
    ('T-2', 'ACC-1', TIMESTAMP '2025-03-01 12:30', -45.50),
    ('T-3', 'ACC-1', TIMESTAMP '2025-03-01 12:30', -20.00),
    ('T-4', 'ACC-1', TIMESTAMP '2025-03-02 08:00', -10.00);
""",
    show=["silver_txn"],
    answer="""
SELECT txn_id, txn_ts, signed_amount,
       1000.00 + SUM(signed_amount) OVER (
           PARTITION BY account_id
           ORDER BY txn_ts, txn_id
           ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
       ) AS running_balance
FROM silver_txn
ORDER BY txn_ts, txn_id;
""",
    hint="With only `ORDER BY txn_ts`, the default window frame treats rows with the same timestamp as one group.",
    explain="""
- **`ORDER BY txn_ts, txn_id`** adds a tiebreaker, so the order of T-2 and T-3 is the same on every run.
- **`ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW`** accumulates row by row.
- **The trap:** when a window has `ORDER BY` and no explicit frame, the SQL default is `RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW`, and `RANGE` includes every *peer* (row with the same `ORDER BY` value) in the current row's frame ([Postgres docs](https://www.postgresql.org/docs/current/sql-expressions.html#SYNTAX-WINDOW-FUNCTIONS)). T-2 and T-3 then both show 1,054.50, the balance after *both* of them, and the intermediate balance of 1,074.50 never appears (step 1). The end-of-day total is right, which is why this survives testing, but a statement or an overdraft check that reads it is wrong.
""",
    steps=[
        Step("Default frame", "ORDER BY txn_ts only: the tied rows share one value, the balance after both.",
             tables=[Show("default (RANGE) frame", "SELECT txn_id, txn_ts, signed_amount, 1000.00 + SUM(signed_amount) OVER (PARTITION BY account_id ORDER BY txn_ts) AS running_balance, CASE WHEN txn_id = 'T-2' THEN 'bad' END AS _mark FROM silver_txn ORDER BY txn_ts, txn_id")]),
        Step("ROWS frame", "With a tiebreaker and a ROWS frame, every row shows its own balance.",
             tables=[Show("ROWS frame", "SELECT txn_id, txn_ts, signed_amount, 1000.00 + SUM(signed_amount) OVER (PARTITION BY account_id ORDER BY txn_ts, txn_id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS running_balance, CASE WHEN txn_id = 'T-2' THEN 'keep' END AS _mark FROM silver_txn ORDER BY txn_ts, txn_id")]),
    ],
    trace_alt="Two steps: with the default frame, the two transactions at 12:30 both show 1054.50; with a ROWS frame and a tiebreaker, T-2 shows 1074.50 and T-3 1054.50.",
    check="Grain: one row per transaction. Run twice: repeatable only because of the `txn_id` tiebreak. NULL: a NULL amount is skipped by `SUM`, so the balance carries over that row unchanged; decide if that's acceptable or reject such rows in Silver.",
)

q47 = Q(
    id="q47",
    title="Debits and credits side by side",
    level="Medium",
    pattern="Pivot",
    prompt="""
Per account and month, return two columns, `total_debit` and `total_credit`, from `silver_txn.direction`. An account with only credits in a month must show a debit of 0.
""",
    setup="""
CREATE TABLE silver_txn (txn_id VARCHAR, account_id VARCHAR, txn_ts TIMESTAMP, amount DECIMAL(10,2), direction VARCHAR);
INSERT INTO silver_txn VALUES
    ('T-1', 'ACC-1', TIMESTAMP '2025-03-01 09:00', 120.00, 'CREDIT'),
    ('T-2', 'ACC-1', TIMESTAMP '2025-03-01 12:30',  45.50, 'DEBIT'),
    ('T-3', 'ACC-1', TIMESTAMP '2025-03-20 08:00',  20.00, 'DEBIT'),
    ('T-4', 'ACC-2', TIMESTAMP '2025-03-05 10:00', 500.00, 'CREDIT');
""",
    show=["silver_txn"],
    answer="""
SELECT account_id,
       CAST(date_trunc('month', txn_ts) AS DATE)                    AS month,
       SUM(CASE WHEN direction = 'DEBIT'  THEN amount ELSE 0 END)   AS total_debit,
       SUM(CASE WHEN direction = 'CREDIT' THEN amount ELSE 0 END)   AS total_credit
FROM silver_txn
GROUP BY ALL
ORDER BY account_id, month;
""",
    display="""
SELECT *
FROM (SELECT account_id, DATE_TRUNC('month', txn_ts) AS month, direction, amount FROM silver_txn)
PIVOT (SUM(amount) FOR direction IN ('DEBIT', 'CREDIT'))
    AS p (account_id, month, total_debit, total_credit);
-- PIVOT leaves a NULL where a month has no rows of one kind: wrap with COALESCE if 0 is wanted.
""",
    hint="One `SUM(CASE …)` per output column.",
    explain="""
- **Conditional aggregation** turns values of `direction` into columns: each `SUM(CASE …)` adds only its kind of row. `ELSE 0` makes a missing kind 0 rather than NULL.
- **`date_trunc('month', …)`** buckets timestamps by month.
- **Snowflake's `PIVOT`** is shorter but needs the value list written out, and it returns NULL for a missing kind ([docs](https://docs.snowflake.com/en/sql-reference/constructs/pivot)). The `CASE` form works on every engine and handles derived buckets, which is why it's the usual choice in pipelines.
""",
    check="Grain: one row per account and month. NULL: a NULL `direction` falls into neither column, so those rows disappear from both totals. Quarantine them first (Q50).",
)

q48 = Q(
    id="q48",
    title="Find dormant stretches, including at the edges",
    level="Hard",
    pattern="Gaps and islands",
    prompt="""
Find every stretch of **5 or more** days with no transactions, per account, between the day it opened and the reporting date 2025-03-31. Include the stretch before the first transaction and the one after the last.
""",
    setup="""
CREATE TABLE accounts (account_id VARCHAR, opened_date DATE);
INSERT INTO accounts VALUES ('ACC-1', DATE '2025-03-01'), ('ACC-2', DATE '2025-03-01');
CREATE TABLE silver_txn (txn_id VARCHAR, account_id VARCHAR, txn_ts TIMESTAMP);
INSERT INTO silver_txn VALUES
    ('T-1', 'ACC-1', TIMESTAMP '2025-03-01 09:00'), ('T-2', 'ACC-1', TIMESTAMP '2025-03-03 10:00'),
    ('T-3', 'ACC-1', TIMESTAMP '2025-03-12 11:00'), ('T-4', 'ACC-1', TIMESTAMP '2025-03-29 12:00'),
    ('T-5', 'ACC-2', TIMESTAMP '2025-03-10 08:00');
""",
    show=["accounts", "silver_txn"],
    answer="""
WITH marks AS (                          -- active days, plus a marker before the start and after the end
    SELECT DISTINCT account_id, CAST(txn_ts AS DATE) AS d FROM silver_txn
    UNION
    SELECT account_id, opened_date - 1 FROM accounts
    UNION
    SELECT account_id, DATE '2025-03-31' + 1 FROM accounts
),
gaps AS (
    SELECT account_id, d,
           LAG(d) OVER (PARTITION BY account_id ORDER BY d) AS prev_d
    FROM marks
)
SELECT account_id,
       prev_d + 1           AS gap_start,
       d - 1                AS gap_end,
       d - prev_d - 1       AS gap_days
FROM gaps
WHERE d - prev_d - 1 >= 5
ORDER BY account_id, gap_start;
""",
    hint="`LAG` over the active days finds gaps *between* transactions. Add two fake marker days so the edges become gaps between markers too.",
    explain="""
- **`LAG(d)`** pairs each active day with the previous one; the days strictly between them (`d − prev_d − 1`) are dormant.
- **Edge markers:** the obvious query only measures gaps *between* transactions, so it misses ACC-2's nine dormant days after opening and its 21 quiet days at the end of the period. Adding a marker the day before opening and the day after the reporting date turns those edges into ordinary gaps.
- **`UNION`, not `UNION ALL`**, so a transaction on the marker day doesn't create a zero-length duplicate.
- Dates subtract to whole days in DuckDB, Postgres and Snowflake; use `DATEDIFF('day', …)` if your engine needs it.
""",
    steps=[
        Step("Markers", "Active days plus the two edge markers, with the gap since the previous one.",
             tables=[Show("marks", "WITH marks AS (SELECT DISTINCT account_id, CAST(txn_ts AS DATE) AS d, 'active' AS kind FROM silver_txn UNION SELECT account_id, opened_date - 1, 'start marker' FROM accounts UNION SELECT account_id, DATE '2025-03-31' + 1, 'end marker' FROM accounts) SELECT account_id, d, kind, d - LAG(d) OVER (PARTITION BY account_id ORDER BY d) - 1 AS days_since_prev, CASE WHEN d - LAG(d) OVER (PARTITION BY account_id ORDER BY d) - 1 >= 5 THEN 'hit' END AS _mark FROM marks ORDER BY 1, 2")]),
        Step("Without markers", "Gaps between transactions only: ACC-2 has a single transaction, so both of its dormant stretches are missed.",
             tables=[Show("between transactions only", "WITH a AS (SELECT DISTINCT account_id, CAST(txn_ts AS DATE) AS d FROM silver_txn), g AS (SELECT account_id, d, LAG(d) OVER (PARTITION BY account_id ORDER BY d) AS prev_d FROM a) SELECT account_id, prev_d + 1 AS gap_start, d - 1 AS gap_end, d - prev_d - 1 AS gap_days FROM g WHERE d - prev_d - 1 >= 5 ORDER BY 1, 2")]),
    ],
    trace_alt="Two steps: active days with start and end markers and the days since the previous one, highlighting gaps of five or more; and the version without markers, which finds only ACC-1's two gaps between transactions and none of ACC-2's.",
    check="Grain: one row per dormant stretch. NULL: `LAG` is NULL on each account's first row, the comparison is unknown, and the row is filtered out, which is right because the start marker is always first.",
)

q49 = Q(
    id="q49",
    title="Three transactions inside ten minutes",
    level="Hard",
    pattern="Sliding windows",
    prompt="""
Flag every moment an account has **3 or more transactions within a 10-minute window** (a simple velocity check for fraud). For each flagged transaction, return the account, the transaction that completes the burst, and how many transactions fell in the 10 minutes ending at it.
""",
    setup="""
CREATE TABLE silver_txn (txn_id VARCHAR, account_id VARCHAR, txn_ts TIMESTAMP);
INSERT INTO silver_txn VALUES
    ('T-1', 'ACC-1', TIMESTAMP '2025-03-01 10:00'), ('T-2', 'ACC-1', TIMESTAMP '2025-03-01 10:04'),
    ('T-3', 'ACC-1', TIMESTAMP '2025-03-01 10:09'), ('T-4', 'ACC-1', TIMESTAMP '2025-03-01 10:15'),
    ('T-5', 'ACC-2', TIMESTAMP '2025-03-01 10:00'), ('T-6', 'ACC-2', TIMESTAMP '2025-03-01 10:11'),
    ('T-7', 'ACC-2', TIMESTAMP '2025-03-01 10:20');
""",
    show=["silver_txn"],
    answer="""
SELECT a.account_id, a.txn_id, a.txn_ts, COUNT(*) AS txns_in_window
FROM silver_txn a
JOIN silver_txn b
  ON b.account_id = a.account_id
 AND b.txn_ts >  a.txn_ts - INTERVAL 10 MINUTE
 AND b.txn_ts <= a.txn_ts
GROUP BY a.account_id, a.txn_id, a.txn_ts
HAVING COUNT(*) >= 3
ORDER BY a.account_id, a.txn_ts;
""",
    hint="For each transaction, count the transactions in the 10 minutes ending at it.",
    explain="""
- **Each transaction is the end of a window** `(t − 10 min, t]`. The self-join collects every transaction of the same account in that window, including itself, and `HAVING COUNT(*) >= 3` keeps the bursts. T-3 at 10:09 sees T-1, T-2 and itself.
- **The half-open window** (`>` on the left) means a transaction exactly 10 minutes earlier doesn't count. Choose the boundary deliberately; it's a business rule.
- **The trade-off:** a self-join compares every pair of an account's transactions, which is slow for a busy account. A window function does it in one sorted pass: `COUNT(*) OVER (PARTITION BY account_id ORDER BY txn_ts RANGE BETWEEN INTERVAL 10 MINUTE PRECEDING AND CURRENT ROW)`. DuckDB and Postgres support interval offsets in `RANGE` frames; check your engine's window-frame documentation before relying on it, because support varies.
- ACC-2's transactions are 11 and 9 minutes apart, so no 10-minute window ever holds three.
""",
    check="Grain: one row per transaction that completes a burst. NULL: a NULL `txn_ts` matches no window; it can't be placed in time, so reject it in Silver.",
)

# ------------------------------------------------------------------ quality

q50 = Q(
    id="q50",
    title="Quarantine bad rows, and make sure none fall through",
    level="Medium",
    pattern="Data contracts",
    prompt="""
Silver transactions must have `amount <> 0` and `direction` in (`DEBIT`, `CREDIT`). Load valid rows into `silver_txn` and everything else into `reject_txn` with a reason. Every Bronze row must land in **exactly one** of the two tables.
""",
    setup="""
CREATE TABLE bronze_txn (txn_id VARCHAR, amount DECIMAL(10,2), direction VARCHAR);
INSERT INTO bronze_txn VALUES
    ('T-1', 120.00, 'CREDIT'), ('T-2', 0.00, 'DEBIT'), ('T-3', 45.50, 'REFUND'),
    ('T-4', NULL,   'DEBIT'),  ('T-5', 30.00, NULL),   ('T-6', 12.00, 'DEBIT');
CREATE TABLE silver_txn (txn_id VARCHAR, amount DECIMAL(10,2), direction VARCHAR);
CREATE TABLE reject_txn (txn_id VARCHAR, amount DECIMAL(10,2), direction VARCHAR, reject_reason VARCHAR);
""",
    show=["bronze_txn"],
    answer="""
CREATE OR REPLACE TEMP TABLE checked AS
SELECT *,
       COALESCE(amount <> 0 AND direction IN ('DEBIT', 'CREDIT'), FALSE) AS is_valid
FROM bronze_txn;

INSERT INTO silver_txn
SELECT txn_id, amount, direction FROM checked WHERE is_valid;

INSERT INTO reject_txn
SELECT txn_id, amount, direction,
       CASE WHEN amount IS NULL                       THEN 'MISSING_AMOUNT'
            WHEN amount = 0                           THEN 'ZERO_AMOUNT'
            WHEN direction IS NULL                    THEN 'MISSING_DIRECTION'
            ELSE                                           'BAD_DIRECTION' END
FROM checked
WHERE NOT is_valid;
""",
    result="""
SELECT 'silver_txn' AS target, txn_id, NULL AS reject_reason FROM silver_txn
UNION ALL SELECT 'reject_txn', txn_id, reject_reason FROM reject_txn
ORDER BY txn_id
""",
    hint="Write the rule once, as a column that can only be TRUE or FALSE, then route on it. What does `NULL <> 0 AND …` evaluate to?",
    explain="""
- **The contract becomes one boolean column**, `is_valid`, and both inserts route on it, so the two sides can't disagree.
- **`COALESCE(…, FALSE)` is the critical part.** For T-4 (NULL amount) and T-5 (NULL direction) the rule evaluates to UNKNOWN, not FALSE. With the obvious pair of filters, `WHERE rule` for Silver and `WHERE NOT (rule)` for rejects, both evaluate to UNKNOWN for those rows, so they land in **neither** table and silently disappear (step 2). Forcing UNKNOWN to FALSE sends them to quarantine.
- **The reasons** are checked in order, NULLs first, so each rejected row gets the most specific reason.
- **Quarantine, don't drop:** rejected rows can be investigated, fixed upstream and replayed. Snowflake now enforces `CHECK` constraints too (post 01, Q1), but a failed check aborts the whole insert; routing rows keeps the good ones flowing.
- **Prove it:** count Bronze rows, Silver rows and rejected rows, and fail the run unless they add up.
""",
    steps=[
        Step("Two filters", "With WHERE rule and WHERE NOT rule, the rows with NULLs evaluate to unknown on both sides.",
             tables=[Show("rule per row", "SELECT txn_id, amount, direction, amount <> 0 AND direction IN ('DEBIT','CREDIT') AS rule, CASE WHEN (amount <> 0 AND direction IN ('DEBIT','CREDIT')) IS NULL THEN 'bad' WHEN amount <> 0 AND direction IN ('DEBIT','CREDIT') THEN 'keep' ELSE 'drop' END AS _mark FROM bronze_txn ORDER BY txn_id")]),
        Step("Lost rows", "Row counts with the naive filters: two rows land nowhere.",
             tables=[Show("naive routing", "SELECT (SELECT count(*) FROM bronze_txn) AS bronze_rows, (SELECT count(*) FROM bronze_txn WHERE amount <> 0 AND direction IN ('DEBIT','CREDIT')) AS to_silver, (SELECT count(*) FROM bronze_txn WHERE NOT (amount <> 0 AND direction IN ('DEBIT','CREDIT'))) AS to_reject, 'bad' AS _mark")]),
        Step("Fixed", "With COALESCE(rule, FALSE), every row lands exactly once.",
             tables=[Show("fixed routing", "SELECT (SELECT count(*) FROM bronze_txn) AS bronze_rows, (SELECT count(*) FROM bronze_txn WHERE COALESCE(amount <> 0 AND direction IN ('DEBIT','CREDIT'), FALSE)) AS to_silver, (SELECT count(*) FROM bronze_txn WHERE NOT COALESCE(amount <> 0 AND direction IN ('DEBIT','CREDIT'), FALSE)) AS to_reject, 'keep' AS _mark")]),
    ],
    trace_alt="Three steps: the rule per row, unknown for the two rows with NULLs; naive routing that sends 2 rows to Silver and 2 to rejects out of 6, losing 2; fixed routing that sends 2 to Silver and 4 to rejects.",
    check="Grain: every Bronze row in exactly one target. Run twice: these inserts append again, so in a pipeline they sit behind a watermark (Q27) or replace the batch. NULL: the whole point. A rule that can be UNKNOWN routes nowhere unless you collapse it to TRUE or FALSE.",
)

q51 = Q(
    id="q51",
    title="Reconcile two layers with checksums",
    level="Hard",
    pattern="Reconciliation",
    prompt="""
Check whether `silver_account` (live accounts only) matches a fresh `src_account_snapshot`. First compare a cheap aggregate checksum of each side; only if they differ, list the accounts that differ and how.
""",
    setup="""
CREATE TABLE silver_account (account_id VARCHAR, balance DECIMAL(12,2), status VARCHAR, is_deleted BOOLEAN);
INSERT INTO silver_account VALUES
    ('ACC-1', 80.00, 'OPEN', FALSE), ('ACC-2', 500.00, 'OPEN', FALSE),
    ('ACC-3', 900.00, 'OPEN', TRUE), ('ACC-5', 300.00, 'FROZEN', FALSE),
    ('ACC-7', 60.00, 'OPEN', FALSE);
CREATE TABLE src_account_snapshot (account_id VARCHAR, balance DECIMAL(12,2), status VARCHAR);
INSERT INTO src_account_snapshot VALUES
    ('ACC-1', 80.00, 'OPEN'), ('ACC-2', 450.00, 'OPEN'), ('ACC-5', 300.00, 'FROZEN'), ('ACC-6', 75.00, 'OPEN');
""",
    show=["silver_account", "src_account_snapshot"],
    answer="""
-- 1. One pass per side, no join
SELECT 'silver' AS side, COUNT(*) AS row_count, SUM(hash(account_id, balance, status)) AS checksum
FROM silver_account WHERE NOT is_deleted
UNION ALL
SELECT 'source', COUNT(*), SUM(hash(account_id, balance, status))
FROM src_account_snapshot;

-- 2. Only when they differ: the row-level diff
SELECT COALESCE(s.account_id, x.account_id) AS account_id,
       CASE WHEN s.account_id IS NULL THEN 'missing in silver'
            WHEN x.account_id IS NULL THEN 'missing in source'
            ELSE 'values differ' END   AS problem
FROM (SELECT * FROM silver_account WHERE NOT is_deleted) s
FULL OUTER JOIN src_account_snapshot x ON x.account_id = s.account_id
WHERE s.account_id IS NULL OR x.account_id IS NULL
   OR hash(s.balance, s.status) <> hash(x.balance, x.status)
ORDER BY account_id;
""",
    hint="`SUM` doesn't care about row order, so a sum of row hashes fingerprints a whole table in one scan.",
    explain="""
- **`SUM(hash(…))` is an order-independent fingerprint** of a table. Together with the row count, matching sums mean the tables almost certainly match, and it costs one scan per side with no join. On huge tables that's the check you can afford to run every time.
- **Step 2 runs only when step 1 disagrees.** The `FULL OUTER JOIN` finds keys missing on either side (ACC-6 is only in the source, ACC-7 only in Silver), and comparing row hashes finds keys whose values differ (ACC-2's balance).
- **Why the count isn't enough:** both sides have four live rows, so a row-count check passes even though three accounts are wrong.
- **Compare like with like:** soft-deleted ACC-3 is excluded from Silver because the source snapshot only has live accounts.
- `hash()` is engine-specific (DuckDB and Snowflake both have one, with different outputs), so compute both sides on the same engine. To compare across engines, use `md5` of a NULL-safe string (Q19).
""",
    steps=[
        Step("Checksums", "Both sides have four rows, so a count check passes, but the checksums differ.",
             tables=[Show("aggregate check", "SELECT 'silver' AS side, COUNT(*) AS row_count, SUM(hash(account_id, balance, status)) AS checksum FROM silver_account WHERE NOT is_deleted UNION ALL SELECT 'source', COUNT(*), SUM(hash(account_id, balance, status)) FROM src_account_snapshot")]),
        Step("Diff", "The targeted diff names the accounts.",
             tables=[Show("differences", "SELECT COALESCE(s.account_id, x.account_id) AS account_id, s.balance AS silver_balance, x.balance AS source_balance, CASE WHEN s.account_id IS NULL THEN 'missing in silver' WHEN x.account_id IS NULL THEN 'missing in source' ELSE 'values differ' END AS problem, 'bad' AS _mark FROM (SELECT * FROM silver_account WHERE NOT is_deleted) s FULL OUTER JOIN src_account_snapshot x ON x.account_id = s.account_id WHERE s.account_id IS NULL OR x.account_id IS NULL OR hash(s.balance, s.status) <> hash(x.balance, x.status) ORDER BY 1")]),
    ],
    trace_alt="Two steps: equal row counts of 4 with different checksums; and the diff naming ACC-2 with balances 500 against 450, ACC-6 missing in Silver and ACC-7 missing in the source.",
    expected_title="Expected output (the row-level diff)",
    check="Grain: one row per mismatched account. Run twice: read-only. NULL: `hash(NULL)` is a fixed value on DuckDB, but a NULL inside a hashed string can behave differently elsewhere; use the NULL-safe recipe for cross-engine checks.",
)

q52 = Q(
    id="q52",
    title="A customer 360 that doesn't multiply balances",
    level="Hard",
    pattern="Serving and fan-out",
    prompt="""
Build `gold_customer_360`, one row per customer: number of live accounts, total balance of live accounts, last transaction time and number of transactions. A customer whose accounts have no transactions must still appear. Show the bug in joining accounts to transactions and then summing balances.
""",
    setup="""
CREATE TABLE silver_account (account_id VARCHAR, customer_id VARCHAR, balance DECIMAL(12,2), is_deleted BOOLEAN);
INSERT INTO silver_account VALUES
    ('ACC-1', 'CUST-1', 1000.00, FALSE), ('ACC-2', 'CUST-1', 500.00, FALSE),
    ('ACC-3', 'CUST-2', 250.00, FALSE), ('ACC-4', 'CUST-2', 900.00, TRUE);
CREATE TABLE silver_txn (txn_id VARCHAR, account_id VARCHAR, txn_ts TIMESTAMP);
INSERT INTO silver_txn VALUES
    ('T-1', 'ACC-1', TIMESTAMP '2025-03-01 09:00'), ('T-2', 'ACC-1', TIMESTAMP '2025-03-02 10:00'),
    ('T-3', 'ACC-1', TIMESTAMP '2025-03-03 11:00'), ('T-4', 'ACC-2', TIMESTAMP '2025-03-02 12:00');
""",
    show=["silver_account", "silver_txn"],
    answer="""
WITH acct AS (                                -- one row per customer, from accounts alone
    SELECT customer_id,
           COUNT(*)     AS live_accounts,
           SUM(balance) AS total_balance
    FROM silver_account
    WHERE NOT is_deleted
    GROUP BY customer_id
),
txn AS (                                      -- one row per customer, from transactions alone
    SELECT a.customer_id, MAX(t.txn_ts) AS last_txn_ts, COUNT(*) AS txn_count
    FROM silver_txn t
    JOIN silver_account a ON a.account_id = t.account_id
    WHERE NOT a.is_deleted
    GROUP BY a.customer_id
)
SELECT acct.customer_id, live_accounts, total_balance, last_txn_ts,
       COALESCE(txn_count, 0) AS txn_count
FROM acct
LEFT JOIN txn ON txn.customer_id = acct.customer_id
ORDER BY acct.customer_id;
""",
    hint="Each account's balance appears once per transaction after the join. Aggregate each side to the customer before joining them.",
    explain="""
- **The fan-out:** joining accounts to transactions repeats ACC-1's row three times (it has three transactions). `SUM(balance)` over the joined rows counts its $1,000 three times, so CUST-1's balance comes out as $3,500 instead of $1,500 (step 1). `COUNT(DISTINCT account_id)` hides the problem for the account count, which makes the wrong balance easy to miss.
- **Aggregate each side to the output grain first** (one row per customer), then join one-to-one. The same rule as drill-across in post 02 (Q34).
- **`LEFT JOIN`** keeps CUST-2, whose live account has no transactions; an inner join would drop the customer entirely. `COALESCE(txn_count, 0)` reports zero rather than NULL.
- **Deleted accounts** are excluded on both sides, so ACC-4's $900 doesn't count.
""",
    steps=[
        Step("The bug", "Join first, then sum: each balance is repeated once per transaction.",
             tables=[Show("joined rows for CUST-1", "SELECT a.customer_id, a.account_id, a.balance, t.txn_id, 'bad' AS _mark FROM silver_account a LEFT JOIN silver_txn t ON t.account_id = a.account_id WHERE NOT a.is_deleted AND a.customer_id = 'CUST-1' ORDER BY 2, 4"),
                     Show("summed after the join", "SELECT a.customer_id, COUNT(DISTINCT a.account_id) AS live_accounts, SUM(a.balance) AS total_balance, CASE WHEN a.customer_id = 'CUST-1' THEN 'bad' END AS _mark FROM silver_account a LEFT JOIN silver_txn t ON t.account_id = a.account_id WHERE NOT a.is_deleted GROUP BY 1 ORDER BY 1")]),
        Step("Fixed", "Aggregate each side per customer, then join.",
             tables=[Show("gold_customer_360", "WITH acct AS (SELECT customer_id, COUNT(*) AS live_accounts, SUM(balance) AS total_balance FROM silver_account WHERE NOT is_deleted GROUP BY 1), txn AS (SELECT a.customer_id, MAX(t.txn_ts) AS last_txn_ts, COUNT(*) AS txn_count FROM silver_txn t JOIN silver_account a ON a.account_id = t.account_id WHERE NOT a.is_deleted GROUP BY 1) SELECT acct.customer_id, live_accounts, total_balance, last_txn_ts, COALESCE(txn_count, 0) AS txn_count, 'keep' AS _mark FROM acct LEFT JOIN txn USING (customer_id) ORDER BY 1")]),
    ],
    trace_alt="Two steps: the joined rows repeating ACC-1's 1000 balance three times, giving CUST-1 a total of 3500; and the fixed version with CUST-1 at 1500 and CUST-2 at 250 with zero transactions.",
    check="Grain: one row per customer with a live account. NULL: customers with no transactions get NULL `last_txn_ts`, which is honest, and a `txn_count` of 0.",
)

q53 = Q(
    id="q53",
    title="Which batch wrote this row, and is it stale?",
    level="Medium",
    pattern="Lineage",
    prompt="""
`silver_account` carries lineage columns: `_batch_id` (the run that last wrote the row), `_source_system` and `_record_hash` (a fingerprint of the business columns at write time). For each account, report the batch that last wrote it and whether it is **stale**: the current source data no longer matches what was written.
""",
    setup="""
CREATE TABLE silver_account (account_id VARCHAR, balance DECIMAL(12,2), status VARCHAR,
                             _batch_id VARCHAR, _source_system VARCHAR, _record_hash VARCHAR);
INSERT INTO silver_account VALUES
    ('ACC-1',  80.00, 'OPEN',   'B-0305', 'core-banking', md5('80.00|OPEN')),
    ('ACC-2', 500.00, 'OPEN',   'B-0301', 'core-banking', md5('500.00|OPEN')),
    ('ACC-5', 300.00, 'FROZEN', 'B-0304', 'core-banking', md5('300.00|FROZEN'));
CREATE TABLE src_account_snapshot (account_id VARCHAR, balance DECIMAL(12,2), status VARCHAR);
INSERT INTO src_account_snapshot VALUES ('ACC-1', 80.00, 'OPEN'), ('ACC-2', 450.00, 'OPEN'), ('ACC-5', 300.00, 'FROZEN');
""",
    show=["silver_account", "src_account_snapshot"],
    answer="""
SELECT s.account_id,
       s._batch_id                 AS last_written_by,
       s._source_system,
       s._record_hash <> md5(concat_ws('|', CAST(x.balance AS VARCHAR), x.status)) AS is_stale
FROM silver_account s
JOIN src_account_snapshot x USING (account_id)
ORDER BY s.account_id;
""",
    hint="Recompute the fingerprint from the source with exactly the same recipe, and compare.",
    explain="""
- **`_batch_id`** answers "which run wrote this?", which is the first question in any incident: you can find every row a bad run touched, and replay or roll back just those.
- **`_record_hash`** is a fingerprint of the business columns stored at write time. Recomputing it from the source with the **same recipe** and comparing gives a one-column staleness check: ACC-2's source balance moved to 450, so its Silver row is stale and was last written by batch B-0301.
- The recipe must match byte for byte: the same column order, separator, casts and NULL handling (Q19). A different cast (`450.0` vs `450.00`) makes every row look stale.
""",
    check="Grain: one row per account. Run twice: read-only. NULL: a NULL in a hashed column needs the NULL-safe recipe, or two different rows can share a fingerprint.",
)

q54 = Q(
    id="q54",
    title="A Silver refresh that is safe to run twice",
    level="Expert",
    pattern="Idempotent pipeline",
    prompt="""
Write the complete, re-runnable refresh of `silver_account` from `bronze_account_cdc`, as it would run in a scheduled task: read the watermark and fix the batch's upper bound, deduplicate redeliveries, collapse to the last change per account, apply inserts, updates and soft deletes, and advance the watermark. Running it twice in a row must change nothing the second time.
""",
    setup=f"""
CREATE TABLE bronze_account_cdc ({CDC_COLS});
INSERT INTO bronze_account_cdc VALUES
    ('I', 'ACC-1', 100.00, 'OPEN', TIMESTAMP '2025-03-01 09:00', 101, TIMESTAMP '2025-03-01 09:01'),
    ('I', 'ACC-1', 100.00, 'OPEN', TIMESTAMP '2025-03-01 09:00', 101, TIMESTAMP '2025-03-01 09:07'),
    ('U', 'ACC-1',  80.00, 'OPEN', TIMESTAMP '2025-03-01 12:00', 102, TIMESTAMP '2025-03-01 12:01'),
    ('I', 'ACC-2', 500.00, 'OPEN', TIMESTAMP '2025-03-01 10:00', 201, TIMESTAMP '2025-03-01 10:02'),
    ('D', 'ACC-2',   NULL, NULL,   TIMESTAMP '2025-03-01 15:00', 202, TIMESTAMP '2025-03-01 15:01');
CREATE TABLE silver_account (account_id VARCHAR PRIMARY KEY, balance DECIMAL(12,2), status VARCHAR, is_deleted BOOLEAN, _updated_at TIMESTAMP);
CREATE TABLE etl_control (table_name VARCHAR, watermark_ts TIMESTAMP);
INSERT INTO etl_control VALUES ('silver_account', TIMESTAMP '1900-01-01');
""",
    show=["bronze_account_cdc"],
    answer="""
-- 1. Freeze this run's window: (watermark, upper]
CREATE OR REPLACE TEMP TABLE run_window AS
SELECT (SELECT watermark_ts FROM etl_control WHERE table_name = 'silver_account') AS lower_ts,
       MAX(_ingested_at) AS upper_ts
FROM bronze_account_cdc
WHERE _ingested_at > (SELECT watermark_ts FROM etl_control WHERE table_name = 'silver_account');

-- 2. The change set: drop redeliveries, then keep the last change per account
CREATE OR REPLACE TEMP TABLE chg AS
WITH new_rows AS (
    SELECT c.* FROM bronze_account_cdc c, run_window w
    WHERE c._ingested_at > w.lower_ts AND c._ingested_at <= w.upper_ts
),
deduped AS (
    SELECT * FROM new_rows
    QUALIFY ROW_NUMBER() OVER (PARTITION BY account_id, seq_no ORDER BY _ingested_at DESC) = 1
)
SELECT * FROM deduped
QUALIFY ROW_NUMBER() OVER (PARTITION BY account_id ORDER BY seq_no DESC) = 1;

-- 3. Apply I/U/D (Q41)
MERGE INTO silver_account t
USING chg s ON t.account_id = s.account_id
WHEN MATCHED AND s.op = 'D' THEN UPDATE SET is_deleted = TRUE, _updated_at = s.source_ts
WHEN MATCHED AND s.op IN ('I', 'U') THEN UPDATE SET
    balance = s.balance, status = s.status, is_deleted = FALSE, _updated_at = s.source_ts
WHEN NOT MATCHED AND s.op IN ('I', 'U') THEN INSERT
    VALUES (s.account_id, s.balance, s.status, FALSE, s.source_ts);

-- 4. Advance the watermark to the bound this run used; an empty run leaves it alone
UPDATE etl_control
SET watermark_ts = COALESCE((SELECT upper_ts FROM run_window), watermark_ts)
WHERE table_name = 'silver_account';
""",
    result="SELECT a.*, (SELECT watermark_ts FROM etl_control) AS watermark_ts FROM silver_account a ORDER BY account_id",
    rerun=True,
    hint="List what could double-apply a change on a retry: redelivered events, several changes per key, a blind insert, a watermark that moves too far or not at all. Each step needs a guard against one of them.",
    explain="""
Each step carries a guard, and together they make the job safe to retry:

| Step | Guard | What it prevents |
| --- | --- | --- |
| 1 | The window `(watermark, upper]` is frozen before reading | Skipping rows that land mid-run (Q27) |
| 2 | Dedup on `(account_id, seq_no)` | Applying a redelivered change twice (Q39) |
| 2 | Last change per account by `seq_no` | A nondeterministic `MERGE` or a stale final state (Q40) |
| 3 | `MERGE` instead of `INSERT` | Duplicate rows; re-applying a change is a no-op (Q41) |
| 4 | `COALESCE(upper_ts, watermark_ts)` | A NULL watermark after an empty run (Q27) |

The second run finds no rows above the new watermark, so `chg` is empty, the `MERGE` does nothing and the watermark stays put. The build ran it twice and checked.

**ACC-2 never appears.** It was opened and closed inside this batch, so the collapsed change is a `D` for an account Silver has never seen, and nothing is inserted. That is right for a current-state table: the account doesn't exist now. The history table (Q42), built from every change, still records that it existed.

**Where the guarantee ends:** steps 3 and 4 are separate statements. If the job dies between them, the next run re-applies the same window, which is harmless because the `MERGE` is idempotent. If your engine supports it, wrap steps 3 and 4 in one transaction so the watermark can never move without the data.
""",
    check="Grain: one current row per account. Run twice: verified unchanged. NULL: delete events carry NULL attributes that the delete branch ignores; an empty window produces a NULL `upper_ts` that step 4 absorbs.",
)


INTRO = f"""
NovaBank's core banking system publishes a **change data capture (CDC)** stream: every insert, update and delete on an account, with an operation flag and a log position. Transactions arrive as an append-only feed of files. This post builds the **medallion** pipeline on top: **Bronze** keeps exactly what arrived, **Silver** cleans, deduplicates and applies the changes, and **Gold** serves aggregates. It's the post about correctness under retries, redelivery and late data.

{series_callout(SLUG)}

The post covers four areas:

- Bronze: landing raw data without losing anything
- Silver: deduplication, ordering, applying changes and keeping history
- Gold: recomputing only what late data changed, and serving without fan-out
- Quality: contracts, reconciliation, lineage, and a refresh that's safe to retry

## How to use this post

{HOW_TO_READ.strip()} Every answer ends with an **Engineer check**: the grain, what happens if it runs twice, and what NULL does. The [first post](/blog/de-sql-foundations#how-the-answers-are-checked) explains how the answers were run and checked.

![NovaBank's medallion pipeline: CSV files and a CDC stream land append-only in Bronze as text with lineage columns; Silver deduplicates redeliveries, collapses each batch to the last change per key by log position, applies inserts, updates and soft deletes with MERGE, keeps SCD2 history from every change and quarantines rows that break the contract; Gold recomputes daily balances from the earliest affected day and builds a customer 360; a watermark with a frozen upper bound drives each step, and checksums reconcile the layers](/images/data-engineering/de-sql/de-sql-medallion-cdc/medallion-flow.svg)
"""

OUTRO = """
## Summary

A medallion pipeline is correct when every layer can be rebuilt and every step can be retried. Bronze makes rebuilding possible: it keeps every delivery as text, with lineage, and never changes. Silver makes retries safe: it removes redeliveries by change identity, orders changes by log position rather than timestamps, applies them with a `MERGE` that treats a repeated insert as an update, keeps deletes as tombstones, and builds history from every change rather than the collapsed batch. Gold stays correct under late data by recomputing from the earliest affected day, over the full history, with a spine for empty days. And quality checks need the same care as the data: a contract that can evaluate to UNKNOWN loses rows, a count can match while values don't, and a join before a sum multiplies money.

![A map of this post in four columns. Bronze: everything as text, lineage columns, append-only, duplicates kept. Silver: dedup by change identity, order by log position, MERGE with soft deletes, history from every change. Gold: recompute from the earliest affected day, full-history running sums, day spine, aggregate before joining. Quality: COALESCE the contract, checksums before diffs, lineage hashes, a five-guard refresh](/images/data-engineering/de-sql/de-sql-medallion-cdc/summary-map.svg)

### Concepts at a glance

| Concept | In one line | Why it matters |
| --- | --- | --- |
| **Bronze** | Append-only, everything as text, with lineage | You can always rebuild the layers above |
| **Change identity** | `(key, log position)` | Dedups redeliveries without losing real changes |
| **Log order** | Order changes by `seq_no`, not timestamps | Timestamps tie and skew |
| **CDC apply** | One `MERGE`: I/U upsert, D soft delete | Idempotent, and deletes stay visible |
| **History from CDC** | `LEAD` over every change; deletes close the last version | Intermediate states survive |
| **Touched days** | Select by arrival, group by event time | Late data reaches the days it belongs to |
| **Cumulative recompute** | From the earliest affected day, over full history | Running totals stay consistent |
| **ROWS vs RANGE** | `RANGE` folds ties into one value | Running balances jump over tied rows |
| **Contract routing** | `COALESCE(rule, FALSE)` | Rows with NULLs can't fall between valid and rejected |
| **Checksum reconciliation** | `COUNT` plus `SUM(hash)` per side, then a diff | Cheap global check, targeted detail |
| **Pre-aggregate before joining** | Bring each side to the output grain | No multiplied balances |

### Test yourself

<details>
<summary>Why does a Bronze table store `amount` as text?</summary>

So nothing is ever rejected at the door. A typed column would fail or drop a row with a malformed value, and Bronze must keep exactly what arrived. Typing and validation happen in Silver, where bad rows can be quarantined with a reason.

</details>

<details>
<summary>Two updates for the same account share a `source_ts`. How do you know which came last?</summary>

By the log position, `seq_no`, which the source assigns in commit order. Timestamps can tie or come from clocks that disagree.

</details>

<details>
<summary>Why can't SCD2 history be built from the batch collapsed to the last change per account?</summary>

Collapsing throws away intermediate changes, such as an account that was frozen and unfrozen in the same batch. History needs every change; only the current-state table uses the collapsed batch.

</details>

<details>
<summary>A routing rule is `amount <> 0 AND direction IN ('DEBIT', 'CREDIT')`. Where does a row with a NULL amount go if you load `WHERE rule` and reject `WHERE NOT rule`?</summary>

Nowhere. The rule is UNKNOWN for that row, and both filters drop UNKNOWN. Route on `COALESCE(rule, FALSE)` instead.

</details>

<details>
<summary>A late transaction arrives for 2 March. Which days of a closing-balance table need recomputing?</summary>

2 March and every day after it, because a closing balance is cumulative.

</details>

## Sources

- Snowflake: [COPY INTO](https://docs.snowflake.com/en/sql-reference/sql/copy-into-table), [metadata columns such as METADATA$FILENAME](https://docs.snowflake.com/en/user-guide/querying-metadata), [MERGE](https://docs.snowflake.com/en/sql-reference/sql/merge), [PIVOT](https://docs.snowflake.com/en/sql-reference/constructs/pivot), [GREATEST](https://docs.snowflake.com/en/sql-reference/functions/greatest)
- PostgreSQL: [window function frames](https://www.postgresql.org/docs/current/sql-expressions.html#SYNTAX-WINDOW-FUNCTIONS)
- DuckDB: [reading CSV files](https://duckdb.org/docs/stable/data/csv/overview), [MERGE INTO](https://duckdb.org/docs/current/sql/statements/merge_into), [window functions](https://duckdb.org/docs/stable/sql/functions/window_functions)
- Databricks: [the medallion architecture](https://docs.databricks.com/aws/en/lakehouse/medallion)
"""

POST = Post(
    slug=SLUG,
    title="SQL for Data Engineers: Medallion Layers and CDC",
    description="Part 3 of a data engineering SQL practice bank: a banking medallion pipeline, from Bronze landing to Silver CDC apply and history to Gold recomputes, covering redelivery, log ordering, soft deletes, late data, window-frame traps, data contracts, reconciliation and a refresh that is safe to retry. Every answer is run on real sample data.",
    order=3,
    tags=["Data Engineering", "SQL", "Practice", "CDC"],
    intro=INTRO,
    groups=[
        Group("Bronze: land everything", "Bronze has one job: keep exactly what arrived, and record where it came from.", [q38]),
        Group("Silver: apply changes correctly", "Turning an at-least-once change stream into a correct current state and a correct history.", [q39, q40, q41, q42, q43, q44]),
        Group("Gold: aggregates and serving", "Recomputing what late data changes, and the window and join traps in serving tables.", [q45, q46, q47, q48, q49]),
        Group("Quality, serving and operations", "Checks that can't silently pass, a serving table that can't multiply money, and a refresh that can't silently double.", [q50, q51, q52, q53, q54]),
    ],
    outro=OUTRO,
)
