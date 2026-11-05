// Post 11: database engines and cursors, on MySQL, Postgres, SQLite and real LevelDB.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import mysql from "mysql2/promise";
import { dropDb, freshDb, pause, session, version } from "../lab.mjs";

/** MyISAM has no crash recovery: kill the server mid-write and look at the table afterwards. */
async function myisamCrash() {
  const name = "dbe-mysql-crash";
  const port = 53307;
  spawnSync("docker", ["rm", "-f", name]);
  spawnSync("docker", ["run", "-d", "--name", name, "-p", `${port}:3306`, "-e", "MYSQL_ROOT_PASSWORD=password", "-e", "MYSQL_DATABASE=test", "mysql:8.4"]);
  const connect = async () => {
    for (let i = 0; i < 180; i++) {
      try {
        return await mysql.createConnection({ host: "127.0.0.1", port, user: "root", password: "password", database: "test" });
      } catch {
        await pause(1000);
      }
    }
    throw new Error("no mysql");
  };
  let c = await connect();
  await c.query("CREATE TABLE m (id int PRIMARY KEY AUTO_INCREMENT, name varchar(200)) ENGINE = MyISAM");
  await c.query("CREATE TABLE i (id int PRIMARY KEY AUTO_INCREMENT, name varchar(200)) ENGINE = InnoDB");
  // Two writers hammer the tables until the server dies.
  const writer = async (table) => {
    const w = await mysql.createConnection({ host: "127.0.0.1", port, user: "root", password: "password", database: "test" });
    w.on("error", () => {});
    let n = 0;
    try {
      for (;;) {
        await w.query(`INSERT INTO ${table} (name) SELECT repeat('x', 150) FROM (SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4) a, (SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4) b`);
        n += 16;
      }
    } catch {
      return n;
    }
  };
  const going = [writer("m"), writer("i")];
  await pause(2500);
  spawnSync("docker", ["kill", "-s", "KILL", name]);
  const [, committed] = await Promise.all(going);
  await c.end().catch(() => {});
  spawnSync("docker", ["start", name]);
  c = await connect();
  const q = async (sql) => {
    try {
      const [r] = await c.query(sql);
      return r;
    } catch (e) {
      return [{ error: e.message }];
    }
  };
  const checkM = await q("CHECK TABLE m");
  const checkI = await q("CHECK TABLE i");
  const repair = await q("REPAIR TABLE m");
  const counts = await q("SELECT (SELECT count(*) FROM i) AS innodb_rows, (SELECT count(*) FROM m) AS myisam_rows");
  await c.end();
  spawnSync("docker", ["rm", "-f", name]);
  const rows = (r) => r.map((x) => `${x.Table ?? ""} ${x.Op ?? ""} ${x.Msg_type ?? ""}: ${x.Msg_text ?? x.error ?? ""}`).join("\n");
  return {
    engine: await version("mysql"),
    blocks: [
      { cmd: "-- two clients insert into a MyISAM table and an InnoDB table, then\n$ docker kill -s KILL mysql", out: "(restart)" },
      { cmd: "CHECK TABLE m;   -- MyISAM", out: rows(checkM) },
      { cmd: "CHECK TABLE i;   -- InnoDB", out: rows(checkI) },
      { cmd: "REPAIR TABLE m;", out: rows(repair) },
      { cmd: "-- rows the InnoDB client saw committed, and rows that survived", out: `committed: ${committed}\nInnoDB table now: ${counts[0].innodb_rows}\nMyISAM table now: ${counts[0].myisam_rows}` },
    ],
  };
}

