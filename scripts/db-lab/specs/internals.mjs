// Post 14: processes, WAL, MVCC, write amplification, NULLs, SELECT * and distributed transactions.
import { spawnSync } from "node:child_process";
import pg from "pg";
import { docker, dropDb, ENGINES, freshDb, inContainer, pause, session, start, version } from "../lab.mjs";

/** What's really running inside the two servers. */
async function processes() {
  await start("postgres");
  await start("mysql");
  const c = new pg.Client({ host: "127.0.0.1", port: ENGINES.postgres.port, user: "postgres", password: "postgres", database: "postgres" });
  await c.connect();
  const c2 = new pg.Client({ host: "127.0.0.1", port: ENGINES.postgres.port, user: "postgres", password: "postgres", database: "postgres" });
  await c2.connect();
  const list = (await c.query("SELECT backend_type, count(*)::int AS n FROM pg_stat_activity GROUP BY 1 ORDER BY 1")).rows;
  const pids = (await c.query("SELECT pid FROM pg_stat_activity WHERE backend_type = 'client backend' ORDER BY pid LIMIT 2")).rows.map((r) => r.pid);
  const shared = (await c.query("SHOW shared_buffers")).rows[0].shared_buffers;
  const io = (await c.query("SHOW io_method")).rows[0].io_method;
  await c.end();
  await c2.end();
  const mysqlThreads = inContainer("dbe-mysql", `mysql -uroot -N -e "SELECT type, count(*) FROM performance_schema.threads GROUP BY type; SELECT name FROM performance_schema.threads WHERE type = 'BACKGROUND' AND name LIKE '%innodb/%' ORDER BY name LIMIT 8;"`, "", ["MYSQL_PWD=password"]);
  const mysqlProc = inContainer("dbe-mysql", "ls /proc | grep -E '^[0-9]+$' | wc -l; ls /proc/1/task | wc -l");
  return {
    engine: await version("postgres"),
    blocks: [
      { cmd: "SELECT backend_type, count(*) FROM pg_stat_activity GROUP BY 1;", out: list.map((r) => `${r.backend_type.padEnd(30)} ${r.n}`).join("\n") },
      { cmd: "-- two client connections are two operating system processes", out: `backend pids: ${pids.join(", ")}\nshared_buffers = ${shared}, io_method = ${io}` },
      { cmd: "-- MySQL, for comparison: one process, many threads", out: `processes in the container: ${mysqlProc.trim().split("\n")[0]}, threads in mysqld: ${mysqlProc.trim().split("\n")[1]}\n${mysqlThreads.trim()}` },
    ],
  };
}

/** One update, measured: how much WAL does it write, and which indexes does it touch? */
async function writeAmp() {
  const db = await freshDb("postgres");
  const s = await session("postgres").open(db);
  const points = [];
  await s.run("CREATE TABLE t (id int PRIMARY KEY, a int, b int, c int, d int, e int, note text) WITH (fillfactor = 70)");
  await s.run("INSERT INTO t SELECT g, g, g, g, g, g, 'note' FROM generate_series(1, 200000) g");
  await s.run("VACUUM ANALYZE t");
  for (const n of [0, 1, 2, 3, 4, 5]) {
    if (n > 0) await s.run(`CREATE INDEX t_${"abcde"[n - 1]} ON t (${"abcde"[n - 1]})`);
    await s.run("CHECKPOINT");
    const run = async (sql) => {
      await s.run("VACUUM t");
      await s.run("CHECKPOINT");
      const before = (await s.run("SELECT pg_current_wal_insert_lsn()")).rows[0][0];
      await s.run(sql);
      const bytes = Number((await s.run(`SELECT pg_current_wal_insert_lsn() - '${before}'::pg_lsn`)).rows[0][0]);
      return Math.round(bytes / 1024 / 1024);
    };
    const hot = await run("UPDATE t SET note = 'x' WHERE id % 4 = 0");
    const cold = await run("UPDATE t SET a = a + 1 WHERE id % 4 = 0");
    points.push([n, hot, cold]);
  }
  await s.close();
  await dropDb("postgres", db);
  return {
    engine: await version("postgres"),
    title: "WAL written to update 50,000 rows",
    alt: "Megabytes of write-ahead log written to update 50,000 rows, as a table gains secondary indexes from none to five. Updating a column with no index stays flat, because of heap-only tuples. Updating an indexed column grows with every index on the table, even indexes on other columns.",
    x: { label: "secondary indexes on the table" },
    y: { label: "WAL written", unit: "MB" },
    series: [
      { name: "unindexed column (HOT)", points: points.map((p) => [p[0], p[1]]) },
      { name: "indexed column", points: points.map((p) => [p[0], p[2]]) },
    ],
  };
}

