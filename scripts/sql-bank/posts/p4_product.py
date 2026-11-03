from build import Group, Post, Q, Show, Step
from posts.common import HOW_TO_READ, series_callout

SLUG = "de-sql-product-analytics"

SESSION_EVENTS = """
CREATE TABLE events (event_id VARCHAR, user_id VARCHAR, event_name VARCHAR, event_ts TIMESTAMP);
INSERT INTO events VALUES
    ('e1', 'u1', 'page_view',   TIMESTAMP '2025-03-01 09:00'),
    ('e2', 'u1', 'view_item',   TIMESTAMP '2025-03-01 09:10'),
    ('e3', 'u1', 'add_to_cart', TIMESTAMP '2025-03-01 09:25'),
    ('e4', 'u1', 'page_view',   TIMESTAMP '2025-03-01 10:30'),
    ('e5', 'u1', 'purchase',    TIMESTAMP '2025-03-01 10:40'),
    ('e6', 'u2', 'page_view',   TIMESTAMP '2025-03-01 11:00'),
    ('e7', 'u2', 'page_view',   TIMESTAMP '2025-03-01 14:00'),
    ('e8', 'u2', 'view_item',   TIMESTAMP '2025-03-01 14:20');
"""

SESSIONIZE = """
WITH ordered AS (
    SELECT *, LAG(event_ts) OVER (PARTITION BY user_id ORDER BY event_ts, event_id) AS prev_ts
    FROM events
),
flagged AS (
    SELECT *,
           CASE WHEN prev_ts IS NULL OR event_ts - prev_ts > INTERVAL 30 MINUTE THEN 1 ELSE 0 END AS is_new_session
    FROM ordered
)
SELECT user_id, event_id, event_name, event_ts, is_new_session,
       SUM(is_new_session) OVER (PARTITION BY user_id ORDER BY event_ts, event_id
                                 ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS session_no
FROM flagged
"""

# ------------------------------------------------------------------ events in

q55 = Q(
    id="q55",
    title="Flatten event JSON, including an array",
    level="Medium",
    pattern="Semi-structured data",
    prompt="""
`raw_events.properties` is JSON. For `purchase` events, return one row **per purchased item** with typed columns: `page`, `order_value` (a number), `referrer`, and from the `items` array each item's `sku` and `qty`. A purchase with no `referrer` key must still appear.
""",
    setup="""
CREATE TABLE raw_events (event_id VARCHAR, user_id VARCHAR, event_name VARCHAR, properties JSON);
INSERT INTO raw_events VALUES
    ('e1', 'u1', 'purchase',  '{"page": "/checkout", "value": 42.5, "referrer": "google", "items": [{"sku": "A-1", "qty": 1}, {"sku": "B-7", "qty": 2}]}'),
    ('e2', 'u2', 'purchase',  '{"page": "/checkout", "value": "15", "items": [{"sku": "C-3", "qty": 1}]}'),
    ('e3', 'u1', 'page_view', '{"page": "/home"}');
""",
    show=["raw_events"],
    answer="""
SELECT
    e.event_id,
    e.properties ->> '$.page'                         AS page,
    TRY_CAST(e.properties ->> '$.value' AS DOUBLE)    AS order_value,
    e.properties ->> '$.referrer'                     AS referrer,
    item ->> '$.sku'                                  AS sku,
    CAST(item ->> '$.qty' AS INT)                     AS qty
FROM raw_events e,
     unnest(CAST(e.properties -> '$.items' AS JSON[])) AS t(item)
WHERE e.event_name = 'purchase'
ORDER BY e.event_id, sku;
""",
    display="""
SELECT
    e.event_id,
    e.properties:page::STRING             AS page,
    TRY_TO_DOUBLE(e.properties:value::STRING) AS order_value,
    e.properties:referrer::STRING         AS referrer,
    f.value:sku::STRING                   AS sku,
    f.value:qty::INT                      AS qty
FROM raw_events e,
     LATERAL FLATTEN(input => e.properties:items) f
WHERE e.event_name = 'purchase';
""",
    hint="Scalars come out with a path and a cast. An array needs to be turned into rows: `FLATTEN` in Snowflake, `UNNEST` elsewhere.",
    explain="""
- **Path extraction plus a cast:** `->> '$.page'` (DuckDB and Postgres) or `properties:page::STRING` (Snowflake) pulls a field out as text, and a cast types it. A missing key, like e2's `referrer`, comes back as NULL rather than an error.
- **Values arrive with mixed types.** e2's `value` is the *string* `"15"` where e1's is a number. `TRY_CAST` (or Snowflake's `TRY_TO_DOUBLE`) handles both and nulls out garbage; a plain cast on a JSON field fails or behaves differently per engine.
- **Arrays become rows** with a lateral `FLATTEN` ([Snowflake docs](https://docs.snowflake.com/en/sql-reference/functions/flatten)) or `UNNEST`. e1 had two items, so it produces two rows, which **changes the grain** from one row per event to one row per item. Any event-level number (`order_value`) now repeats per item, so don't sum it at this grain.
- **Flatten once, at ingestion.** Parsing JSON in every downstream query is slow and repeats the type decisions; a typed Silver table does it once.
""",
    check="Grain: one row per purchased item, not per event. Run twice: read-only. NULL: missing keys are NULL; an event with an empty or missing `items` array disappears from an inner `FLATTEN`/`UNNEST`, so use `OUTER => TRUE` (Snowflake) or a `LEFT JOIN` if those events must stay.",
)

q56 = Q(
    id="q56",
    title="How duplicated is the event stream?",
    level="Medium",
    pattern="Deduplication metrics",
    prompt="""
The collector is at-least-once, so `event_id` can repeat. Before deduplicating, measure it: per `app_version`, return raw events, unique events and the duplicate percentage, so you can tell whether one client release is misbehaving.
""",
    setup="""
CREATE TABLE raw_events (event_id VARCHAR, user_id VARCHAR, app_version VARCHAR, _ingested_at TIMESTAMP);
INSERT INTO raw_events VALUES
    ('e1', 'u1', '3.2', TIMESTAMP '2025-03-01 09:00'), ('e2', 'u1', '3.2', TIMESTAMP '2025-03-01 09:01'),
    ('e3', 'u2', '3.3', TIMESTAMP '2025-03-01 09:02'), ('e3', 'u2', '3.3', TIMESTAMP '2025-03-01 09:05'),
    ('e3', 'u2', '3.3', TIMESTAMP '2025-03-01 09:09'), ('e4', 'u2', '3.3', TIMESTAMP '2025-03-01 09:03'),
    ('e4', 'u2', '3.3', TIMESTAMP '2025-03-01 09:06'), ('e5', 'u3', '3.2', TIMESTAMP '2025-03-01 09:04');
""",
    show=["raw_events"],
    answer="""
SELECT app_version,
       COUNT(*)                                                         AS raw_events,
       COUNT(DISTINCT event_id)                                         AS unique_events,
       ROUND(100.0 * (COUNT(*) - COUNT(DISTINCT event_id)) / COUNT(*), 1) AS duplicate_pct
FROM raw_events
GROUP BY app_version
ORDER BY app_version;
""",
    hint="The number of duplicates is the raw count minus the distinct count.",
    explain="""
- **`COUNT(*) − COUNT(DISTINCT event_id)`** is the number of extra copies; dividing by `COUNT(*)` gives the share of the stream that's duplication.
- Version 3.3 is 60% duplicates against 0% for 3.2, which points at a retry bug in that release. That's worth an alert, not just a dedup step.
- **Why streams are at-least-once:** network retries, mobile apps that buffer offline and resend, and collectors that redeliver after a timeout all produce copies, and exactly-once delivery end to end is rare and expensive. So every model built on raw events dedups by `event_id` first (`QUALIFY ROW_NUMBER() … = 1`, post 01), and a metric like this one tells you how much that step is hiding.
""",
    check="Grain: one row per app version. NULL: `COUNT(DISTINCT …)` ignores NULL ids, so events without an `event_id` look like neither unique events nor duplicates; count them separately.",
)

# ------------------------------------------------------------------ sessions and funnels

