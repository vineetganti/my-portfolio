// Post 6: partitioning. Five million rows where the course used ten.
import { dropDb, freshDb, session, version } from "../lab.mjs";

const SETUP = [
  "CREATE TABLE grades_org (id serial NOT NULL, g int NOT NULL)",
  "INSERT INTO grades_org (g) SELECT floor(random() * 100) FROM generate_series(1, 5000000)",
  "CREATE INDEX grades_org_g ON grades_org (g)",
  "VACUUM ANALYZE grades_org",
];

const PARTS = [
  "CREATE TABLE grades_parts (id serial NOT NULL, g int NOT NULL) PARTITION BY RANGE (g)",
  "CREATE TABLE g0035 (LIKE grades_parts INCLUDING INDEXES)",
  "CREATE TABLE g3560 (LIKE grades_parts INCLUDING INDEXES)",
  "CREATE TABLE g6080 (LIKE grades_parts INCLUDING INDEXES)",
  "CREATE TABLE g80100 (LIKE grades_parts INCLUDING INDEXES)",
  "ALTER TABLE grades_parts ATTACH PARTITION g0035 FOR VALUES FROM (0) TO (35)",
  "ALTER TABLE grades_parts ATTACH PARTITION g3560 FOR VALUES FROM (35) TO (60)",
  "ALTER TABLE grades_parts ATTACH PARTITION g6080 FOR VALUES FROM (60) TO (80)",
  "ALTER TABLE grades_parts ATTACH PARTITION g80100 FOR VALUES FROM (80) TO (100)",
];

const ALL = [...SETUP, ...PARTS, "INSERT INTO grades_parts SELECT * FROM grades_org", "CREATE INDEX grades_parts_g ON grades_parts (g)", "VACUUM ANALYZE grades_parts"];

/** Time to remove old data: delete rows from a table, or detach a whole partition. */
async function dropOld() {
  const db = await freshDb("postgres");
  const s = await session("postgres").open(db);
  await s.run("CREATE TABLE events (id bigserial, at date NOT NULL, body text)");
  await s.run("CREATE INDEX ON events (at)");
  await s.run("CREATE TABLE events_p (id bigserial, at date NOT NULL, body text) PARTITION BY RANGE (at)");
  for (const y of [2023, 2024, 2025, 2026]) await s.run(`CREATE TABLE events_${y} PARTITION OF events_p FOR VALUES FROM ('${y}-01-01') TO ('${y + 1}-01-01')`);
  await s.run("CREATE INDEX ON events_p (at)");
  const load = (t) => `INSERT INTO ${t} (at, body) SELECT date '2023-01-01' + (g % 1460), repeat('x', 40) FROM generate_series(1, 2000000) g`;
  await s.run(load("events"));
  await s.run(load("events_p"));
  const time = async (sql) => {
    const start = process.hrtime.bigint();
    const r = await s.run(sql);
    return { ms: Number(process.hrtime.bigint() - start) / 1e6, tag: r.tag };
  };
  const del = await time("DELETE FROM events WHERE at < '2024-01-01'");
  const detach = await time("ALTER TABLE events_p DETACH PARTITION events_2023");
  const drop = await time("DROP TABLE events_2023");
  await s.close();
  await dropDb("postgres", db);
  return {
    engine: await version("postgres"),
    blocks: [
      { cmd: "-- remove a year of data from a 2,000,000-row table\nDELETE FROM events WHERE at < '2024-01-01';", out: `${del.tag}\nTime: ${del.ms.toFixed(1)} ms` },
      { cmd: "ALTER TABLE events_p DETACH PARTITION events_2023;\nDROP TABLE events_2023;", out: `Time: ${(detach.ms + drop.ms).toFixed(1)} ms` },
    ],
  };
}