/** Real pages for one row and its index entry, through a HOT update and an ordinary one. */
async function hotSteps() {
  const db = await freshDb("postgres");
  const s = await session("postgres").open(db);
  await s.run("CREATE EXTENSION pageinspect");
  await s.run("CREATE TABLE t (id int PRIMARY KEY, v text, note text) WITH (autovacuum_enabled = off, fillfactor = 50)");
  await s.run("INSERT INTO t VALUES (1, 'a', 'x')");
  const snap = async (label, caption) => {
    await s.run("CHECKPOINT");
    const heap = await s.run("SELECT lp, lp_off, lp_flags, t_xmin::text, t_xmax::text, t_ctid::text, (t_infomask2 & 16384) > 0 AS hot_updated, (t_infomask2 & 32768) > 0 AS heap_only FROM heap_page_items(get_raw_page('t', 0)) ORDER BY lp");
    const idx = await s.run("SELECT itemoffset, ctid::text FROM bt_page_items('t_pkey', 1) ORDER BY itemoffset");
    return { label, caption, heap: heap.rows, index: idx.rows };
  };
  const steps = [await snap("A new row", "One row version, and one index entry pointing at line pointer 1.")];
  await s.run("UPDATE t SET note = 'y' WHERE id = 1");
  steps.push(await snap("HOT update", "note isn't indexed and the page has room, so the new version is heap-only. The index still has one entry, pointing at line pointer 1, and the old version links to the new one."));
  await s.run("UPDATE t SET note = 'z' WHERE id = 1");
  steps.push(await snap("HOT again", "The chain grows, and the index still isn't touched."));
  await s.run("CREATE INDEX t_v ON t (v)");
  await s.run("UPDATE t SET v = 'b' WHERE id = 1");
  steps.push(await snap("Update an indexed column", "With an index on v, changing v can't be HOT. The new version gets its own line pointer, and every index gets a new entry, including the primary key, though id never changed."));
  await s.run("VACUUM t");
  steps.push(await snap("VACUUM", "Dead versions are removed and the stale index entry goes with them."));
  await s.close();
  await dropDb("postgres", db);
  return { engine: await version("postgres"), steps };
}

/** Prepared transactions: the two phases of 2PC on real servers. */
async function twoPhase() {
  const name = "dbe-2pc";
  const port = 55471;
  spawnSync("docker", ["rm", "-f", name]);
  docker("run", "-d", "--name", name, "-p", `${port}:5432`, "-e", "POSTGRES_PASSWORD=postgres", "postgres:18", "-c", "max_prepared_transactions=10");
  const connect = async () => {
    for (let i = 0; i < 90; i++) {
      const c = new pg.Client({ host: "127.0.0.1", port, user: "postgres", password: "postgres", database: "postgres" });
      c.on("error", () => {});
      try {
        await c.connect();
        return c;
      } catch {
        await c.end().catch(() => {});
        await pause(500);
      }
    }
    throw new Error("no postgres");
  };
  let c = await connect();
  await c.query("CREATE TABLE accounts (id int PRIMARY KEY, balance int); INSERT INTO accounts VALUES (1, 500)");
  await c.query("BEGIN");
  await c.query("UPDATE accounts SET balance = balance - 100 WHERE id = 1");
  await c.query("PREPARE TRANSACTION 'transfer-42'");
  const pending = (await c.query("SELECT gid, prepared IS NOT NULL AS prepared FROM pg_prepared_xacts")).rows[0];
  const balance = (await c.query("SELECT balance FROM accounts WHERE id = 1")).rows[0].balance;
  const blocked = new pg.Client({ host: "127.0.0.1", port, user: "postgres", password: "postgres", database: "postgres" });
  await blocked.connect();
  await blocked.query("SET lock_timeout = '300ms'");
  const lock = await blocked.query("UPDATE accounts SET balance = 0 WHERE id = 1").catch((e) => e.message);
  await blocked.end();
  spawnSync("docker", ["kill", "-s", "KILL", name]);
  await c.end().catch(() => {});
  spawnSync("docker", ["start", name]);
  c = await connect();
  const survived = (await c.query("SELECT count(*)::int AS n FROM pg_prepared_xacts")).rows[0].n;
  await c.query("COMMIT PREPARED 'transfer-42'");
  const final = (await c.query("SELECT balance FROM accounts WHERE id = 1")).rows[0].balance;
  await c.end();
  spawnSync("docker", ["rm", "-f", name]);
  return {
    engine: await version("postgres"),
    blocks: [
      { cmd: "BEGIN;\nUPDATE accounts SET balance = balance - 100 WHERE id = 1;\nPREPARE TRANSACTION 'transfer-42';\nSELECT gid FROM pg_prepared_xacts;", out: pending.gid },
      { cmd: "SELECT balance FROM accounts WHERE id = 1;", out: `${balance}   (not committed, so other sessions see the old value)` },
      { cmd: "-- another session tries to change the row", out: String(lock) },
      { cmd: "$ docker kill -s KILL (the server dies while prepared)\n$ docker start\nSELECT count(*) FROM pg_prepared_xacts;", out: `${survived}   (it survived the crash, and it's still holding its lock)` },
      { cmd: "COMMIT PREPARED 'transfer-42';\nSELECT balance FROM accounts WHERE id = 1;", out: String(final) },
    ],
  };
}