q57 = Q(
    id="q57",
    title="Sessionize: a new session after 30 minutes idle",
    level="Hard",
    pattern="Sessionization",
    prompt="""
Assign a per-user `session_no` to every event, where a new session starts at a user's first event or after **more than 30 minutes** without one.
""",
    setup=SESSION_EVENTS,
    show=["events"],
    answer=SESSIONIZE.strip() + "\nORDER BY user_id, event_ts;",
    hint="Three steps: the gap to the previous event, a 1 where a session starts, and a running total of those 1s.",
    explain="""
- **`LAG(event_ts)`** gives each event the user's previous event time.
- **The new-session flag** is 1 for a user's first event (no previous) or when the gap is over 30 minutes. u1's 10:30 event comes 65 minutes after 09:25, so it starts session 2.
- **`SUM(flag) OVER (… ROWS UNBOUNDED PRECEDING …)`** turns the flags into a counter: 1, 1, 1, 2, 2. This running-sum-of-boundaries trick is the standard way to number islands of rows.
- **`ORDER BY event_ts, event_id`** in both windows makes ties deterministic, and `ROWS` avoids the peer-row trap from post 03 (Q46).
- For a globally unique id, combine the user and the number, or hash them.
""",
    steps=[
        Step("Gaps", "Each event with the time since the user's previous event. Two gaps are over 30 minutes.",
             tables=[Show("gaps", "SELECT user_id, event_id, event_name, event_ts, event_ts - LAG(event_ts) OVER (PARTITION BY user_id ORDER BY event_ts, event_id) AS gap, CASE WHEN LAG(event_ts) OVER (PARTITION BY user_id ORDER BY event_ts, event_id) IS NULL OR event_ts - LAG(event_ts) OVER (PARTITION BY user_id ORDER BY event_ts, event_id) > INTERVAL 30 MINUTE THEN 'hit' END AS _mark FROM events ORDER BY user_id, event_ts")]),
        Step("Sessions", "A running sum of the start flags numbers the sessions.",
             tables=[Show("sessionized", "WITH s AS (" + SESSIONIZE + ") SELECT user_id, event_id, event_ts, is_new_session, session_no, CASE WHEN is_new_session = 1 THEN 'new' END AS _mark FROM s ORDER BY user_id, event_ts")]),
    ],
    trace_alt="Two steps: each event with the gap since the previous one, highlighting session starts; and the session numbers produced by a running sum of the start flags, u1 with sessions 1 and 2, u2 with sessions 1 and 2.",
    check="Grain: unchanged, one row per event, now carrying a session number. NULL: the first event's `prev_ts` is NULL, which the flag handles explicitly; without the `IS NULL` branch the first session would start at 0.",
)

q58 = Q(
    id="q58",
    title="Session length and bounce rate",
    level="Medium",
    pattern="Aggregation",
    prompt="""
From the sessionized events, compute per session the event count, start, end and duration, and whether it **bounced** (exactly one event). Then report the overall bounce rate and the average duration of sessions that didn't bounce.
""",
    setup=SESSION_EVENTS,
    show=["events"],
    answer=f"""
WITH sessionized AS (
{SESSIONIZE.strip()}
),
sessions AS (
    SELECT user_id, session_no,
           COUNT(*)                         AS events,
           MIN(event_ts)                    AS session_start,
           MAX(event_ts)                    AS session_end,
           datediff('minute', MIN(event_ts), MAX(event_ts)) AS duration_min,
           COUNT(*) = 1                     AS is_bounce
    FROM sessionized
    GROUP BY user_id, session_no
)
SELECT COUNT(*)                                                       AS sessions,
       ROUND(100.0 * AVG(CASE WHEN is_bounce THEN 1 ELSE 0 END), 1)    AS bounce_rate_pct,
       ROUND(AVG(CASE WHEN NOT is_bounce THEN duration_min END), 1)    AS avg_minutes_engaged
FROM sessions;
""",
    hint="Group by user and session number, then aggregate the sessions.",
    explain="""
- **Group by `(user_id, session_no)`** to get one row per session (the grain Q57 created). Its span is `MAX − MIN` of the event times.
- **A bounce** is a session with exactly one event. Its duration is 0 by definition, because there is no second event to measure to.
- **Averaging a 1/0 flag** gives the bounce rate: here 1 of 4 sessions (u2's single page view at 11:00), 25%.
- **Exclude bounces from the average duration.** Including their zeros drags the average down and mixes two different questions ("how often do people leave immediately?" and "how long do engaged sessions last?").
""",
    steps=[
        Step("Sessions", "One row per session.",
             tables=[Show("sessions", "WITH sessionized AS (" + SESSIONIZE + ") SELECT user_id, session_no, COUNT(*) AS events, MIN(event_ts) AS session_start, MAX(event_ts) AS session_end, datediff('minute', MIN(event_ts), MAX(event_ts)) AS duration_min, COUNT(*) = 1 AS is_bounce, CASE WHEN COUNT(*) = 1 THEN 'hit' END AS _mark FROM sessionized GROUP BY 1, 2 ORDER BY 1, 2")]),
    ],
    trace_alt="One step: four sessions with their event counts, start and end times and durations, one of them a single-event bounce.",
    check="Grain: the final row summarises all sessions. NULL: `AVG` of the `CASE` without an `ELSE` skips bounces, which is exactly the intent.",
)

q59 = Q(
    id="q59",
    title="An ordered funnel within 24 hours",
    level="Hard",
    pattern="Funnels",
    prompt="""
Count users who completed each step of `view_item → add_to_cart → begin_checkout → purchase` **in order**, with the purchase within 24 hours of the first view, and the step-to-step conversion. u3 added to cart *before* ever viewing an item and must not count as reaching the cart step through that event.
""",
    setup="""
CREATE TABLE events (user_id VARCHAR, event_name VARCHAR, event_ts TIMESTAMP);
INSERT INTO events VALUES
    ('u1', 'view_item', TIMESTAMP '2025-03-01 09:00'), ('u1', 'add_to_cart', TIMESTAMP '2025-03-01 09:05'),
    ('u1', 'begin_checkout', TIMESTAMP '2025-03-01 09:10'), ('u1', 'purchase', TIMESTAMP '2025-03-01 09:12'),
    ('u2', 'view_item', TIMESTAMP '2025-03-01 10:00'), ('u2', 'add_to_cart', TIMESTAMP '2025-03-01 10:03'),
    ('u2', 'begin_checkout', TIMESTAMP '2025-03-02 08:00'), ('u2', 'purchase', TIMESTAMP '2025-03-02 12:00'),
    ('u3', 'add_to_cart', TIMESTAMP '2025-03-01 08:00'), ('u3', 'view_item', TIMESTAMP '2025-03-01 08:30'),
    ('u4', 'view_item', TIMESTAMP '2025-03-01 11:00');
""",
    show=["events"],
    answer="""
WITH v AS (SELECT user_id, MIN(event_ts) AS t FROM events WHERE event_name = 'view_item' GROUP BY user_id),
c AS (SELECT v.user_id, MIN(e.event_ts) AS t FROM v JOIN events e
        ON e.user_id = v.user_id AND e.event_name = 'add_to_cart' AND e.event_ts > v.t GROUP BY v.user_id),
k AS (SELECT c.user_id, MIN(e.event_ts) AS t FROM c JOIN events e
        ON e.user_id = c.user_id AND e.event_name = 'begin_checkout' AND e.event_ts > c.t GROUP BY c.user_id),
p AS (SELECT k.user_id, MIN(e.event_ts) AS t FROM k JOIN events e
        ON e.user_id = k.user_id AND e.event_name = 'purchase' AND e.event_ts > k.t GROUP BY k.user_id),
steps AS (
    SELECT 1 AS step, 'view_item' AS name, COUNT(*) AS users FROM v
    UNION ALL SELECT 2, 'add_to_cart', COUNT(*) FROM c
    UNION ALL SELECT 3, 'begin_checkout', COUNT(*) FROM k
    UNION ALL SELECT 4, 'purchase', COUNT(*) FROM p JOIN v USING (user_id)
              WHERE p.t <= v.t + INTERVAL 24 HOUR
)
SELECT step, name, users,
       ROUND(100.0 * users / NULLIF(LAG(users) OVER (ORDER BY step), 0), 1) AS pct_of_previous
FROM steps
ORDER BY step;
""",
    hint="Find each step's first time *after* the previous step's time, one step at a time. Independent `MIN`s per event type can't enforce order.",
    explain="""
- **Each step is found after the previous one:** `c` takes the first cart *after* the user's first view, `k` the first checkout after that cart, and so on. A user can only appear in a step's CTE if they appear in the previous one, so the counts can only fall.
- **u3 is the order test.** Its only cart came before its view, so it has no cart after a view and stops at step 1. The common shortcut, taking `MIN(timestamp)` of each event type independently and comparing them, gets this case right too, but it fails a user who carted early, viewed, then carted again: the independent minimum picks the early cart and rejects a real conversion. Chaining the steps handles both.
- **The 24-hour window** applies to the whole funnel: u2 bought 26 hours after its first view, so it reaches checkout but not purchase.
- **`users / LAG(users)`** gives step-to-step conversion; `NULLIF` guards an empty step.
- For a within-*session* funnel, add `session_no` from Q57 to every join.
""",
    steps=[
        Step("Step times", "Each user's first time at each step, each found after the previous step. u3 has no cart after its view.",
             tables=[Show("per user", "WITH v AS (SELECT user_id, MIN(event_ts) AS t FROM events WHERE event_name = 'view_item' GROUP BY user_id), c AS (SELECT v.user_id, MIN(e.event_ts) AS t FROM v JOIN events e ON e.user_id = v.user_id AND e.event_name = 'add_to_cart' AND e.event_ts > v.t GROUP BY v.user_id), k AS (SELECT c.user_id, MIN(e.event_ts) AS t FROM c JOIN events e ON e.user_id = c.user_id AND e.event_name = 'begin_checkout' AND e.event_ts > c.t GROUP BY c.user_id), p AS (SELECT k.user_id, MIN(e.event_ts) AS t FROM k JOIN events e ON e.user_id = k.user_id AND e.event_name = 'purchase' AND e.event_ts > k.t GROUP BY k.user_id) SELECT v.user_id, v.t AS viewed, c.t AS carted, k.t AS checked_out, p.t AS purchased, p.t <= v.t + INTERVAL 24 HOUR AS within_24h, CASE WHEN p.t <= v.t + INTERVAL 24 HOUR THEN 'keep' WHEN c.t IS NULL THEN 'drop' END AS _mark FROM v LEFT JOIN c USING (user_id) LEFT JOIN k USING (user_id) LEFT JOIN p USING (user_id) ORDER BY 1")]),
    ],
    trace_alt="One step: each user's first view, cart, checkout and purchase times, each found after the previous step; u1 completes within 24 hours, u2's purchase is outside the window, u3 has no cart after its view and u4 only viewed.",
    check="Grain: one row per funnel step. NULL: a user missing a step has no row in that step's CTE, so the counts fall naturally; never `COUNT` a column that can be NULL for users who didn't get that far.",
)

