// Post 5: B-Trees and B+Trees, read from real index pages.
import { dropDb, freshDb, session, version } from "../lab.mjs";

/** An int key as pageinspect prints it: little-endian hex bytes. */
const keyOf = (data) => {
  if (!data) return null;
  const bytes = data.trim().split(" ").slice(0, 4).reverse().join("");
  return parseInt(bytes, 16);
};

const blockOf = (ctid) => Number(ctid.slice(1).split(",")[0]);

/** Walks a real index from its root to one key, the way an index scan does. */
async function walk() {
  const db = await freshDb("postgres");
  const s = await session("postgres").open(db);
  await s.run("CREATE EXTENSION pageinspect");
  await s.run("CREATE TABLE t (id int PRIMARY KEY, name text)");
  await s.run("INSERT INTO t SELECT g, 'row ' || g FROM generate_series(1, 1000000) g");
  await s.run("VACUUM ANALYZE t");
  const target = 703000;
  const meta = (await s.run("SELECT root, level FROM bt_metap('t_pkey')")).rows[0];
  let block = meta[0];
  const lines = [];
  for (;;) {
    const stats = (await s.run(`SELECT type, live_items, btpo_prev, btpo_next, btpo_level FROM bt_page_stats('t_pkey', ${block})`)).rows[0];
    const [type, items, prev, next, level] = stats;
    const rows = (await s.run(`SELECT itemoffset, ctid::text, data, htid::text FROM bt_page_items('t_pkey', ${block}) ORDER BY itemoffset`)).rows;
    const label = type === "r" ? "root" : type === "i" ? "internal" : "leaf";
    if (level > 0) {
      // On an internal page each entry is a separator and a downlink. Take the last one <= target.
      let child = null;
      for (const [, ctid, data] of rows) {
        const key = keyOf(data);
        if (key === null || key <= target || Number.isNaN(key)) child = { block: blockOf(ctid), key };
      }
      lines.push(`page ${String(block).padEnd(5)} ${label.padEnd(9)} level ${level}  ${items} entries, separator ${child.key ?? "(lowest)"} points down to page ${child.block}`);
      block = child.block;
      continue;
    }
    const hit = rows.find(([, , data]) => keyOf(data) === target);
    lines.push(`page ${String(block).padEnd(5)} leaf      level 0  ${items} entries, key ${target} -> heap address ${hit[1]}`);
    lines.push(`             leaf neighbours: previous page ${prev}, next page ${next}`);
    break;
  }
  const check = (await s.run(`SELECT ctid::text, id, name FROM t WHERE id = ${target}`)).rows[0];
  const total = (await s.run("SELECT pg_relation_size('t_pkey') / 8192")).rows[0][0];
  await s.close();
  await dropDb("postgres", db);
  return {
    engine: await version("postgres"),
    blocks: [
      { cmd: `-- walking the primary key of a 1,000,000-row table to id = ${target}\n-- the index has ${total} pages, and the root is page ${meta[0]}`, out: lines.join("\n") },
      { cmd: `SELECT ctid, id, name FROM t WHERE id = ${target};`, out: `heap says: ctid ${check[0]}, id ${check[1]}, name '${check[2]}'` },
    ],
  };
}