const select = async () => {
  const db = await freshDb("postgres");
  const s = await session("postgres").open(db);
  await s.run("CREATE TABLE students (id serial PRIMARY KEY, grade int, name text, bio text, photo text)");
  await s.run("INSERT INTO students (grade, name, bio, photo) SELECT g % 100, 'student ' || g, repeat('bio ', 50), repeat(md5(g::text), 300) FROM generate_series(1, 50000) g");
  await s.run("CREATE INDEX students_grade ON students (grade, id)");
  await s.run("VACUUM ANALYZE students");
  const time = async (sql) => {
    await s.run(sql);
    const runs = [];
    let bytes = 0;
    for (let i = 0; i < 3; i++) {
      const start_ = process.hrtime.bigint();
      const r = await s.run(sql);
      runs.push(Number(process.hrtime.bigint() - start_) / 1e6);
      bytes = Buffer.byteLength(JSON.stringify(r.rows));
    }
    return { ms: runs.sort((a, b) => a - b)[1], bytes };
  };
  const narrow = await time("SELECT id FROM students WHERE grade >= 90");
  const wide = await time("SELECT * FROM students WHERE grade >= 90");
  const plan = async (sql) => (await s.run(`EXPLAIN (ANALYZE, BUFFERS, COSTS OFF, TIMING OFF, SUMMARY OFF) ${sql}`)).rows.map((r) => r[0]).filter((l) => /Scan|Buffers: shared|Heap Fetches/.test(l)).slice(0, 3).join("\n");
  const p1 = await plan("SELECT id FROM students WHERE grade >= 90");
  const p2 = await plan("SELECT * FROM students WHERE grade >= 90");
  await s.close();
  await dropDb("postgres", db);
  const line = (x) => `${x.ms.toFixed(1)} ms, ${x.bytes > 1048576 ? `${(x.bytes / 1048576).toFixed(1)} MB` : `${Math.round(x.bytes / 1024)} KB`} delivered to the client`;
  return {
    engine: await version("postgres"),
    blocks: [
      { cmd: "SELECT id FROM students WHERE grade >= 90;", out: `${line(narrow)}\n${p1}` },
      { cmd: "SELECT * FROM students WHERE grade >= 90;", out: `${line(wide)}\n${p2}` },
    ],
  };
};