# ------------------------------------------------------------------ users over time

q60 = Q(
    id="q60",
    title="Weekly cohort retention",
    level="Hard",
    pattern="Cohorts",
    prompt="""
Group users by the week they signed up. For weeks 0, 1 and 2 after signup, report how many users in each cohort were active, and the percentage of the cohort.
""",
    setup="""
CREATE TABLE users (user_id VARCHAR, signup_ts TIMESTAMP);
INSERT INTO users VALUES
    ('u1', TIMESTAMP '2025-03-03 09:00'), ('u2', TIMESTAMP '2025-03-04 10:00'), ('u3', TIMESTAMP '2025-03-05 11:00'),
    ('u4', TIMESTAMP '2025-03-10 09:00'), ('u5', TIMESTAMP '2025-03-12 15:00');
CREATE TABLE events (user_id VARCHAR, event_ts TIMESTAMP);
INSERT INTO events VALUES
    ('u1', TIMESTAMP '2025-03-03 09:05'), ('u1', TIMESTAMP '2025-03-11 08:00'), ('u1', TIMESTAMP '2025-03-18 08:00'),
    ('u2', TIMESTAMP '2025-03-04 10:05'), ('u2', TIMESTAMP '2025-03-19 12:00'),
    ('u3', TIMESTAMP '2025-03-05 11:05'),
    ('u4', TIMESTAMP '2025-03-10 09:05'), ('u4', TIMESTAMP '2025-03-17 09:00'),
    ('u5', TIMESTAMP '2025-03-12 15:05');
""",
    show=["users", "events"],
    answer="""
WITH cohort AS (
    SELECT user_id, CAST(date_trunc('week', signup_ts) AS DATE) AS cohort_week
    FROM users
),
activity AS (
    SELECT DISTINCT c.user_id, c.cohort_week,
           datediff('week', c.cohort_week, CAST(date_trunc('week', e.event_ts) AS DATE)) AS week_no
    FROM events e JOIN cohort c USING (user_id)
)
SELECT c.cohort_week,
       COUNT(DISTINCT c.user_id)                                                  AS cohort_size,
       COUNT(DISTINCT CASE WHEN a.week_no = 0 THEN a.user_id END)                 AS wk0,
       COUNT(DISTINCT CASE WHEN a.week_no = 1 THEN a.user_id END)                 AS wk1,
       COUNT(DISTINCT CASE WHEN a.week_no = 2 THEN a.user_id END)                 AS wk2,
       ROUND(100.0 * COUNT(DISTINCT CASE WHEN a.week_no = 1 THEN a.user_id END)
             / COUNT(DISTINCT c.user_id), 0)                                      AS wk1_pct
FROM cohort c
LEFT JOIN activity a USING (user_id)
GROUP BY c.cohort_week
ORDER BY c.cohort_week;
""",
    hint="Give every activity a week number relative to the user's signup week, then count distinct users per cohort and week number.",
    explain="""
- **The cohort** is the signup week, truncated with `date_trunc('week', …)` (Monday-based in DuckDB, Postgres and by default in Snowflake; check `WEEK_START` on Snowflake).
- **`week_no`** is how many weeks after the cohort week an activity happened. `DISTINCT` counts a user once per week however many events they had.
- **`COUNT(DISTINCT CASE WHEN week_no = N …)`** builds the retention triangle: one column per relative week.
- **The `LEFT JOIN`** keeps every user in the cohort's size even if they never came back, which is the denominator retention needs.
- **The 10 March cohort can't have a week 2 yet** in data that ends on 19 March, so its 0 is "not yet observable", not "nobody returned". Real retention charts blank out cells that are still in the future.
""",
    check="Grain: one row per cohort week. NULL: users with no activity give NULL `week_no`, which the `CASE` expressions skip, and they still count in `cohort_size`.",
)

q61 = Q(
    id="q61",
    title="DAU, 28-day active users and stickiness",
    level="Medium",
    pattern="Active users",
    prompt="""
For 2025-03-28, compute daily active users (DAU), active users in the trailing 28 days including that day (MAU), and stickiness, DAU ÷ MAU.
""",
    setup="""
CREATE TABLE events (user_id VARCHAR, event_ts TIMESTAMP);
INSERT INTO events VALUES
    ('u1', TIMESTAMP '2025-03-28 09:00'), ('u1', TIMESTAMP '2025-03-28 18:00'), ('u2', TIMESTAMP '2025-03-28 10:00'),
    ('u3', TIMESTAMP '2025-03-15 08:00'), ('u4', TIMESTAMP '2025-03-01 12:00'), ('u5', TIMESTAMP '2025-02-28 23:30');
""",
    show=["events"],
    answer="""
SELECT
    COUNT(DISTINCT CASE WHEN CAST(event_ts AS DATE) = DATE '2025-03-28' THEN user_id END)     AS dau,
    COUNT(DISTINCT CASE WHEN CAST(event_ts AS DATE) BETWEEN DATE '2025-03-28' - 27
                                                         AND DATE '2025-03-28' THEN user_id END) AS mau_28d,
    ROUND(COUNT(DISTINCT CASE WHEN CAST(event_ts AS DATE) = DATE '2025-03-28' THEN user_id END)::DOUBLE
          / NULLIF(COUNT(DISTINCT CASE WHEN CAST(event_ts AS DATE) BETWEEN DATE '2025-03-28' - 27
                                                                    AND DATE '2025-03-28' THEN user_id END), 0), 2) AS stickiness
FROM events;
""",
    hint="28 days including the target day starts 27 days before it.",
    explain="""
- **DAU** counts distinct users on the day; u1's two events count once.
- **The 28-day window** is `day − 27` through `day`, which is 28 days inclusive. Off-by-one windows are the classic bug here: `− 28` makes it 29 days and would include u5 from 28 February.
- **Stickiness** = DAU ÷ MAU, the share of the month's users who show up on a given day: 2 ÷ 4 = 0.5. The cast to `DOUBLE` avoids integer division, and `NULLIF` an empty month.
- **Distinct counts don't add up:** you can't sum daily DAUs into MAU, because the same user is active on many days. That's why MAU needs its own distinct count over the window, and Q62 needs a different technique to compute it for every day.
""",
    check="Grain: one row for one date. NULL: users with no events in the window simply aren't counted; there's nothing to coalesce.",
)