/** A single-writer engine: real SQLite, opened twice. */
async function sqlite() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbe-sqlite-"));
  const file = path.join(dir, "test.db");
  const a = new DatabaseSync(file);
  const b = new DatabaseSync(file, { timeout: 0 });
  a.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT); INSERT INTO t (v) VALUES ('first')");
  const attempt = (fn) => {
    try {
      return JSON.stringify(fn());
    } catch (e) {
      return `ERROR: ${e.message}`;
    }
  };
  a.exec("BEGIN IMMEDIATE");
  a.exec("INSERT INTO t (v) VALUES ('from a')");
  const second = attempt(() => b.exec("INSERT INTO t (v) VALUES ('from b')"));
  const rollbackMode = attempt(() => b.prepare("SELECT count(*) AS n FROM t").get());
  a.exec("COMMIT");
  const version_ = a.prepare("SELECT sqlite_version() AS v").get().v;
  a.exec("PRAGMA journal_mode = WAL");
  a.exec("BEGIN IMMEDIATE");
  a.exec("INSERT INTO t (v) VALUES ('in wal mode')");
  const walRead = attempt(() => b.prepare("SELECT count(*) AS n FROM t").get());
  const walWrite = attempt(() => b.exec("INSERT INTO t (v) VALUES ('second writer')"));
  a.exec("COMMIT");
  a.close();
  b.close();
  fs.rmSync(dir, { recursive: true, force: true });
  return {
    engine: `SQLite ${version_}`,
    blocks: [
      { cmd: "-- connection A holds a write transaction\nBEGIN IMMEDIATE; INSERT INTO t ...;\n-- connection B tries to write a different row", out: second },
      { cmd: "-- connection B reads, in the default rollback-journal mode", out: rollbackMode },
      { cmd: "PRAGMA journal_mode = WAL;\n-- A writes again, B reads", out: walRead },
      { cmd: "-- and B tries to write", out: walWrite },
    ],
  };
}

/** Real LevelDB: watch files appear, and a delete vanish only at compaction. */
async function leveldb() {
  const { ClassicLevel } = await import("classic-level");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbe-level-"));
  const db = new ClassicLevel(dir, { valueEncoding: "utf8", writeBufferSize: 256 * 1024 });
  await db.open();
  const value = "v".repeat(100);
  const size = () => fs.readdirSync(dir).reduce((n, f) => n + fs.statSync(path.join(dir, f)).size, 0);
  const files = () => {
    const names = fs.readdirSync(dir);
    return `${names.filter((f) => f.endsWith(".ldb")).length} table files, ${names.filter((f) => f.endsWith(".log")).length} log file`;
  };
  const key = (i) => `key-${String(i).padStart(7, "0")}`;
  const start_ = process.hrtime.bigint();
  for (let i = 0; i < 200000; i += 1000) {
    await db.batch(Array.from({ length: 1000 }, (_, j) => ({ type: "put", key: key(i + j), value })));
  }
  const secs = Number(process.hrtime.bigint() - start_) / 1e9;
  await pause(1500);
  const afterLoad = { size: size(), files: files() };
  const levels = await db.getProperty("leveldb.stats");
  for (let i = 0; i < 200000; i += 1000) {
    await db.batch(Array.from({ length: 1000 }, (_, j) => ({ type: "del", key: key(i + j) })));
  }
  await pause(800);
  const afterDelete = { size: size(), files: files() };
  let live = 0;
  live = (await db.keys().all()).length;
  await db.compactRange(key(0), key(999999));
  await pause(800);
  const afterCompact = { size: size(), files: files() };
  await db.close();
  fs.rmSync(dir, { recursive: true, force: true });
  const mb = (n) => `${(n / 1048576).toFixed(1)} MB`;
  return {
    engine: "LevelDB, through classic-level",
    blocks: [
      { cmd: "-- 200,000 puts, about 120 bytes each", out: `${Math.round(200000 / secs)} writes per second\n${mb(afterLoad.size)} on disk, ${afterLoad.files}` },
      { cmd: "leveldb.stats", out: levels.trim() },
      { cmd: "-- delete every key", out: `${live} keys left, and still ${mb(afterDelete.size)} on disk, ${afterDelete.files}` },
      { cmd: "db.compactRange(first, last)", out: `${mb(afterCompact.size)} on disk, ${afterCompact.files}` },
    ],
  };
}