const spec = {
  runs: {
    processes,
    "two-phase": twoPhase,
    "select-star": select,
    "wal-records": {
      setup: ["CREATE EXTENSION pg_walinspect", "CREATE TABLE t (id int, v text)"],
      sql: `SELECT pg_current_wal_insert_lsn() AS start_here \\gset
BEGIN;
INSERT INTO t VALUES (1, 'a');
UPDATE t SET v = 'b' WHERE id = 1;
COMMIT;
SELECT resource_manager, record_type, record_length, fpi_length FROM pg_get_wal_records_info(:'start_here', pg_current_wal_insert_lsn());`,
    },
    "full-page-writes": {
      setup: ["CREATE TABLE t (id int PRIMARY KEY, v int)", "INSERT INTO t SELECT g, 0 FROM generate_series(1, 100000) g", "VACUUM ANALYZE t"],
      sql: `CHECKPOINT;
SELECT pg_current_wal_insert_lsn() AS a \\gset
UPDATE t SET v = 1 WHERE id % 100 = 0;
SELECT pg_size_pretty(pg_current_wal_insert_lsn() - :'a') AS wal_just_after_a_checkpoint;
SELECT pg_current_wal_insert_lsn() AS b \\gset
UPDATE t SET v = 2 WHERE id % 100 = 0;
SELECT pg_size_pretty(pg_current_wal_insert_lsn() - :'b') AS the_same_update_again;`,
    },
    "hot-counters": {
      setup: ["CREATE TABLE t (id int PRIMARY KEY, v int, note text) WITH (fillfactor = 70)", "CREATE INDEX t_v ON t (v)", "INSERT INTO t SELECT g, g, 'n' FROM generate_series(1, 10000) g", "VACUUM ANALYZE t"],
      sql: `UPDATE t SET note = 'changed';
UPDATE t SET v = v + 1;
SELECT pg_stat_force_next_flush();
SELECT n_tup_upd, n_tup_hot_upd FROM pg_stat_user_tables WHERE relname = 't';`,
    },
    "innodb-undo": {
      engine: "mysql",
      setup: ["CREATE TABLE t (id int PRIMARY KEY, v int)", "INSERT INTO t VALUES (1, 1)"],
      sql: `SELECT name, count FROM information_schema.innodb_metrics WHERE name = 'trx_rseg_history_len';
SHOW VARIABLES LIKE 'innodb_undo_tablespaces';
SELECT space_type, name FROM information_schema.innodb_tablespaces WHERE row_format = 'Undo' OR name LIKE 'innodb_undo%';`,
    },
    "nulls-size": {
      setup: ["CREATE EXTENSION pageinspect"],
      sql: `CREATE TABLE n (a int, b int, c int, d int, e int, f int, g int, h int, i int);
INSERT INTO n VALUES (1, 2, 3, 4, 5, 6, 7, 8, 9);
INSERT INTO n VALUES (1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
SELECT lp, lp_len, t_hoff, t_bits FROM heap_page_items(get_raw_page('n', 0));`,
    },
    "nulls-logic": {
      setup: ["CREATE TABLE t (id int, parent int)", "INSERT INTO t VALUES (1, NULL), (2, 1), (3, 1)"],
      sql: `SELECT count(*) AS all_rows, count(parent) AS with_a_parent FROM t;
SELECT id FROM t WHERE parent = NULL;
SELECT id FROM t WHERE parent IS NULL;
SELECT id FROM t WHERE id NOT IN (SELECT parent FROM t);
SELECT id FROM t WHERE id NOT IN (SELECT parent FROM t WHERE parent IS NOT NULL);
SELECT NULL = NULL AS equal, NULL IS NOT DISTINCT FROM NULL AS same;`,
    },
    "nulls-index": {
      setup: [
        "CREATE TABLE t (id int, v int)",
        "INSERT INTO t SELECT g, CASE WHEN g % 100 = 0 THEN g END FROM generate_series(1, 1000000) g",
        "CREATE INDEX t_v ON t (v)",
        "CREATE INDEX t_v_partial ON t (v) WHERE v IS NOT NULL",
        "VACUUM ANALYZE t",
      ],
      sql: `EXPLAIN (COSTS OFF) SELECT id FROM t WHERE v IS NULL LIMIT 1;
SELECT indexrelname, pg_size_pretty(pg_relation_size(indexrelid)) FROM pg_stat_user_indexes WHERE relname = 't';`,
    },
    bloat: {
      setup: ["CREATE TABLE t (id int PRIMARY KEY, v int) WITH (autovacuum_enabled = off)", "INSERT INTO t SELECT g, 0 FROM generate_series(1, 100000) g"],
      sql: `SELECT pg_size_pretty(pg_relation_size('t')) AS before;
UPDATE t SET v = v + 1;
UPDATE t SET v = v + 1;
UPDATE t SET v = v + 1;
SELECT pg_size_pretty(pg_relation_size('t')) AS after_three_updates;
SELECT pg_stat_force_next_flush();
SELECT n_live_tup, n_dead_tup FROM pg_stat_user_tables WHERE relname = 't';
VACUUM t;
SELECT pg_size_pretty(pg_relation_size('t')) AS after_vacuum;
VACUUM FULL t;
SELECT pg_size_pretty(pg_relation_size('t')) AS after_vacuum_full;`,
    },
  },

  charts: {
    "write-amp": writeAmp,
  },

  data: {
    "hot-steps": hotSteps,
  },

  theaters: {
    "long-transaction": {
      title: "One open transaction stops the cleanup",
      alt: "A recorded run on PostgreSQL. Session A opens a repeatable read transaction and reads. Session B updates every row and vacuums, but vacuum can't remove the old versions, because session A might still need them. After session A commits, vacuum removes them.",
      sessions: ["A", "B"],
      tableName: "dead row versions",
      setup: ["CREATE TABLE t (id int PRIMARY KEY, v int) WITH (autovacuum_enabled = off)", "INSERT INTO t SELECT g, 0 FROM generate_series(1, 1000) g"],
      steps: [
        ["A", "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ", "A long report starts."],
        ["A", "SELECT sum(v) FROM t", "Its snapshot is now fixed."],
        ["B", "UPDATE t SET v = 1", "Another session updates every row. Each row now has an old version that A's snapshot can still see."],
        ["B", "VACUUM (VERBOSE) t", "VACUUM can't remove them. The tag only says VACUUM, but the next step shows the result."],
        ["B", "SELECT n_dead_tup FROM pg_stat_user_tables WHERE relname = 't'", "All 1,000 dead versions are still there."],
        ["A", "COMMIT", "The report ends."],
        ["B", "VACUUM t", "Now nothing needs the old versions."],
        ["B", "SELECT n_dead_tup FROM pg_stat_user_tables WHERE relname = 't'", "Gone."],
      ],
    },
  },

  playgrounds: {
    hot: {
      title: "HOT or not?",
      hint: "n_tup_hot_upd counts updates that touched no index. Update the unindexed column, then the indexed one, and compare.",
      setup: `CREATE TABLE t (id int PRIMARY KEY, v int, note text) WITH (fillfactor = 70);
CREATE INDEX t_v ON t (v);
INSERT INTO t SELECT g, g, 'n' FROM generate_series(1, 5000) g;
VACUUM ANALYZE t;`,
      query: `UPDATE t SET note = 'changed';
DO $$ BEGIN PERFORM pg_stat_force_next_flush(); END $$;
SELECT n_tup_upd, n_tup_hot_upd FROM pg_stat_user_tables WHERE relid = 't'::regclass;`,
      presets: [
        { label: "Update the indexed column", sql: `UPDATE t SET v = v + 1;
DO $$ BEGIN PERFORM pg_stat_force_next_flush(); END $$;
SELECT n_tup_upd, n_tup_hot_upd FROM pg_stat_user_tables WHERE relid = 't'::regclass;` },
        { label: "See a HOT chain", sql: `CREATE TABLE IF NOT EXISTS small (id int PRIMARY KEY, note text) WITH (autovacuum_enabled = off);
TRUNCATE small;
INSERT INTO small VALUES (1, 'a');
UPDATE small SET note = 'b' WHERE id = 1;
UPDATE small SET note = 'c' WHERE id = 1;
SELECT lp, t_ctid, t_xmax, (t_infomask2 & 16384) > 0 AS hot_updated, (t_infomask2 & 32768) > 0 AS heap_only
FROM heap_page_items(get_raw_page('small', 0));` },
      ],
    },
    nulls: {
      title: "NULL isn't a value",
      hint: "Each preset is a real trap. Try to predict the result first.",
      setup: `CREATE TABLE t (id int, parent int);
INSERT INTO t VALUES (1, NULL), (2, 1), (3, 1);`,
      query: `SELECT count(*), count(parent) FROM t;`,
      presets: [
        { label: "= NULL", sql: "SELECT id FROM t WHERE parent = NULL;" },
        { label: "NOT IN with a NULL", sql: "SELECT id FROM t WHERE id NOT IN (SELECT parent FROM t);" },
        { label: "NOT EXISTS instead", sql: "SELECT id FROM t a WHERE NOT EXISTS (SELECT 1 FROM t b WHERE b.parent = a.id);" },
      ],
    },
    wal: {
      title: "Read the log",
      hint: "pg_walinspect reads the WAL. Run a change, then read the records it wrote, including the commit record.",
      setup: `CREATE TABLE t (id int, v text);
CREATE TEMP TABLE mark (lsn pg_lsn);`,
      query: `TRUNCATE mark;
INSERT INTO mark SELECT pg_current_wal_insert_lsn();
INSERT INTO t VALUES (1, 'a');
SELECT resource_manager, record_type, record_length
FROM pg_get_wal_records_info((SELECT lsn FROM mark), pg_current_wal_insert_lsn());`,
      presets: [
        { label: "An update", sql: `TRUNCATE mark;
INSERT INTO mark SELECT pg_current_wal_insert_lsn();
UPDATE t SET v = v || 'b';
SELECT resource_manager, record_type, record_length
FROM pg_get_wal_records_info((SELECT lsn FROM mark), pg_current_wal_insert_lsn());` },
      ],
    },
  },
};

export default spec;
