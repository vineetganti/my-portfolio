// Post 3: indexes and query plans. Tables are 1 million rows where the course used 10 to 50 million.
import { dropDb, freshDb, session, version } from "../lab.mjs";

const EMPLOYEES = [
  "CREATE TABLE employees (id serial PRIMARY KEY, name text)",
  "INSERT INTO employees (name) SELECT substr(md5(random()::text), 1, 1 + (random() * 9)::int) FROM generate_series(1, 1000000)",
  "VACUUM ANALYZE employees",
];

const GRADES = [
  "CREATE TABLE grades (id int, g int, name text)",
  "INSERT INTO grades SELECT g, (random() * 100)::int, 'student ' || g FROM generate_series(1, 1000000) g",
  "VACUUM ANALYZE grades",
];

const STUDENTS = [
  `CREATE TABLE students (id serial PRIMARY KEY, g int, firstname text, lastname text, address text, bio text, dob date,
     id1 int, id2 int, id3 int, id4 int, id5 int)`,
  `INSERT INTO students (g, firstname, lastname, address, bio, dob, id1, id2, id3, id4, id5)
   SELECT (random() * 100)::int, md5(random()::text), md5(random()::text), md5(random()::text), md5(random()::text), now(),
     random() * 100000, random() * 100000, random() * 100000, random() * 100000, random() * 100000
   FROM generate_series(1, 1000000)`,
  "VACUUM ANALYZE students",
];

async function scratch(setup) {
  const db = await freshDb("postgres");
  const s = await session("postgres").open(db);
  for (const stmt of setup) await s.run(stmt);
  return { s, done: async () => (await s.close(), await dropDb("postgres", db)) };
}

const jsonPlan = async (s, options, sql) => {
  const r = await s.run(`EXPLAIN (${options}, FORMAT JSON) ${sql}`);
  return JSON.parse(r.rows[0][0])[0];
};

const FORCED = {
  "Index Scan": ["SET enable_indexscan = on", "SET enable_bitmapscan = off", "SET enable_seqscan = off"],
  "Bitmap Heap Scan": ["SET enable_indexscan = off", "SET enable_bitmapscan = on", "SET enable_seqscan = off"],
  "Seq Scan": ["SET enable_indexscan = off", "SET enable_bitmapscan = off", "SET enable_seqscan = on"],
};

const SELECTIVITY = [0.001, 0.01, 0.1, 0.5, 1, 2, 5, 10, 20, 30, 50, 75, 100];

/** Asks the planner for each plan at each selectivity, by turning the other two off. */
async function sweep() {
  const { s, done } = await scratch([
    "CREATE TABLE t (id serial PRIMARY KEY, x int, pad text)",
    "INSERT INTO t (x, pad) SELECT (random() * 1000000)::int, repeat('p', 40) FROM generate_series(1, 1000000)",
    "CREATE INDEX t_x ON t (x)",
    "VACUUM ANALYZE t",
    "SET max_parallel_workers_per_gather = 0",
  ]);
  const costs = Object.fromEntries(Object.keys(FORCED).map((k) => [k, []]));
  const times = Object.fromEntries(Object.keys(FORCED).map((k) => [k, []]));
  const chosen = {};
  for (const pct of SELECTIVITY) {
    const sql = `SELECT sum(id) FROM t WHERE x < ${Math.round(pct * 10000)}`;
    await s.run("RESET enable_indexscan; RESET enable_bitmapscan; RESET enable_seqscan");
    const plan = await jsonPlan(s, "COSTS", sql);
    const child = plan.Plan.Plans[0]["Node Type"];
    chosen[pct] = child;
    for (const [name, sets] of Object.entries(FORCED)) {
      for (const stmt of sets) await s.run(stmt);
      const p = await jsonPlan(s, "COSTS", sql);
      costs[name].push([pct, p.Plan["Total Cost"], name === child ? "the planner's pick" : undefined]);
      await s.run(sql); // warm the cache so the times compare plans, not disks
      const runs = [];
      for (let i = 0; i < 3; i++) runs.push((await jsonPlan(s, "ANALYZE, TIMING OFF", sql))["Execution Time"]);
      times[name].push([pct, +runs.sort((a, b) => a - b)[1].toFixed(2), name === child ? "the planner's pick" : undefined]);
    }
  }
  await done();
  const engine = await version("postgres");
  const clean = (rows) => rows.map(([x, y, w]) => (w ? [x, y, w] : [x, y]));
  const series = (data) => Object.entries(data).map(([name, points]) => ({ name, points: clean(points) }));
  return {
    cost: {
      engine,
      title: "What the planner expects each plan to cost",
      alt: "The planner's estimated cost of three plans for one query as the share of matching rows grows from 0.001% to 100% of a million-row table. Index Scan is cheapest for very few rows, Bitmap Heap Scan takes over in the middle, and Seq Scan is flat and becomes cheapest once a large share matches.",
      x: { label: "% of rows matching", log: true, format: "pct" },
      y: { label: "estimated cost", log: true },
      series: series(costs),
    },
    time: {
      engine,
      title: "What each plan really took, from a warm cache",
      alt: "Measured time of the same three plans on the same query from a warm cache. The lines cross at different places from the planner's estimates, because the planner's default costs assume random page reads are four times as slow as sequential ones.",
      x: { label: "% of rows matching", log: true, format: "pct" },
      y: { label: "execution time", log: true, unit: "ms" },
      series: series(times),
    },
  };
}