q62 = Q(
    id="q62",
    title="Rolling 7-day distinct users, for every day",
    level="Hard",
    pattern="Windowed distinct counts",
    prompt="""
For every day from 1 to 10 March, report the number of distinct users active in the trailing 7 days including that day. Days with no activity must still appear.
""",
    setup="""
CREATE TABLE events (user_id VARCHAR, event_ts TIMESTAMP);
INSERT INTO events VALUES
    ('u1', TIMESTAMP '2025-03-01 09:00'), ('u2', TIMESTAMP '2025-03-01 10:00'), ('u1', TIMESTAMP '2025-03-03 09:00'),
    ('u3', TIMESTAMP '2025-03-05 11:00'), ('u1', TIMESTAMP '2025-03-08 09:00'), ('u4', TIMESTAMP '2025-03-10 08:00');
""",
    show=["events"],
    answer="""
WITH days AS (
    SELECT CAST(d AS DATE) AS d
    FROM generate_series(DATE '2025-03-01', DATE '2025-03-10', INTERVAL 1 DAY) t(d)
),
active AS (
    SELECT DISTINCT user_id, CAST(event_ts AS DATE) AS d FROM events
)
SELECT days.d AS as_of,
       COUNT(DISTINCT active.user_id) AS active_7d
FROM days
LEFT JOIN active ON active.d BETWEEN days.d - 6 AND days.d
GROUP BY days.d
ORDER BY days.d;
""",
    hint="A window function can't slide a distinct count in most engines. Join each day to the activity in its own 7-day range instead.",
    explain="""
- **Why not a window function:** `COUNT(DISTINCT user_id) OVER (ORDER BY d ROWS 6 PRECEDING)` is rejected by many engines; Postgres, for one, reports that `DISTINCT` is not implemented for window functions. And summing daily distinct counts over 7 days counts a user once per active day.
- **The spine join:** each day in `days` joins to every activity whose date falls in its 7-day range, and `COUNT(DISTINCT user_id)` counts unique users per range. u1, active on three days, counts once wherever its days overlap a window.
- **`LEFT JOIN` from the spine** keeps days with no activity in range, with a count of 0.
- **Cost:** each activity row joins to 7 days, so the join is 7 times the activity table, which is fine at daily grain. For very large tables, approximate distinct counts (HyperLogLog) are the usual answer.
""",
    check="Grain: one row per calendar day. NULL: an empty window gives `COUNT(DISTINCT NULL)` = 0, the right answer.",
)

q63 = Q(
    id="q63",
    title="First touch and last touch, and the LAST_VALUE trap",
    level="Medium",
    pattern="Attribution",
    prompt="""
For each user who purchased, return the `referrer` of their **first** event and of their **last event before** their first purchase.
""",
    setup="""
CREATE TABLE events (user_id VARCHAR, event_name VARCHAR, event_ts TIMESTAMP, referrer VARCHAR);
INSERT INTO events VALUES
    ('u1', 'page_view', TIMESTAMP '2025-03-01 09:00', 'google'),
    ('u1', 'page_view', TIMESTAMP '2025-03-02 09:00', 'newsletter'),
    ('u1', 'page_view', TIMESTAMP '2025-03-03 09:00', 'instagram'),
    ('u1', 'purchase',  TIMESTAMP '2025-03-03 09:05', NULL),
    ('u1', 'page_view', TIMESTAMP '2025-03-09 09:00', 'tiktok'),
    ('u2', 'page_view', TIMESTAMP '2025-03-02 10:00', 'bing'),
    ('u2', 'purchase',  TIMESTAMP '2025-03-02 10:30', NULL);
""",
    show=["events"],
    answer="""
WITH first_purchase AS (
    SELECT user_id, MIN(event_ts) AS purchase_ts FROM events WHERE event_name = 'purchase' GROUP BY user_id
),
before AS (
    SELECT e.*
    FROM events e JOIN first_purchase fp USING (user_id)
    WHERE e.event_ts < fp.purchase_ts
)
SELECT DISTINCT user_id,
       FIRST_VALUE(referrer) OVER w AS first_touch,
       LAST_VALUE(referrer)  OVER w AS last_touch
FROM before
WINDOW w AS (PARTITION BY user_id ORDER BY event_ts
             ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING)
ORDER BY user_id;
""",
    hint="`LAST_VALUE` looks at the window frame, not the whole partition. What is the default frame when the window has an `ORDER BY`?",
    explain="""
- **Restrict to events before the first purchase** (`<`, not `<=`, so the purchase itself, with its NULL referrer, isn't the last touch). u1's tiktok visit after buying doesn't count.
- **The trap:** with `ORDER BY` and no frame, the default frame ends at the **current row** (`RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW`). `LAST_VALUE` then returns each row's own referrer, not the partition's last (step 1). `FIRST_VALUE` happens to be right with the default frame, which is why the bug hides.
- **The fix** is an explicit frame over the whole partition: `ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING`. The named `WINDOW w` keeps both functions on the same definition.
- `DISTINCT` collapses the per-row repeats to one row per user (`QUALIFY ROW_NUMBER() … = 1` works too).
""",
    steps=[
        Step("Default frame", "LAST_VALUE with the default frame returns each row's own referrer.",
             tables=[Show("default frame", "WITH fp AS (SELECT user_id, MIN(event_ts) AS p FROM events WHERE event_name = 'purchase' GROUP BY 1) SELECT e.user_id, e.event_ts, e.referrer, LAST_VALUE(e.referrer) OVER (PARTITION BY e.user_id ORDER BY e.event_ts) AS last_value_default, CASE WHEN e.user_id = 'u1' AND e.referrer <> 'instagram' THEN 'bad' END AS _mark FROM events e JOIN fp USING (user_id) WHERE e.event_ts < fp.p ORDER BY 1, 2")]),
        Step("Full frame", "With the frame widened to the whole partition, every row sees the true last touch.",
             tables=[Show("full frame", "WITH fp AS (SELECT user_id, MIN(event_ts) AS p FROM events WHERE event_name = 'purchase' GROUP BY 1) SELECT e.user_id, e.event_ts, e.referrer, LAST_VALUE(e.referrer) OVER (PARTITION BY e.user_id ORDER BY e.event_ts ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) AS last_touch, 'keep' AS _mark FROM events e JOIN fp USING (user_id) WHERE e.event_ts < fp.p ORDER BY 1, 2")]),
    ],
    trace_alt="Two steps: with the default frame, LAST_VALUE returns google and newsletter on u1's first two rows instead of instagram; with the full frame, every row returns instagram.",
    check="Grain: one row per purchasing user. NULL: a NULL referrer on the last touch is returned as NULL; use `LAST_VALUE(referrer IGNORE NULLS)` if you want the last *known* referrer.",
)

q64 = Q(
    id="q64",
    title="Decompose MRR movement",
    level="Hard",
    pattern="Revenue metrics",
    prompt="""
From `subscriptions`, compute each month's total MRR and split the change from the previous month into **new**, **expansion**, **contraction** and **churned** MRR, for January to April 2025.
""",
    setup="""
CREATE TABLE subscriptions (user_id VARCHAR, mrr DECIMAL(10,2), started_month DATE, canceled_month DATE);
INSERT INTO subscriptions VALUES
    ('u1', 20.00, DATE '2025-01-01', DATE '2025-02-01'),   -- 20 in January
    ('u1', 50.00, DATE '2025-02-01', NULL),                 -- upgraded to 50 from February
    ('u2', 30.00, DATE '2025-01-01', DATE '2025-03-01'),   -- churns in March
    ('u3', 40.00, DATE '2025-02-01', DATE '2025-04-01'),
    ('u3', 25.00, DATE '2025-04-01', NULL),                 -- downgrades in April
    ('u4', 10.00, DATE '2025-03-01', NULL);
""",
    show=["subscriptions"],
    answer="""
WITH months AS (
    SELECT CAST(m AS DATE) AS month
    FROM generate_series(DATE '2025-01-01', DATE '2025-04-01', INTERVAL 1 MONTH) t(m)
),
grid AS (                                        -- every user x every month, zero-filled
    SELECT u.user_id, m.month,
           COALESCE(SUM(s.mrr), 0) AS mrr
    FROM (SELECT DISTINCT user_id FROM subscriptions) u
    CROSS JOIN months m
    LEFT JOIN subscriptions s
           ON s.user_id = u.user_id
          AND m.month >= s.started_month
          AND (s.canceled_month IS NULL OR m.month < s.canceled_month)
    GROUP BY u.user_id, m.month
),
moves AS (
    SELECT *, COALESCE(LAG(mrr) OVER (PARTITION BY user_id ORDER BY month), 0) AS prev
    FROM grid
)
SELECT month,
       SUM(mrr)                                                               AS total_mrr,
       SUM(CASE WHEN prev = 0 AND mrr > 0     THEN mrr        ELSE 0 END)     AS new_mrr,
       SUM(CASE WHEN prev > 0 AND mrr > prev  THEN mrr - prev ELSE 0 END)     AS expansion,
       SUM(CASE WHEN mrr > 0 AND mrr < prev   THEN prev - mrr ELSE 0 END)     AS contraction,
       SUM(CASE WHEN prev > 0 AND mrr = 0     THEN prev       ELSE 0 END)     AS churned
FROM moves
GROUP BY month
ORDER BY month;
""",
    hint="A churned user has no subscription row in the month they left, so `LAG` can't see the drop unless every user has a row in every month.",
    explain="""
- **The user × month grid is the key move.** Without it, u2 simply has no row in March, and `LAG` never sees its MRR fall to 0, so churn is invisible. The grid gives every user a row in every month, with 0 when they paid nothing.
- **`month < canceled_month`** treats the cancellation month as the first month without revenue; pick a convention and keep it.
- **`LAG(mrr)`** compares each user's MRR with last month's, and each change goes in exactly one bucket: from zero is **new**, up is **expansion**, down but above zero is **contraction**, to zero is **churned**.
- **The bridge must balance:** last month's total + new + expansion − contraction − churned = this month's total. February: 50 + 40 + 30 − 0 − 0 = 120. Check it in the pipeline; if it doesn't hold, a subscription overlaps or a month is missing.
""",
    check="Grain: one row per month. NULL: `LAG` is NULL in each user's first month; `COALESCE(…, 0)` makes that month count as new revenue rather than vanishing.",
)