/** A client that takes every row at once against a cursor taking 50 at a time. */
async function cursors() {
  const db = await freshDb("postgres");
  const s = await session("postgres").open(db);
  await s.run("CREATE TABLE grades (id int, g int, name text)");
  await s.run("INSERT INTO grades SELECT g, g % 100, 'student ' || g FROM generate_series(1, 2000000) g");
  await s.run("ANALYZE grades");
  const time = async (fn) => {
    const start_ = process.hrtime.bigint();
    const r = await fn();
    return { ms: Number(process.hrtime.bigint() - start_) / 1e6, r };
  };
  global.gc?.();
  const before = process.memoryUsage().heapUsed;
  const all = await time(() => s.run("SELECT id, g, name FROM grades"));
  const heap = process.memoryUsage().heapUsed - before;
  const count = all.r.rows.length;
  all.r = null;
  global.gc?.();
  await s.run("BEGIN");
  const declare = await time(() => s.run("DECLARE c CURSOR FOR SELECT id, g, name FROM grades"));
  const first = await time(() => s.run("FETCH 50 FROM c"));
  const second = await time(() => s.run("FETCH 50 FROM c"));
  const last = await time(() => s.run("FETCH LAST FROM c"));
  await s.run("COMMIT");
  await s.close();
  await dropDb("postgres", db);
  const ms = (x) => `${x.ms.toFixed(1)} ms`;
  return {
    engine: await version("postgres"),
    blocks: [
      { cmd: "-- client side: one query, every row comes back\nSELECT id, g, name FROM grades;", out: `${count.toLocaleString("en-US")} rows in ${ms(all)}, about ${Math.round(heap / 1048576)} MB of client memory` },
      { cmd: "-- server side: a cursor, 50 rows at a time\nDECLARE c CURSOR FOR SELECT id, g, name FROM grades;", out: ms(declare) },
      { cmd: "FETCH 50 FROM c;", out: ms(first) },
      { cmd: "FETCH 50 FROM c;", out: ms(second) },
      { cmd: "FETCH LAST FROM c;   -- the server has to work through everything", out: ms(last) },
    ],
  };
}