let swept;
const planSweep = () => (swept ??= sweep());

/** The course's experiment: three index layouts against the four query shapes a backend sends. */
async function matrix() {
  const { s, done } = await scratch([
    "CREATE TABLE test (a int, b int, c int)",
    "INSERT INTO test SELECT (random() * 100)::int, (random() * 100)::int, g FROM generate_series(1, 1000000) g",
    "VACUUM ANALYZE test",
  ]);
  const queries = [
    ["a only", "SELECT c FROM test WHERE a = 70"],
    ["a only, LIMIT 2", "SELECT c FROM test WHERE a = 70 LIMIT 2"],
    ["b only", "SELECT c FROM test WHERE b = 40"],
    ["a AND b", "SELECT c FROM test WHERE a = 70 AND b = 40"],
    ["a OR b", "SELECT c FROM test WHERE a = 70 OR b = 40"],
  ];
  const configs = [
    ["Separate: (a), (b)", ["CREATE INDEX i_a ON test (a)", "CREATE INDEX i_b ON test (b)"], ["DROP INDEX i_a", "DROP INDEX i_b"]],
    ["Composite: (a, b)", ["CREATE INDEX i_ab ON test (a, b)"], []],
    ["Composite plus (b)", ["CREATE INDEX i_b ON test (b)"], ["DROP INDEX i_ab", "DROP INDEX i_b"]],
  ];
  const out = [];
  for (const [label, create, drop] of configs) {
    for (const stmt of create) await s.run(stmt);
    await s.run("ANALYZE test");
    const rows = [];
    for (const [name, sql] of queries) {
      await s.run(sql);
      const lines = (await s.run(`EXPLAIN (ANALYZE, BUFFERS, TIMING OFF, SUMMARY ON) ${sql}`)).rows.map((r) => r[0]);
      const text = lines.filter((l) => !/^(Planning|\s+Buffers: shared hit=\d+$)/.test(l) || /^\s+Buffers/.test(l));
      const plan = await jsonPlan(s, "ANALYZE, BUFFERS, TIMING OFF", sql);
      const nodes = [];
      const walk = (n) => {
        nodes.push(n["Node Type"] + (n["Index Name"] ? ` ${n["Index Name"]}` : ""));
        (n.Plans ?? []).forEach(walk);
      };
      walk(plan.Plan);
      rows.push({
        name,
        sql,
        nodes: nodes.filter((n) => !/^(Gather|Limit)/.test(n)),
        buffers: plan.Plan["Shared Hit Blocks"] + plan.Plan["Shared Read Blocks"],
        rows: plan.Plan["Actual Rows"],
        ms: +plan["Execution Time"].toFixed(1),
        text: text.join("\n"),
      });
    }
    out.push({ label, rows });
    for (const stmt of drop) await s.run(stmt);
  }
  await done();
  return { engine: await version("postgres"), configs: out };
}