q65 = Q(
    id="q65",
    title="Label every user-month: new, retained, churned or reactivated",
    level="Hard",
    pattern="Churn",
    prompt="""
Using monthly activity from January to April 2025, label each user in each month as `new` (first active month), `retained` (active this month and last), `reactivated` (active again after at least one inactive month), `churned` (active last month, not this month) or `inactive`.
""",
    setup="""
CREATE TABLE events (user_id VARCHAR, event_ts TIMESTAMP);
INSERT INTO events VALUES
    ('u1', TIMESTAMP '2025-01-05 09:00'), ('u1', TIMESTAMP '2025-02-11 09:00'), ('u1', TIMESTAMP '2025-04-02 09:00'),
    ('u2', TIMESTAMP '2025-01-20 10:00'),
    ('u3', TIMESTAMP '2025-02-14 08:00'), ('u3', TIMESTAMP '2025-03-14 08:00'), ('u3', TIMESTAMP '2025-04-14 08:00');
""",
    show=["events"],
    answer="""
WITH months AS (
    SELECT CAST(m AS DATE) AS month FROM generate_series(DATE '2025-01-01', DATE '2025-04-01', INTERVAL 1 MONTH) t(m)
),
active AS (SELECT DISTINCT user_id, CAST(date_trunc('month', event_ts) AS DATE) AS month FROM events),
grid AS (
    SELECT u.user_id, m.month, (a.user_id IS NOT NULL) AS is_active
    FROM (SELECT DISTINCT user_id FROM events) u
    CROSS JOIN months m
    LEFT JOIN active a ON a.user_id = u.user_id AND a.month = m.month
),
flags AS (
    SELECT *,
           LAG(is_active) OVER (PARTITION BY user_id ORDER BY month) AS was_active,
           BOOL_OR(is_active) OVER (PARTITION BY user_id ORDER BY month
                                    ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS ever_before
    FROM grid
)
SELECT user_id, month,
       CASE WHEN is_active AND NOT COALESCE(ever_before, FALSE) THEN 'new'
            WHEN is_active AND was_active                       THEN 'retained'
            WHEN is_active                                      THEN 'reactivated'
            WHEN was_active                                     THEN 'churned'
            ELSE                                                     'inactive' END AS status
FROM flags
ORDER BY user_id, month;
""",
    hint="You need a row for inactive months to see churn, plus two facts per row: was the user active last month, and were they ever active before.",
    explain="""
- **The month grid** (as in Q64) creates rows for inactive months, so the active-to-inactive edge exists to be labelled.
- **`was_active`** (`LAG`) answers "last month?", and **`ever_before`** (`BOOL_OR` over all *earlier* rows) answers "ever?". Both are needed: `new` and `reactivated` are both "active now, inactive last month", and only `ever_before` tells them apart. u1 in April is reactivated; u3 in February is new.
- **The `CASE` order matters:** the first matching branch wins, so `new` is tested before the more general `is_active` branches.
- **`COALESCE(ever_before, FALSE)`**: the frame `1 PRECEDING` is empty in each user's first month, so `BOOL_OR` returns NULL there.
- On Snowflake, `BOOLOR_AGG` plays the role of `BOOL_OR`, or use `MAX(CASE WHEN is_active THEN 1 ELSE 0 END)`.
""",
    check="Grain: one row per user per month, exactly one label each. NULL: the first month's `LAG` and `ever_before` are NULL; the `CASE` handles both explicitly.",
)

q66 = Q(
    id="q66",
    title="Month-over-month growth without dividing by zero",
    level="Medium",
    pattern="Growth rates",
    prompt="""
Compute month-over-month growth in monthly active users: `(this − last) ÷ last`. The first month has no previous month, and a maintenance outage made one month **zero**. Neither may cause an error or a misleading number.
""",
    setup="""
CREATE TABLE monthly_active (month DATE, active_users INT);
INSERT INTO monthly_active VALUES
    (DATE '2025-01-01', 120), (DATE '2025-02-01', 150), (DATE '2025-03-01', 0), (DATE '2025-04-01', 140);
""",
    show=["monthly_active"],
    answer="""
SELECT month, active_users,
       LAG(active_users) OVER (ORDER BY month) AS prev_users,
       ROUND(100.0 * (active_users - LAG(active_users) OVER (ORDER BY month))
             / NULLIF(LAG(active_users) OVER (ORDER BY month), 0), 1) AS mom_growth_pct
FROM monthly_active
ORDER BY month;
""",
    hint="`NULLIF(x, 0)` returns NULL when x is 0. What does dividing by NULL give?",
    explain="""
- **`LAG`** gives last month's value; January has none, so its growth is NULL ("no prior period"), not 0.
- **`NULLIF(prev, 0)`** turns a zero denominator into NULL, and dividing by NULL gives NULL instead of an error. April's growth after the zero month is undefined, and NULL says so honestly; an "infinite growth" number would mislead any chart.
- **`100.0 *`** forces decimal arithmetic. With integers, `30 / 120` is 0 in many engines.
- March's −100% is real: the outage month dropped to zero. Annotate it rather than hide it.
""",
    check="Grain: one row per month. NULL: two different NULLs appear (no previous month, zero previous month); label them in the report if readers need to tell them apart.",
)

q67 = Q(
    id="q67",
    title="Median and p90 time to activation per cohort",
    level="Hard",
    pattern="Percentiles",
    prompt="""
For each signup-month cohort, report the median and 90th-percentile hours from signup to the user's first `activation` event, the cohort size, and how many never activated.
""",
    setup="""
CREATE TABLE users (user_id VARCHAR, signup_ts TIMESTAMP);
INSERT INTO users VALUES
    ('u1', TIMESTAMP '2025-03-01 09:00'), ('u2', TIMESTAMP '2025-03-02 09:00'), ('u3', TIMESTAMP '2025-03-03 09:00'),
    ('u4', TIMESTAMP '2025-03-04 09:00'), ('u5', TIMESTAMP '2025-03-05 09:00'), ('u6', TIMESTAMP '2025-04-01 09:00');
CREATE TABLE events (user_id VARCHAR, event_name VARCHAR, event_ts TIMESTAMP);
INSERT INTO events VALUES
    ('u1', 'activation', TIMESTAMP '2025-03-01 11:00'), ('u2', 'activation', TIMESTAMP '2025-03-02 13:00'),
    ('u3', 'activation', TIMESTAMP '2025-03-04 09:00'), ('u3', 'activation', TIMESTAMP '2025-03-09 09:00'),
    ('u4', 'activation', TIMESTAMP '2025-03-14 09:00'), ('u6', 'activation', TIMESTAMP '2025-04-01 10:00');
""",
    show=["users", "events"],
    answer="""
WITH first_act AS (
    SELECT user_id, MIN(event_ts) AS activated_ts
    FROM events WHERE event_name = 'activation' GROUP BY user_id
),
hours AS (
    SELECT CAST(date_trunc('month', u.signup_ts) AS DATE)       AS cohort_month,
           datediff('hour', u.signup_ts, f.activated_ts)      AS hours_to_activate
    FROM users u LEFT JOIN first_act f USING (user_id)
)
SELECT cohort_month,
       COUNT(*)                                                         AS cohort_size,
       COUNT(*) - COUNT(hours_to_activate)                              AS never_activated,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY hours_to_activate)   AS median_hours,
       percentile_cont(0.9) WITHIN GROUP (ORDER BY hours_to_activate)   AS p90_hours
FROM hours
GROUP BY cohort_month
ORDER BY cohort_month;
""",
    hint="Use each user's **first** activation, keep non-activators in the cohort with a `LEFT JOIN`, and remember what percentile functions do with NULLs.",
    explain="""
- **`MIN(event_ts)`** takes each user's first activation; u3's second one is ignored.
- **`LEFT JOIN`** keeps u5, who never activated, in the cohort. Its hours are NULL.
- **Percentile functions skip NULLs**, so the median and p90 describe only users who activated, while `COUNT(*) − COUNT(hours)` reports the non-activators separately. Folding them in as some large number would distort the distribution; dropping them would hide the most important fact about the cohort.
- **Percentiles, not the mean:** time-to-activation is skewed (most users take hours, a few take weeks), and one slow user moves the mean a lot. Here the median is 14 hours while u4 took 240.
- `percentile_cont` interpolates between values; `percentile_disc` returns an actual observed value. Snowflake and Postgres support both with this syntax.
""",
    check="Grain: one row per signup month. NULL: non-activators are NULL in the percentile input and counted separately; a cohort where nobody activated returns NULL percentiles, not 0.",
)