const spec = {
  runs: {
    walk,
    "key-types": {
      setup: [
        "CREATE EXTENSION pageinspect",
        "CREATE TABLE k_int AS SELECT g::int AS k FROM generate_series(1, 1000000) g",
        "CREATE TABLE k_big AS SELECT g::bigint AS k FROM generate_series(1, 1000000) g",
        "CREATE TABLE k_uuid AS SELECT gen_random_uuid() AS k FROM generate_series(1, 1000000) g",
        "CREATE TABLE k_text AS SELECT gen_random_uuid()::text AS k FROM generate_series(1, 1000000) g",
        "ALTER TABLE k_int ADD PRIMARY KEY (k)",
        "ALTER TABLE k_big ADD PRIMARY KEY (k)",
        "ALTER TABLE k_uuid ADD PRIMARY KEY (k)",
        "ALTER TABLE k_text ADD PRIMARY KEY (k)",
      ],
      sql: `SELECT key_type, index_size, pages, height, entries_in_a_leaf
FROM (VALUES ('int, 4 bytes', 'k_int_pkey'), ('bigint, 8 bytes', 'k_big_pkey'), ('uuid, 16 bytes', 'k_uuid_pkey'), ('text, 36 characters', 'k_text_pkey')) AS x(key_type, idx),
LATERAL (SELECT pg_size_pretty(pg_relation_size(idx::regclass)) AS index_size, pg_relation_size(idx::regclass) / 8192 AS pages) s,
LATERAL (SELECT level + 1 AS height FROM bt_metap(idx)) m,
LATERAL (SELECT live_items AS entries_in_a_leaf FROM bt_page_stats(idx, 100)) p;`,
    },
    "range-leaves": {
      setup: ["CREATE TABLE t (id int PRIMARY KEY, name text)", "INSERT INTO t SELECT g, 'row ' || g FROM generate_series(1, 1000000) g", "VACUUM ANALYZE t"],
      sql: `EXPLAIN (ANALYZE, BUFFERS, COSTS OFF, TIMING OFF, SUMMARY OFF) SELECT id FROM t WHERE id BETWEEN 4000 AND 9000;`,
    },
    "pk-bloat-mysql": {
      engine: "mysql",
      setup: [
        "SET SESSION cte_max_recursion_depth = 1000000",
        "CREATE TABLE users_int (id int PRIMARY KEY, email varchar(40), KEY idx_email (email))",
        "CREATE TABLE users_uuid (id char(36) PRIMARY KEY, email varchar(40), KEY idx_email (email))",
        "INSERT INTO users_int WITH RECURSIVE g(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM g WHERE n < 300000) SELECT n, concat('user', n, '@example.com') FROM g",
        "INSERT INTO users_uuid WITH RECURSIVE g(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM g WHERE n < 300000) SELECT uuid(), concat('user', n, '@example.com') FROM g",
        "ANALYZE TABLE users_int, users_uuid",
      ],
      sql: `SELECT table_name, index_name, round(stat_value * 16 / 1024, 1) AS size_mb FROM mysql.innodb_index_stats WHERE database_name = database() AND stat_name = 'size' ORDER BY table_name, index_name;`,
    },
  },

  playgrounds: {
    pages: {
      title: "Look inside a real B+Tree",
      hint: "100,000 rows and a primary key. These are the index's real pages. In bt_page_items, ctid on a leaf is a heap address, and on an internal page its first number is the child page.",
      setup: `CREATE TABLE t (id int PRIMARY KEY, name text);
INSERT INTO t SELECT g, 'row ' || g FROM generate_series(1, 100000) g;
VACUUM ANALYZE t;`,
      query: `SELECT root, level, fastroot FROM bt_metap('t_pkey');`,
      presets: [
        { label: "The root page", sql: `SELECT itemoffset, ctid, itemlen, data
FROM bt_page_items('t_pkey', (SELECT root FROM bt_metap('t_pkey')))
LIMIT 6;` },
        { label: "A leaf page's stats", sql: `SELECT blkno, type, live_items, avg_item_size, free_size, btpo_prev, btpo_next
FROM bt_page_stats('t_pkey', 1);` },
        { label: "Entries in a leaf", sql: `SELECT itemoffset, ctid, data
FROM bt_page_items('t_pkey', 1) LIMIT 6;` },
        { label: "Follow the leaf links", sql: `SELECT blkno, btpo_prev, btpo_next, live_items
FROM generate_series(1, 5) AS g, LATERAL bt_page_stats('t_pkey', g);` },
      ],
    },
  },
};

export default spec;