const spec = {
  runs: {
    baseline: {
      setup: SETUP,
      sql: `EXPLAIN (ANALYZE, BUFFERS, COSTS OFF, SUMMARY ON) SELECT count(*) FROM grades_org WHERE g = 30;`,
    },
    routing: {
      setup: [...SETUP, ...PARTS],
      sql: `INSERT INTO grades_parts SELECT * FROM grades_org;
SELECT tableoid::regclass AS partition, count(*), min(g), max(g) FROM grades_parts GROUP BY 1 ORDER BY 3;`,
    },
    "index-on-parent": {
      setup: [...SETUP, ...PARTS, "INSERT INTO grades_parts SELECT * FROM grades_org"],
      sql: `CREATE INDEX grades_parts_g ON grades_parts (g);
SELECT tablename, indexname FROM pg_indexes WHERE tablename ~ '^g[0-9]|grades_parts' ORDER BY 1;
SELECT relname, pg_size_pretty(pg_relation_size(oid)) AS size FROM pg_class WHERE relname IN ('grades_org', 'grades_org_g', 'g0035', 'g0035_g_idx') ORDER BY pg_relation_size(oid) DESC;`,
    },
    pruning: {
      setup: ALL,
      sql: `EXPLAIN (ANALYZE, BUFFERS, COSTS OFF, TIMING OFF, SUMMARY ON) SELECT count(*) FROM grades_parts WHERE g = 30;
SHOW enable_partition_pruning;
SET enable_partition_pruning = off;
EXPLAIN (COSTS OFF) SELECT count(*) FROM grades_parts WHERE g = 30;`,
    },
    "no-index-win": {
      setup: [...SETUP, ...PARTS, "INSERT INTO grades_parts SELECT * FROM grades_org", "DROP INDEX grades_org_g", "VACUUM ANALYZE grades_org", "VACUUM ANALYZE grades_parts"],
      sql: `SET max_parallel_workers_per_gather = 0;
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF, TIMING OFF) SELECT count(*) FROM grades_org WHERE g BETWEEN 85 AND 90;
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF, TIMING OFF) SELECT count(*) FROM grades_parts WHERE g BETWEEN 85 AND 90;`,
    },
    "bad-query": {
      setup: ALL,
      sql: `EXPLAIN (COSTS OFF) SELECT * FROM grades_parts WHERE id = 7;`,
    },
    "row-move": {
      setup: [
        "CREATE TABLE grades_parts (id serial NOT NULL, g int NOT NULL) PARTITION BY RANGE (g)",
        "CREATE TABLE g_low PARTITION OF grades_parts FOR VALUES FROM (0) TO (50)",
        "CREATE TABLE g_high PARTITION OF grades_parts FOR VALUES FROM (50) TO (100)",
        "INSERT INTO grades_parts (g) SELECT 10 FROM generate_series(1, 200000)",
      ],
      sql: `\\timing on
SELECT tableoid::regclass, id, g FROM grades_parts WHERE id = 1;
UPDATE grades_parts SET g = 90 WHERE id = 1;
SELECT tableoid::regclass, id, g FROM grades_parts WHERE id = 1;
UPDATE grades_parts SET g = 20 WHERE id <= 100000 AND id > 1;
UPDATE grades_parts SET g = 80 WHERE id <= 100000 AND id > 1;`,
    },
    "null-key": {
      setup: [
        "CREATE TABLE grades_parts (id serial, g int) PARTITION BY RANGE (g)",
        "CREATE TABLE g_all PARTITION OF grades_parts FOR VALUES FROM (0) TO (100)",
      ],
      sql: `INSERT INTO grades_parts (g) VALUES (NULL);
CREATE TABLE g_default PARTITION OF grades_parts DEFAULT;
INSERT INTO grades_parts (g) VALUES (NULL);
SELECT tableoid::regclass, id, g FROM grades_parts;`,
    },
    "drop-old": dropOld,
    "int-limit": {
      sql: `SELECT 2147483647 AS largest_int;
SELECT 2147483647 + 1;
SELECT 2147483647::bigint + 1 AS as_bigint;`,
    },
    automation: {
      sql: `CREATE TABLE customers (id int NOT NULL, name text) PARTITION BY RANGE (id);
DO $$
BEGIN
  FOR i IN 0..99 LOOP
    EXECUTE format('CREATE TABLE customers_%s PARTITION OF customers FOR VALUES FROM (%s) TO (%s)', i, i * 10000000, (i + 1) * 10000000);
  END LOOP;
END $$;
SELECT count(*) AS partitions FROM pg_inherits WHERE inhparent = 'customers'::regclass;
INSERT INTO customers VALUES (123456789, 'Ana');
SELECT tableoid::regclass, id, name FROM customers WHERE id = 123456789;
EXPLAIN (COSTS OFF) SELECT * FROM customers WHERE id = 123456789;`,
    },
  },

  playgrounds: {
    parts: {
      title: "Partitions you can poke",
      hint: "A table of 100,000 grades split into four ranges. Each preset shows one idea from this post. Upper bounds are exclusive.",
      setup: `CREATE TABLE grades (id serial NOT NULL, g int NOT NULL) PARTITION BY RANGE (g);
CREATE TABLE g0035 PARTITION OF grades FOR VALUES FROM (0) TO (35);
CREATE TABLE g3560 PARTITION OF grades FOR VALUES FROM (35) TO (60);
CREATE TABLE g6080 PARTITION OF grades FOR VALUES FROM (60) TO (80);
CREATE TABLE g80100 PARTITION OF grades FOR VALUES FROM (80) TO (100);
INSERT INTO grades (g) SELECT floor(random() * 100) FROM generate_series(1, 100000);
CREATE INDEX ON grades (g);
ANALYZE grades;`,
      query: `SELECT tableoid::regclass AS partition, count(*), min(g), max(g)
FROM grades GROUP BY 1 ORDER BY 3;`,
      presets: [
        { label: "Pruned to one", sql: "EXPLAIN (COSTS OFF) SELECT count(*) FROM grades WHERE g = 30;" },
        { label: "Not on the key", sql: "EXPLAIN (COSTS OFF) SELECT * FROM grades WHERE id = 7;" },
        { label: "A row moves", sql: `SELECT tableoid::regclass, id, g FROM grades WHERE id = 1;
UPDATE grades SET g = (g + 50) % 100 WHERE id = 1;
SELECT tableoid::regclass, id, g FROM grades WHERE id = 1;` },
        { label: "Outside every range", sql: "INSERT INTO grades (g) VALUES (100);" },
      ],
      mayFail: true,
    },
  },
};

export default spec;