# ------------------------------------------------------------------ incremental marts

q68 = Q(
    id="q68",
    title="An incremental event mart that absorbs redeliveries",
    level="Hard",
    pattern="Incremental loads",
    prompt="""
Load new events into `mart_events` since the watermark. A redelivered event can arrive in a **later** batch than its first copy, so deduplicating within the batch isn't enough. Also return the event dates the batch touched, for downstream recomputes.
""",
    setup="""
CREATE TABLE mart_events (event_id VARCHAR PRIMARY KEY, user_id VARCHAR, event_ts TIMESTAMP);
INSERT INTO mart_events VALUES ('e1', 'u1', TIMESTAMP '2025-03-01 09:00'), ('e2', 'u2', TIMESTAMP '2025-03-01 10:00');
CREATE TABLE raw_events (event_id VARCHAR, user_id VARCHAR, event_ts TIMESTAMP, _ingested_at TIMESTAMP);
INSERT INTO raw_events VALUES
    ('e1', 'u1', TIMESTAMP '2025-03-01 09:00', TIMESTAMP '2025-03-01 09:01'),
    ('e2', 'u2', TIMESTAMP '2025-03-01 10:00', TIMESTAMP '2025-03-01 10:01'),
    ('e2', 'u2', TIMESTAMP '2025-03-01 10:00', TIMESTAMP '2025-03-02 08:00'),
    ('e3', 'u1', TIMESTAMP '2025-02-28 22:00', TIMESTAMP '2025-03-02 08:00'),
    ('e4', 'u3', TIMESTAMP '2025-03-02 07:55', TIMESTAMP '2025-03-02 08:00'),
    ('e4', 'u3', TIMESTAMP '2025-03-02 07:55', TIMESTAMP '2025-03-02 08:00');
CREATE TABLE etl_control (table_name VARCHAR, watermark_ts TIMESTAMP);
INSERT INTO etl_control VALUES ('mart_events', TIMESTAMP '2025-03-01 23:59');
""",
    show=["mart_events", "raw_events"],
    answer="""
CREATE OR REPLACE TEMP TABLE batch AS
SELECT event_id, user_id, event_ts
FROM raw_events
WHERE _ingested_at > (SELECT watermark_ts FROM etl_control WHERE table_name = 'mart_events')
QUALIFY ROW_NUMBER() OVER (PARTITION BY event_id ORDER BY _ingested_at) = 1;   -- dupes inside the batch

MERGE INTO mart_events t
USING batch s ON t.event_id = s.event_id                                          -- dupes across batches
WHEN NOT MATCHED THEN INSERT VALUES (s.event_id, s.user_id, s.event_ts);

SELECT DISTINCT CAST(event_ts AS DATE) AS touched_date FROM batch ORDER BY 1;
""",
    rerun=False,
    hint="There are two kinds of duplicate: two copies in the same batch, and a copy of something an earlier batch already loaded.",
    explain="""
- **Within the batch:** `QUALIFY ROW_NUMBER() … = 1` collapses e4's two copies.
- **Across batches:** e2 was loaded yesterday and redelivered today. The batch alone can't know that, so a plain `INSERT` would duplicate it. `MERGE … WHEN NOT MATCHED THEN INSERT` checks the target and only inserts events it hasn't seen; an insert-only `MERGE` like this is the standard append-with-dedup.
- **Touched dates** come from the batch's event times. e3 happened on 28 February but arrived on 2 March, so 28 February's daily aggregates need recomputing too (Q72).
- Advance the watermark afterwards with the frozen-bound pattern from post 02 (Q27).
""",
    steps=[
        Step("Batch", "Rows above the watermark, deduplicated within the batch. e2 is a redelivery of an event already in the mart.",
             run="CREATE OR REPLACE TEMP TABLE batch AS SELECT event_id, user_id, event_ts FROM raw_events WHERE _ingested_at > (SELECT watermark_ts FROM etl_control WHERE table_name = 'mart_events') QUALIFY ROW_NUMBER() OVER (PARTITION BY event_id ORDER BY _ingested_at) = 1",
             tables=[Show("batch", "SELECT *, CASE WHEN event_id IN (SELECT event_id FROM mart_events) THEN 'hit' END AS _mark FROM batch ORDER BY event_id")]),
        Step("MERGE", "Only events the mart hasn't seen are inserted.",
             run="MERGE INTO mart_events t USING batch s ON t.event_id = s.event_id WHEN NOT MATCHED THEN INSERT VALUES (s.event_id, s.user_id, s.event_ts)",
             tables=[Show("mart_events", "SELECT *, CASE WHEN event_id IN ('e3', 'e4') THEN 'new' END AS _mark FROM mart_events ORDER BY event_id")]),
    ],
    trace_alt="Two steps: the batch after in-batch dedup, with e2 highlighted as already in the mart; and the mart after the MERGE, with only e3 and e4 inserted.",
    check="Grain: one row per `event_id` in the mart. Run twice: the `MERGE` inserts nothing new the second time. NULL: an event with a NULL `event_id` never matches and is inserted on every run; reject it before the merge.",
)

q69 = Q(
    id="q69",
    title="A per-user feature table for a churn model",
    level="Medium",
    pattern="Pivot for ML",
    prompt="""
Build one row per user with counts of `view_item`, `add_to_cart`, `purchase` and `login` events in the 30 days up to 2025-03-31, plus days since the user's last event. Users with no events in the window must still appear, with zeros.
""",
    setup="""
CREATE TABLE users (user_id VARCHAR);
INSERT INTO users VALUES ('u1'), ('u2'), ('u3');
CREATE TABLE events (user_id VARCHAR, event_name VARCHAR, event_ts TIMESTAMP);
INSERT INTO events VALUES
    ('u1', 'login', TIMESTAMP '2025-03-25 09:00'), ('u1', 'view_item', TIMESTAMP '2025-03-25 09:02'),
    ('u1', 'add_to_cart', TIMESTAMP '2025-03-25 09:05'), ('u1', 'purchase', TIMESTAMP '2025-03-25 09:09'),
    ('u2', 'login', TIMESTAMP '2025-03-05 10:00'), ('u2', 'view_item', TIMESTAMP '2025-03-05 10:01'),
    ('u2', 'view_item', TIMESTAMP '2025-03-06 10:01'),
    ('u3', 'login', TIMESTAMP '2025-01-15 08:00');
""",
    show=["events"],
    answer="""
SELECT u.user_id,
       COUNT(CASE WHEN e.event_name = 'view_item'   THEN 1 END) AS n_view,
       COUNT(CASE WHEN e.event_name = 'add_to_cart' THEN 1 END) AS n_add_to_cart,
       COUNT(CASE WHEN e.event_name = 'purchase'    THEN 1 END) AS n_purchase,
       COUNT(CASE WHEN e.event_name = 'login'       THEN 1 END) AS n_login,
       datediff('day', (SELECT MAX(event_ts) FROM events x WHERE x.user_id = u.user_id),
                TIMESTAMP '2025-03-31 23:59')                     AS days_since_last_event
FROM users u
LEFT JOIN events e
       ON e.user_id = u.user_id
      AND e.event_ts >  TIMESTAMP '2025-03-31 23:59' - INTERVAL 30 DAY
      AND e.event_ts <= TIMESTAMP '2025-03-31 23:59'
GROUP BY u.user_id
ORDER BY u.user_id;
""",
    hint="Start from the users, not the events, and put the date filter in the join condition rather than the `WHERE`.",
    explain="""
- **Start from `users` with a `LEFT JOIN`.** u3 had nothing in March, and for a churn model the users with *no* recent activity are the most important rows. Starting from events would drop them.
- **The window filter is in the `ON` clause.** In the `WHERE`, it would throw away u3's NULL-joined row and turn the left join back into an inner join, a very common mistake.
- **`COUNT(CASE …)`** pivots event types into feature columns, and counts 0 where there's nothing.
- **Days since last event** looks at all history, not just the window: u3 last appeared 75 days before the as-of date, which is the strongest churn signal in the table.
- **A fixed as-of date** (not `CURRENT_DATE`) makes features reproducible: training data must be computed as of the label date, or the model learns from the future.
""",
    check="Grain: one row per user. NULL: users with no events at all would get a NULL `days_since_last_event`; fill it with a large sentinel or a separate flag before training.",
)