const spec = {
  theaters: {
    "create-index-lock": {
      title: "CREATE INDEX blocks writes",
      alt: "A recorded run on PostgreSQL. Session A creates an index inside a transaction. Session B's reads still work, but its insert waits until session A commits, because CREATE INDEX holds a lock that conflicts with writes.",
      sessions: ["A", "B"],
      tableName: "orders",
      setup: ["CREATE TABLE orders (id serial PRIMARY KEY, total int)", "INSERT INTO orders (total) SELECT g FROM generate_series(1, 1000) g"],
      observe: "SELECT count(*) AS rows FROM orders",
      steps: [
        ["A", "BEGIN", "The transaction holds the index build open, so the lock is easy to see. A real build on a big table holds it for as long as the build takes."],
        ["A", "CREATE INDEX orders_total ON orders (total)", "Session A builds an index, which takes a SHARE lock on the table."],
        ["B", "SELECT count(*) FROM orders", "Reads are fine: a SHARE lock doesn't conflict with them."],
        ["B", "INSERT INTO orders (total) VALUES (1)", "A write isn't. The application's insert now hangs."],
        ["A", "COMMIT", "Only when the build ends does the insert go through. On a table with hundreds of millions of rows, that could be hours."],
      ],
    },
    "create-index-concurrently": {
      title: "CONCURRENTLY doesn't block, but it does wait",
      alt: "A recorded run on PostgreSQL. Session A has a transaction open. Session B starts CREATE INDEX CONCURRENTLY, which waits for that older transaction to finish. Meanwhile a third session's inserts go through without waiting. When session A commits, the index build completes.",
      sessions: ["A", "B", "C"],
      tableName: "orders",
      setup: ["CREATE TABLE orders (id serial PRIMARY KEY, total int)", "INSERT INTO orders (total) SELECT g FROM generate_series(1, 1000) g"],
      observe: "SELECT count(*) AS rows FROM orders",
      steps: [
        ["A", "BEGIN", "Session A opens a transaction and does some work."],
        ["A", "INSERT INTO orders (total) VALUES (2)", "It's still open."],
        ["B", "CREATE INDEX CONCURRENTLY orders_total ON orders (total)", "The concurrent build can't finish while an older transaction might still change the table, so it waits."],
        ["C", "INSERT INTO orders (total) VALUES (3)", "But it blocks nobody. A new insert goes straight through."],
        ["A", "COMMIT", "Session A finishes. Now the build can complete, and the statement returns."],
      ],
    },
  },

  runs: {
    "plan-basics": {
      setup: EMPLOYEES,
      sql: `\\d employees
EXPLAIN ANALYZE SELECT id FROM employees WHERE id = 2000;
EXPLAIN ANALYZE SELECT name FROM employees WHERE id = 2000;
EXPLAIN ANALYZE SELECT id FROM employees WHERE name = 'Zs';`,
    },
    "plan-basics-indexed": {
      setup: [...EMPLOYEES, "CREATE INDEX employees_name ON employees (name)", "ANALYZE employees"],
      sql: `EXPLAIN ANALYZE SELECT id, name FROM employees WHERE name = 'Zs';
EXPLAIN ANALYZE SELECT id, name FROM employees WHERE name LIKE '%Zs%';`,
    },
    trigram: {
      setup: [...EMPLOYEES, "CREATE EXTENSION pg_trgm", "CREATE INDEX employees_name_trgm ON employees USING gin (name gin_trgm_ops)", "ANALYZE employees"],
      sql: `EXPLAIN ANALYZE SELECT id, name FROM employees WHERE name LIKE '%abc%';`,
    },
    "skip-scan": {
      setup: [
        "CREATE TABLE few (a int, b int, c int)",
        "INSERT INTO few SELECT g % 10, (random() * 1000)::int, g FROM generate_series(1, 1000000) g",
        "CREATE INDEX few_ab ON few (a, b)",
        "CREATE TABLE many (a int, b int, c int)",
        "INSERT INTO many SELECT g, (random() * 1000)::int, g FROM generate_series(1, 1000000) g",
        "CREATE INDEX many_ab ON many (a, b)",
        "VACUUM ANALYZE few",
        "VACUUM ANALYZE many",
      ],
      sql: `SET max_parallel_workers_per_gather = 0;
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF, TIMING OFF, SUMMARY OFF) SELECT c FROM few WHERE b = 40;
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF, TIMING OFF, SUMMARY OFF) SELECT c FROM many WHERE b = 40;`,
    },
    "cost-numbers": {
      setup: GRADES,
      sql: `EXPLAIN SELECT * FROM grades;
EXPLAIN SELECT * FROM grades ORDER BY g;
EXPLAIN SELECT * FROM grades ORDER BY g LIMIT 10;`,
    },
    "grades-steps": {
      setup: GRADES,
      sql: `EXPLAIN ANALYZE SELECT name FROM grades WHERE id = 7;
CREATE INDEX id_idx ON grades (id);
EXPLAIN ANALYZE SELECT name FROM grades WHERE id = 7;
EXPLAIN ANALYZE SELECT id FROM grades WHERE id = 7;
DROP INDEX id_idx;
CREATE INDEX id_idx ON grades (id) INCLUDE (name);
VACUUM grades;
EXPLAIN ANALYZE SELECT name FROM grades WHERE id = 7;
EXPLAIN ANALYZE SELECT g FROM grades WHERE id = 7;`,
    },
    students: {
      setup: STUDENTS,
      sql: `EXPLAIN (ANALYZE, BUFFERS) SELECT id, g FROM students WHERE g > 80 AND g < 95 ORDER BY g;
CREATE INDEX students_g ON students (g);
EXPLAIN (ANALYZE, BUFFERS) SELECT id, g FROM students WHERE g > 80 AND g < 95 ORDER BY g;
DROP INDEX students_g;
CREATE INDEX students_g ON students (g) INCLUDE (id);
VACUUM students;
EXPLAIN (ANALYZE, BUFFERS) SELECT id, g FROM students WHERE g > 80 AND g < 95 ORDER BY g;
SELECT pg_size_pretty(pg_relation_size('students')) AS table_size, pg_size_pretty(pg_relation_size('students_g')) AS index_size;`,
    },
    visibility: {
      setup: [
        "CREATE TABLE fresh (id int) WITH (autovacuum_enabled = off)",
        "INSERT INTO fresh SELECT generate_series(1, 100000)",
        "CREATE INDEX fresh_id ON fresh (id)",
        "ANALYZE fresh",
      ],
      sql: `EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF, SUMMARY OFF) SELECT count(*) FROM fresh WHERE id < 50000;
VACUUM fresh;
EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF, SUMMARY OFF) SELECT count(*) FROM fresh WHERE id < 50000;
UPDATE fresh SET id = id WHERE id < 5000;
EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF, SUMMARY OFF) SELECT count(*) FROM fresh WHERE id < 50000;`,
    },
    "tiny-table": {
      setup: ["CREATE TABLE tiny (id int PRIMARY KEY, name text)", "INSERT INTO tiny SELECT g, 'row ' || g FROM generate_series(1, 7) g", "ANALYZE tiny"],
      sql: `EXPLAIN SELECT * FROM tiny WHERE id = 3;
SELECT relpages FROM pg_class WHERE relname = 'tiny';`,
    },
    "stale-stats": {
      setup: [
        "CREATE TABLE orders (id serial PRIMARY KEY, status text) WITH (autovacuum_enabled = off)",
        "CREATE INDEX orders_status ON orders (status)",
        "INSERT INTO orders (status) SELECT 'new' FROM generate_series(1, 3)",
        "ANALYZE orders",
        "INSERT INTO orders (status) SELECT CASE WHEN g % 100000 = 0 THEN 'held' ELSE 'shipped' END FROM generate_series(1, 1000000) g",
      ],
      sql: `EXPLAIN ANALYZE SELECT * FROM orders WHERE status = 'shipped';
ANALYZE orders;
EXPLAIN ANALYZE SELECT * FROM orders WHERE status = 'shipped';
EXPLAIN ANALYZE SELECT * FROM orders WHERE status = 'held';`,
    },
    "seek-or-scan": {
      setup: ["CREATE TABLE grades (id int PRIMARY KEY, g int)", "INSERT INTO grades SELECT g, g % 100 FROM generate_series(1, 1000000) g", "VACUUM ANALYZE grades"],
      sql: `EXPLAIN (ANALYZE, BUFFERS, COSTS OFF, TIMING OFF, SUMMARY OFF) SELECT g FROM grades WHERE id IN (1, 5003, 9000);
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF, TIMING OFF, SUMMARY OFF) SELECT g FROM grades WHERE id BETWEEN 1 AND 9000;`,
    },
    duplicates: {
      setup: [
        "CREATE TABLE tickets (id int, project int)",
        "INSERT INTO tickets SELECT g, g % 10 FROM generate_series(1, 1000000) g",
      ],
      sql: `CREATE INDEX unique_ish ON tickets (id);
CREATE INDEX dedup_on ON tickets (project);
CREATE INDEX dedup_off ON tickets (project) WITH (deduplicate_items = off);
SELECT indexrelname AS index, pg_size_pretty(pg_relation_size(indexrelid)) AS size FROM pg_stat_user_indexes ORDER BY pg_relation_size(indexrelid) DESC;`,
    },
    "invalid-index": {
      setup: ["CREATE TABLE users (id int, email text)", "INSERT INTO users VALUES (1, 'a@example.com'), (2, 'a@example.com')"],
      sql: `CREATE UNIQUE INDEX CONCURRENTLY users_email ON users (email);
\\d users
DROP INDEX users_email;`,
    },
    "index-hint-mysql": {
      engine: "mysql",
      setup: [
        "CREATE TABLE t (id int PRIMARY KEY AUTO_INCREMENT, a int, b int, KEY i_a (a), KEY i_b (b))",
        "INSERT INTO t (a, b) SELECT g % 10, g % 1000 FROM (WITH RECURSIVE s(g) AS (SELECT 1 UNION ALL SELECT g + 1 FROM s WHERE g < 1000) SELECT g FROM s) n",
        "ANALYZE TABLE t",
      ],
      sql: `EXPLAIN SELECT id FROM t WHERE a = 1 AND b = 1;
EXPLAIN SELECT id FROM t FORCE INDEX (i_a) WHERE a = 1 AND b = 1;`,
    },
    skew: {
      setup: [
        "CREATE TABLE customers (id serial PRIMARY KEY, state text)",
        "INSERT INTO customers (state) SELECT CASE WHEN g = 500 THEN 'Florida' ELSE 'California' END FROM generate_series(1, 1000000) g",
        "CREATE INDEX customers_state ON customers (state)",
        "VACUUM ANALYZE customers",
      ],
      sql: `SET max_parallel_workers_per_gather = 0;
EXPLAIN SELECT * FROM customers WHERE state = 'California';
EXPLAIN SELECT * FROM customers WHERE state = 'Florida';
SELECT most_common_vals, most_common_freqs FROM pg_stats WHERE tablename = 'customers' AND attname = 'state';`,
    },
  },

  charts: {
    "plan-cost": async () => (await planSweep()).cost,
    "plan-time": async () => (await planSweep()).time,
  },

  data: {
    matrix,
  },

  playgrounds: {
    plans: {
      title: "Watch the plan change",
      hint: "100,000 rows with an index on x. Each preset asks for a different share of the table. Read the top line of each plan.",
      setup: `CREATE TABLE t (id serial PRIMARY KEY, x int, name text);
INSERT INTO t (x, name) SELECT (random() * 100000)::int, 'row ' || g FROM generate_series(1, 100000) g;
CREATE INDEX t_x ON t (x);
VACUUM ANALYZE t;`,
      query: `EXPLAIN (ANALYZE, BUFFERS, COSTS OFF, TIMING OFF, SUMMARY OFF)
SELECT name FROM t WHERE x = 500;`,
      presets: [
        { label: "1 row: index scan", sql: `EXPLAIN (ANALYZE, BUFFERS, COSTS OFF, TIMING OFF, SUMMARY OFF)
SELECT name FROM t WHERE id = 500;` },
        { label: "2% of rows: bitmap", sql: `EXPLAIN (ANALYZE, BUFFERS, COSTS OFF, TIMING OFF, SUMMARY OFF)
SELECT name FROM t WHERE x < 2000;` },
        { label: "50% of rows: seq scan", sql: `EXPLAIN (ANALYZE, BUFFERS, COSTS OFF, TIMING OFF, SUMMARY OFF)
SELECT name FROM t WHERE x < 50000;` },
        { label: "Index only", sql: `EXPLAIN (ANALYZE, BUFFERS, COSTS OFF, TIMING OFF, SUMMARY OFF)
SELECT x FROM t WHERE x < 500;` },
        { label: "Function on the column", sql: `EXPLAIN (COSTS OFF)
SELECT name FROM t WHERE x + 1 = 501;` },
      ],
    },
    composite: {
      title: "The leftmost column rule",
      hint: "A composite index on (a, b). Which of these can use it? Edit the WHERE clause, or create another index and run them again.",
      setup: `CREATE TABLE test (a int, b int, c int);
INSERT INTO test SELECT (random() * 100)::int, (random() * 100)::int, g FROM generate_series(1, 100000) g;
CREATE INDEX i_ab ON test (a, b);
VACUUM ANALYZE test;`,
      query: `EXPLAIN (COSTS OFF) SELECT c FROM test WHERE a = 70;`,
      presets: [
        { label: "b alone", sql: "EXPLAIN (COSTS OFF) SELECT c FROM test WHERE b = 40;" },
        { label: "a AND b", sql: "EXPLAIN (COSTS OFF) SELECT c FROM test WHERE a = 70 AND b = 40;" },
        { label: "a OR b", sql: "EXPLAIN (COSTS OFF) SELECT c FROM test WHERE a = 70 OR b = 40;" },
        { label: "Add an index on b", sql: "CREATE INDEX IF NOT EXISTS i_b ON test (b);\nEXPLAIN (COSTS OFF) SELECT c FROM test WHERE a = 70 OR b = 40;" },
      ],
    },
  },
};

export default spec;