const spec = {
  theaters: {
    "myisam-vs-innodb": {
      engine: "mysql",
      title: "The same transaction on two engines",
      alt: "A recorded run on MySQL with tabs for InnoDB and MyISAM. A session begins a transaction and inserts a row. On InnoDB another session can't see the row, and rollback removes it. On MyISAM the row is visible at once, and rollback does nothing, because MyISAM has no transactions.",
      sessions: ["A", "B"],
      tableName: "employees",
      variants: [
        { label: "InnoDB", vars: { e: "InnoDB" }, summary: "Isolation and rollback both worked. The row never existed for anyone else." },
        { label: "MyISAM", vars: { e: "MyISAM" }, summary: "BEGIN and ROLLBACK were accepted and did nothing. The row was visible at once and is still there." },
      ],
      setup: ["CREATE TABLE employees (id int PRIMARY KEY AUTO_INCREMENT, name text) ENGINE = {e}"],
      steps: [
        ["A", "START TRANSACTION", "The engine is {e}."],
        ["A", "INSERT INTO employees (name) VALUES ('Ana')", "Inserted, and not committed."],
        ["A", "SELECT * FROM employees", "Session A sees its own row."],
        ["B", "SELECT * FROM employees", "Can another connection see it?"],
        ["A", "ROLLBACK", "Session A changes its mind."],
        ["B", "SELECT * FROM employees", "Is it gone?"],
      ],
    },
    "table-lock": {
      engine: "mysql",
      title: "A MyISAM read holds up a write to any row",
      alt: "A recorded run on MySQL. Session A locks a MyISAM table for reading, as a long report does. Session B's update of an unrelated row waits for the whole table. On InnoDB the same update of a different row isn't blocked by a row lock held elsewhere.",
      sessions: ["A", "B"],
      tableName: "t",
      variants: [
        {
          label: "MyISAM",
          summary: "Locks are per table: session B's row had nothing to do with session A, and it waited anyway.",
          vars: { e: "MyISAM" },
          steps: [
            ["A", "LOCK TABLES t READ", "A long report on a MyISAM table holds a table-level read lock. This statement makes that lock last long enough to see."],
            ["B", "UPDATE t SET v = 2 WHERE id = 2", "Session B wants to change a single row. It waits for the whole table."],
            ["A", "UNLOCK TABLES", "Only when the report ends does the update go through."],
          ],
        },
        {
          label: "InnoDB",
          summary: "Locks are per row: different rows don't get in each other's way.",
          vars: { e: "InnoDB" },
          steps: [
            ["A", "START TRANSACTION", "On InnoDB, session A works on row 1."],
            ["A", "UPDATE t SET v = 2 WHERE id = 1", "That locks row 1 only."],
            ["B", "UPDATE t SET v = 2 WHERE id = 2", "Row 2 is free, so this goes straight through."],
            ["A", "COMMIT", "Done."],
          ],
        },
      ],
      setup: ["CREATE TABLE t (id int PRIMARY KEY, v int) ENGINE = {e}", "INSERT INTO t VALUES (1, 1), (2, 1)"],
      steps: [],
    },
    "cursor-hold": {
      title: "An open cursor is a held-open transaction",
      alt: "A recorded run on PostgreSQL. Session A opens a cursor inside a transaction and fetches some rows. Session B's ALTER TABLE waits, because the cursor's transaction still holds a lock on the table, until session A commits.",
      sessions: ["A", "B"],
      tableName: "grades",
      setup: ["CREATE TABLE grades (id int, g int)", "INSERT INTO grades SELECT g, g % 100 FROM generate_series(1, 1000) g"],
      steps: [
        ["A", "BEGIN", "A cursor lives inside a transaction."],
        ["A", "DECLARE c CURSOR FOR SELECT * FROM grades ORDER BY id", "The query is planned, and no rows are returned yet."],
        ["A", "FETCH 3 FROM c", "Three rows. The cursor remembers where it is."],
        ["B", "ALTER TABLE grades ADD COLUMN note text", "A schema change needs an exclusive lock, and the open transaction is holding a lock. It waits. So does everything queued behind it."],
        ["A", "FETCH 2 FROM c", "The application is in no hurry: it's still paging through."],
        ["A", "COMMIT", "Closing the transaction closes the cursor, and the ALTER goes through."],
      ],
    },
  },

  runs: {
    "show-engines": {
      engine: "mysql",
      sql: `SELECT engine, support, transactions FROM information_schema.engines WHERE support <> 'NO' ORDER BY engine;`,
    },
    "hidden-key": {
      engine: "mysql",
      sql: `CREATE TABLE no_key (name varchar(20)) ENGINE = InnoDB;
INSERT INTO no_key VALUES ('a');
SELECT i.name AS index_name, i.type FROM information_schema.innodb_indexes i JOIN information_schema.innodb_tables t USING (table_id) WHERE t.name LIKE '%/no_key';`,
    },
    "pg-access-methods": {
      sql: `SELECT amname, CASE amtype WHEN 't' THEN 'table' ELSE 'index' END AS kind FROM pg_am ORDER BY amtype DESC, amname;`,
    },
    "myisam-crash": myisamCrash,
    sqlite,
    leveldb,
    cursors,
    "cursor-sql": {
      setup: ["CREATE TABLE grades (id int, g int)", "INSERT INTO grades SELECT n, n % 100 FROM generate_series(1, 1000000) n", "ANALYZE grades"],
      sql: `BEGIN;
DECLARE c CURSOR FOR SELECT id FROM grades WHERE g BETWEEN 90 AND 100;
FETCH 3 FROM c;
FETCH 2 FROM c;
CLOSE c;
COMMIT;`,
    },
  },

  playgrounds: {
    cursor: {
      title: "A server-side cursor",
      hint: "This box keeps its transaction open between runs, like a real client would. Run the presets in order. The status line says when a transaction is still open.",
      setup: `CREATE TABLE grades (id int, g int, name text);
INSERT INTO grades SELECT g, g % 100, 'student ' || g FROM generate_series(1, 100000) g;`,
      query: `BEGIN;
DECLARE c CURSOR FOR SELECT id, g, name FROM grades WHERE g >= 90 ORDER BY id;
FETCH 5 FROM c;`,
      presets: [
        { label: "Fetch 5 more", sql: "FETCH 5 FROM c;" },
        { label: "Jump to the end", sql: "FETCH LAST FROM c;" },
        { label: "See open cursors", sql: "SELECT name, statement, is_scrollable FROM pg_cursors;" },
        { label: "Finish", sql: "COMMIT;" },
      ],
      mayFail: true,
    },
  },
};

export default spec;