q70 = Q(
    id="q70",
    title="What happens right after add-to-cart?",
    level="Hard",
    pattern="Sequences",
    prompt="""
Within each session, find the event that immediately follows each `add_to_cart`, and rank the next events by how often they occur. An `add_to_cart` that ends a session counts as `(exit)`.
""",
    setup="""
CREATE TABLE sessionized (user_id VARCHAR, session_no INT, event_ts TIMESTAMP, event_name VARCHAR);
INSERT INTO sessionized VALUES
    ('u1', 1, TIMESTAMP '2025-03-01 09:00', 'view_item'), ('u1', 1, TIMESTAMP '2025-03-01 09:02', 'add_to_cart'),
    ('u1', 1, TIMESTAMP '2025-03-01 09:03', 'begin_checkout'),
    ('u1', 2, TIMESTAMP '2025-03-02 10:00', 'add_to_cart'), ('u1', 2, TIMESTAMP '2025-03-02 10:01', 'view_item'),
    ('u2', 1, TIMESTAMP '2025-03-01 11:00', 'add_to_cart'),
    ('u2', 2, TIMESTAMP '2025-03-01 13:00', 'view_item'),
    ('u3', 1, TIMESTAMP '2025-03-01 12:00', 'add_to_cart'), ('u3', 1, TIMESTAMP '2025-03-01 12:01', 'begin_checkout');
""",
    show=["sessionized"],
    answer="""
WITH nxt AS (
    SELECT event_name,
           LEAD(event_name) OVER (PARTITION BY user_id, session_no ORDER BY event_ts) AS next_event
    FROM sessionized
)
SELECT COALESCE(next_event, '(exit)') AS next_event, COUNT(*) AS occurrences
FROM nxt
WHERE event_name = 'add_to_cart'
GROUP BY 1
ORDER BY occurrences DESC, next_event;
""",
    hint="`LEAD` looks one row ahead; partition so it can't look into the next session.",
    explain="""
- **`LEAD(event_name)`** returns the next event in the partition. Partitioning by `(user_id, session_no)` stops u2's cart at 11:00 from "leading" to its next session's `view_item` two hours later, which would be a different visit.
- **The last event of a session has no next**, so `LEAD` returns NULL, which `COALESCE` labels `(exit)`. Dropping NULLs instead would hide every cart abandonment, often the most important path.
- The same `LEAD`-then-group shape builds a full next-step (Markov) table: group by `(event_name, next_event)` instead of filtering on one event.
""",
    check="Grain: one row per next event. NULL: the session-ending NULL is the exit signal, so it is kept and labelled.",
)

q71 = Q(
    id="q71",
    title="A referral tree with a cycle in the data",
    level="Hard",
    pattern="Recursive CTEs",
    prompt="""
`referrals` records who referred whom. Starting from `u1`, list every user in u1's downstream referral tree with their depth, and the total count. The data has a cycle (a bad import says u5 referred u1, the root of the tree), and the query must not loop forever.
""",
    setup="""
CREATE TABLE referrals (user_id VARCHAR, referred_by VARCHAR);
INSERT INTO referrals VALUES
    ('u2', 'u1'), ('u3', 'u1'), ('u4', 'u2'), ('u5', 'u4'), ('u6', 'u3'),
    ('u1', 'u5');   -- bad import: the root u1 'referred by' u5, closing a loop
""",
    show=["referrals"],
    answer="""
WITH RECURSIVE tree AS (
    SELECT user_id, 1 AS depth, ['u1', user_id] AS path        -- base: u1's direct referrals
    FROM referrals
    WHERE referred_by = 'u1'
    UNION ALL
    SELECT r.user_id, t.depth + 1, list_append(t.path, r.user_id)
    FROM tree t
    JOIN referrals r ON r.referred_by = t.user_id
    WHERE NOT list_contains(t.path, r.user_id)                   -- cycle guard
      AND t.depth < 20                                           -- depth guard
)
SELECT user_id, MIN(depth) AS depth
FROM tree
GROUP BY user_id
ORDER BY depth, user_id;
""",
    hint="Carry the path of visited users through the recursion, and stop when the next user is already on it.",
    explain="""
- **The base case** is u1's direct referrals at depth 1. **The recursive step** joins the rows found so far to the users they referred, adding 1 to the depth, and repeats until a step adds nothing.
- **The cycle guard:** the bad row (`u1` referred by `u5`) closes a loop, u1 → u2 → u4 → u5 → u1 → u2 … Without a guard the recursion would go round it forever, or until the engine's recursion limit stops it with an error. Carrying the `path` of visited users and refusing to step onto a user already in it breaks the loop. A depth cap is a second safety net.
- **`MIN(depth)` per user**: with bad data a user can be reached by two routes; report the shortest.
- On Snowflake, build the path with `ARRAY_APPEND` and test it with `ARRAY_CONTAINS`; on Postgres, use an array and `<> ALL(path)`, or the `CYCLE` clause, which Postgres 14 added for exactly this ([docs](https://www.postgresql.org/docs/current/queries-with.html)).
""",
    check="Grain: one row per downstream user. NULL: a NULL `referred_by` marks a root and never matches the join, which is correct.",
)

q72 = Q(
    id="q72",
    title="Daily active users, new and returning, recomputed incrementally",
    level="Expert",
    pattern="Incremental Gold",
    prompt="""
`gold_daily_active` has, per date, active users, new users (first-ever activity that day) and returning users. A batch just added events, including a late one for 1 March. Recompute only the touched dates, idempotently, with the new/returning split still correct.
""",
    setup="""
CREATE TABLE mart_events (event_id VARCHAR, user_id VARCHAR, event_ts TIMESTAMP);
INSERT INTO mart_events VALUES
    ('e1', 'u1', TIMESTAMP '2025-03-01 09:00'), ('e2', 'u2', TIMESTAMP '2025-03-02 10:00'),
    ('e3', 'u1', TIMESTAMP '2025-03-02 11:00');
CREATE TABLE gold_daily_active AS
WITH first_seen AS (SELECT user_id, MIN(CAST(event_ts AS DATE)) AS first_day FROM mart_events GROUP BY 1),
day_users AS (SELECT DISTINCT CAST(event_ts AS DATE) AS d, user_id FROM mart_events)
SELECT du.d AS activity_date, COUNT(*) AS active_users,
       COUNT(CASE WHEN fs.first_day = du.d THEN 1 END) AS new_users,
       COUNT(CASE WHEN fs.first_day < du.d THEN 1 END) AS returning_users
FROM day_users du JOIN first_seen fs USING (user_id) GROUP BY du.d;

-- the new batch: u2's late event on 1 March, and u3's first event on 2 March
INSERT INTO mart_events VALUES ('e9', 'u2', TIMESTAMP '2025-03-01 22:00'), ('e10', 'u3', TIMESTAMP '2025-03-02 12:00');
CREATE TABLE touched AS SELECT DATE '2025-03-01' AS d UNION ALL SELECT DATE '2025-03-02';
""",
    show=["gold_daily_active", "mart_events", "touched"],
    answer="""
DELETE FROM gold_daily_active WHERE activity_date IN (SELECT d FROM touched);

INSERT INTO gold_daily_active
WITH first_seen AS (                           -- over ALL history, not just the batch
    SELECT user_id, MIN(CAST(event_ts AS DATE)) AS first_day
    FROM mart_events GROUP BY user_id
),
day_users AS (
    SELECT DISTINCT CAST(event_ts AS DATE) AS d, user_id
    FROM mart_events
    WHERE CAST(event_ts AS DATE) IN (SELECT d FROM touched)
)
SELECT du.d,
       COUNT(*)                                        AS active_users,
       COUNT(CASE WHEN fs.first_day = du.d THEN 1 END) AS new_users,
       COUNT(CASE WHEN fs.first_day < du.d THEN 1 END) AS returning_users
FROM day_users du
JOIN first_seen fs USING (user_id)
GROUP BY du.d;
""",
    result="SELECT * FROM gold_daily_active ORDER BY activity_date",
    diff=("gold_daily_active", "activity_date"),
    rerun=True,
    hint="A late event can change a user's *first* day, which moves them from 'new' on one date to 'returning' on another. What must `first_seen` be computed over?",
    explain="""
- **Recompute only the touched dates**, with delete-then-insert, so a re-run replaces the same rows with the same values. The build ran it twice.
- **`first_seen` is computed over all history.** A user's first day is a global fact, not a fact about the batch. Here the late event moves u2's first day from 2 March to 1 March: 1 March gains a new user, and on 2 March u2 changes from new to returning. Both dates are touched, so both are rebuilt correctly.
- **The trap:** if a late event changes a user's first day to a date that *isn't* in the batch's touched list, an earlier date's split goes stale. Late events always touch their own date, which is the date that gains the new user, so the touched list covers this case; but if you ever derive `touched` differently, add every date where an affected user was previously counted as new.
- This combines the three incremental patterns of the series: a watermark picks the batch, the touched dates scope the work, and delete-then-insert makes it idempotent.
""",
    check="Grain: one row per date. Run twice: verified unchanged. NULL: users whose events all have NULL timestamps have no first day and are dropped by the inner join; reject such events upstream.",
)


INTRO = f"""
StreamLoop is a SaaS product that emits a clickstream: page views, carts, purchases, logins. This post builds the analytics layer data engineers own for a product like that: turning JSON events into typed rows, sessions, funnels, cohorts, active-user counts, revenue movement and churn, and keeping all of it correct as events arrive late and twice.

{series_callout(SLUG)}

The post covers four areas:

- Events in: flattening JSON and measuring duplication
- Sessions and funnels
- Users over time: cohorts, active users, attribution, revenue movement, churn and percentiles
- Incremental marts: absorbing redeliveries and late events

## How to use this post

{HOW_TO_READ.strip()} Every answer ends with an **Engineer check**: the grain, what happens if it runs twice, and what NULL does. The [first post](/blog/de-sql-foundations#how-the-answers-are-checked) explains how the answers were run and checked.

![StreamLoop's analytics layer: raw JSON events are flattened and deduplicated by event_id, sessionized with a 30-minute gap, and feed four families of models: funnels and next-step paths per session, cohorts and retention per signup week, active users and stickiness per day, and revenue movement and churn per user-month on a zero-filled grid; an incremental mart with an insert-only MERGE and touched-date recomputes keeps them current](/images/data-engineering/de-sql/de-sql-product-analytics/analytics-layers.svg)
"""

OUTRO = """
## Summary

Product analytics SQL is mostly about rows that aren't there. A churned user has no event in the month they left, so churn and MRR movement need a user × month grid. A day with no activity has no row, so rolling counts need a spine. A user who never activated has no activation time, so percentiles must skip them while the cohort still counts them. A session's last event has no next event, and that missing next is the exit. The other theme is order: sessions come from gaps between ordered events, funnels from steps found one after another, attribution from a window frame that covers the whole partition, and new versus returning from a first day computed over all history.

![A map of this post in four columns. Events in: flatten JSON once, measure duplication. Sessions and funnels: a running sum of session starts, steps found in order, LEAD with an exit. Users over time: cohorts, a 28-day window, a spine for rolling distinct counts, full-frame LAST_VALUE, a user-month grid for MRR and churn, percentiles that skip NULLs. Incremental: insert-only MERGE for cross-batch duplicates, touched dates, first day over all history](/images/data-engineering/de-sql/de-sql-product-analytics/summary-map.svg)

### Concepts at a glance

| Concept | In one line | Why it matters |
| --- | --- | --- |
| **Flatten once** | Path, cast, and `FLATTEN`/`UNNEST` for arrays | Typed rows at a known grain |
| **Sessionization** | A running sum of "gap > 30 minutes" flags | Turns an event stream into visits |
| **Ordered funnel** | Each step's first time after the previous step | Counts can only fall, and order is enforced |
| **Cohort triangle** | Distinct users by signup week and week number | Retention, with not-yet-observable cells |
| **Rolling distinct** | Spine join, then `COUNT(DISTINCT)` | Window functions can't slide a distinct count |
| **`LAST_VALUE` frame** | Default frame ends at the current row | Widen it to the whole partition |
| **User × month grid** | Zero-filled rows for every user and month | Makes churn and contraction visible |
| **Percentiles** | `percentile_cont`, which skips NULLs | Skewed durations, with non-converters counted separately |
| **Insert-only MERGE** | `WHEN NOT MATCHED THEN INSERT` | Dedups against what earlier batches loaded |
| **First day over all history** | A global fact, not a batch fact | Keeps new vs returning right under late data |

### Test yourself

<details>
<summary>Why does churn need a user × month grid?</summary>

A churned user has no activity in the month they left, so there is no row for `LAG` to compare. The grid creates a zero row for every inactive month, and the drop from active to zero becomes visible.

</details>

<details>
<summary>`LAST_VALUE(referrer) OVER (PARTITION BY user_id ORDER BY event_ts)` returns each row's own referrer. Why?</summary>

With `ORDER BY` and no frame, the default frame ends at the current row, so the "last value" is the current row's. Add `ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING`.

</details>

<details>
<summary>An event was loaded yesterday and redelivered in today's batch. Why doesn't deduplicating the batch prevent a duplicate?</summary>

The batch holds only one copy, so it looks unique. Only the target knows the event is already there; an insert-only `MERGE` on `event_id` checks it.

</details>

<details>
<summary>How do you count distinct users in a trailing 7-day window for every day?</summary>

Join a spine of days to the activity in each day's range (`activity.d BETWEEN day − 6 AND day`) and `COUNT(DISTINCT user_id)` per day.

</details>

<details>
<summary>The median time to activation should describe users who activated. What should happen to users who never did?</summary>

They stay in the cohort with a NULL time; `percentile_cont` skips them, and the query reports them as a separate count.

</details>

## Sources

- Snowflake: [FLATTEN](https://docs.snowflake.com/en/sql-reference/functions/flatten), [window function syntax and frames](https://docs.snowflake.com/en/sql-reference/functions-window-syntax), [MERGE](https://docs.snowflake.com/en/sql-reference/sql/merge)
- PostgreSQL: [window function frames](https://www.postgresql.org/docs/current/sql-expressions.html#SYNTAX-WINDOW-FUNCTIONS), [recursive queries and the CYCLE clause](https://www.postgresql.org/docs/current/queries-with.html), [ordered-set aggregates (percentile_cont)](https://www.postgresql.org/docs/current/functions-aggregate.html#FUNCTIONS-ORDEREDSET-TABLE)
- DuckDB: [JSON functions](https://duckdb.org/docs/stable/data/json/json_functions), [UNNEST](https://duckdb.org/docs/stable/sql/query_syntax/unnest), [recursive CTEs](https://duckdb.org/docs/stable/sql/query_syntax/with)
"""

POST = Post(
    slug=SLUG,
    title="SQL for Data Engineers: Product Analytics Pipelines",
    description="Part 4 of a data engineering SQL practice bank: a SaaS clickstream turned into sessions, ordered funnels, cohorts, active users, attribution, MRR movement, churn labels and percentiles, kept correct under duplicates and late events. Every answer is run on real sample data.",
    order=4,
    tags=["Data Engineering", "SQL", "Practice", "Analytics"],
    intro=INTRO,
    groups=[
        Group("Events in", "Getting raw events into typed rows, and knowing how dirty they are.", [q55, q56]),
        Group("Sessions and funnels", "Turning a stream into visits, and visits into conversion.", [q57, q58, q59]),
        Group("Users over time", "The metrics that depend on rows that aren't there: inactivity, churn, empty days and users who never converted.", [q60, q61, q62, q63, q64, q65, q66, q67]),
        Group("Incremental marts and features", "Keeping models current as events arrive twice and late, and preparing features for a model.", [q68, q69, q70, q71, q72]),
    ],
    outro=OUTRO,
)
