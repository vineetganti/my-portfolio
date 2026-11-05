// Post 8: locks, deadlocks, double booking, pagination and connection pools.
import pg from "pg";
import { dropDb, ENGINES, freshDb, session, version } from "../lab.mjs";

const SEATS = [
  "CREATE TABLE seats (id int PRIMARY KEY, isbooked int NOT NULL DEFAULT 0, name text)",
  "INSERT INTO seats (id) SELECT generate_series(1, 5)",
];
const SEAT_VIEW = "SELECT id, isbooked, name FROM seats WHERE id <= 2 ORDER BY id";

const connect = (database) => new pg.Client({ host: "127.0.0.1", port: ENGINES.postgres.port, user: "postgres", password: "postgres", database });
const pool = (database, max) => new pg.Pool({ host: "127.0.0.1", port: ENGINES.postgres.port, user: "postgres", password: "postgres", database, max });

/** Offset against keyset pagination on a real table. */
async function pagination() {
  const db = await freshDb("postgres");
  const s = await session("postgres").open(db);
  await s.run("CREATE TABLE news (id serial PRIMARY KEY, title text, body text)");
  await s.run("INSERT INTO news (title, body) SELECT 'story ' || g, repeat('x', 200) FROM generate_series(1, 2000000) g");
  await s.run("VACUUM ANALYZE news");
  const offset = [];
  const keyset = [];
  for (const n of [0, 1000, 10000, 100000, 500000, 1000000, 1900000]) {
    const last = 2000000 - n;
    const time = async (sql) => {
      await s.run(sql);
      const runs = [];
      for (let i = 0; i < 5; i++) {
        const r = await s.run(`EXPLAIN (ANALYZE, FORMAT JSON) ${sql}`);
        runs.push(JSON.parse(r.rows[0][0])[0]["Execution Time"]);
      }
      return +runs.sort((a, b) => a - b)[2].toFixed(3);
    };
    offset.push([n, await time(`SELECT id, title FROM news ORDER BY id DESC OFFSET ${n} LIMIT 10`)]);
    keyset.push([n, await time(`SELECT id, title FROM news WHERE id < ${last} ORDER BY id DESC LIMIT 10`)]);
  }
  await s.close();
  await dropDb("postgres", db);
  // A log axis can't show an offset of 0, so start the axis at the first page after it.
  const tail = (rows) => rows.map(([n, ms]) => [Math.max(n, 10), ms]);
  return {
    engine: await version("postgres"),
    title: "Fetching one page of 10, deep into a table",
    alt: "Time to fetch ten rows from a two-million-row table, at increasing depths. With OFFSET the time grows in step with the depth, because the rows are read and thrown away. With keyset pagination it stays flat at a fraction of a millisecond.",
    x: { label: "rows skipped", log: true },
    y: { label: "execution time", log: true, unit: "ms" },
    series: [
      { name: "OFFSET", points: tail(offset) },
      { name: "keyset", points: tail(keyset) },
    ],
  };
}

/** The course's benchmark: a new connection per request against a pool. */
async function poolBench() {
  const db = await freshDb("postgres");
  const admin = connect(db);
  await admin.connect();
  await admin.query("CREATE TABLE t (id int PRIMARY KEY, v text); INSERT INTO t SELECT g, 'row' FROM generate_series(1, 1000) g");
  const N = 1000;
  let start = process.hrtime.bigint();
  for (let i = 0; i < N; i++) {
    const c = connect(db);
    await c.connect();
    await c.query("SELECT v FROM t WHERE id = $1", [(i % 1000) + 1]);
    await c.end();
  }
  const fresh = Number(process.hrtime.bigint() - start) / 1e6 / N;
  const p = pool(db, 10);
  await p.query("SELECT 1");
  start = process.hrtime.bigint();
  for (let i = 0; i < N; i++) await p.query("SELECT v FROM t WHERE id = $1", [(i % 1000) + 1]);
  const pooled = Number(process.hrtime.bigint() - start) / 1e6 / N;
  await p.end();
  await admin.end();
  await dropDb("postgres", db);
  return {
    engine: await version("postgres"),
    blocks: [
      {
        cmd: "-- 1,000 lookups, one at a time",
        out: `new connection per request   ${fresh.toFixed(2)} ms each\nfrom a pool                  ${pooled.toFixed(2)} ms each`,
      },
    ],
  };
}

/** Requests arriving all at once against pools of different sizes. */
async function poolSizes() {
  const db = await freshDb("postgres");
  const admin = connect(db);
  await admin.connect();
  const throughput = [];
  const waits = [];
  for (const max of [1, 2, 5, 10, 20, 50]) {
    const p = pool(db, max);
    await Promise.all(Array.from({ length: max }, () => p.query("SELECT 1")));
    const latencies = [];
    const start = Date.now();
    await Promise.all(
      Array.from({ length: 200 }, async () => {
        const began = Date.now();
        await p.query("SELECT pg_sleep(0.02)");
        latencies.push(Date.now() - began);
      }),
    );
    const secs = (Date.now() - start) / 1000;
    latencies.sort((a, b) => a - b);
    throughput.push([max, Math.round(200 / secs)]);
    waits.push([max, latencies[Math.floor(latencies.length * 0.95)]]);
    await p.end();
  }
  await admin.end();
  await dropDb("postgres", db);
  return {
    engine: await version("postgres"),
    title: "200 requests at once, each query taking 20 ms",
    alt: "The time the slowest five percent of 200 simultaneous requests waited, for connection pools of 1 to 50 connections. With one connection requests queue for seconds. It falls as the pool grows, because each query here only sleeps on the server.",
    x: { label: "connections in the pool", log: true },
    y: { label: "95th percentile wait", log: true, unit: "ms" },
    series: [{ name: "p95 wait", points: waits }],
  };
}

/** The booking app's early return: a client taken from the pool and never given back. */
async function leak() {
  const db = await freshDb("postgres");
  const admin = connect(db);
  await admin.connect();
  await admin.query("CREATE TABLE seats (id int PRIMARY KEY, isbooked int)");
  await admin.query("INSERT INTO seats VALUES (1, 1)");
  const p = new pg.Pool({ host: "127.0.0.1", port: ENGINES.postgres.port, user: "postgres", password: "postgres", database: db, max: 2, connectionTimeoutMillis: 1500 });
  const leaked = [];
  const book = async () => {
    const conn = await p.connect();
    leaked.push(conn);
    await conn.query("BEGIN");
    const r = await conn.query("SELECT * FROM seats WHERE id = 1 AND isbooked = 0 FOR UPDATE");
    if (r.rowCount === 0) return "seat already booked"; // the bug: no ROLLBACK, no release
    conn.release();
    return "booked";
  };
  const lines = [];
  for (let i = 1; i <= 3; i++) {
    try {
      lines.push(`request ${i}: ${await book()}`);
    } catch (e) {
      lines.push(`request ${i}: ERROR ${e.message}`);
    }
  }
  const stuck = await admin.query("SELECT state, count(*)::int FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid() GROUP BY state");
  const out = `${lines.join("\n")}\n\npg_stat_activity: ${stuck.rows.map((r) => `${r.count} ${r.state}`).join(", ")}`;
  await admin.end();
  leaked.forEach((conn) => conn.release(true)); // pool.end() would wait for these forever
  await p.end();
  await dropDb("postgres", db);
  return {
    engine: await version("postgres"),
    blocks: [{ cmd: "-- three requests for a taken seat, through a pool of 2, with an early return that skips release()", out }],
  };
}

const spec = {
  theaters: {
    "shared-lock": {
      title: "Who waits for a shared lock?",
      alt: "A recorded run on PostgreSQL. Session A takes a shared row lock. Session B can still read the row normally and take its own shared lock, but its update waits until session A commits.",
      sessions: ["A", "B"],
      tableName: "accounts",
      setup: ["CREATE TABLE accounts (id int PRIMARY KEY, balance int)", "INSERT INTO accounts VALUES (1, 100)"],
      observe: "SELECT id, balance FROM accounts",
      steps: [
        ["A", "BEGIN", "Session A wants a stable value while it works."],
        ["A", "SELECT balance FROM accounts WHERE id = 1 FOR SHARE", "A takes a shared lock on the row."],
        ["B", "SELECT balance FROM accounts WHERE id = 1", "A plain read takes no lock at all, so nothing stops it."],
        ["B", "BEGIN", "Session B opens a transaction."],
        ["B", "SELECT balance FROM accounts WHERE id = 1 FOR SHARE", "Two shared locks can coexist. That's what shared means."],
        ["B", "ROLLBACK", "B lets its lock go."],
        ["B", "UPDATE accounts SET balance = 50 WHERE id = 1", "A write needs an exclusive lock, which conflicts with A's shared lock. B waits. It doesn't get an error."],
        ["A", "COMMIT", "A finishes and the write goes through."],
      ],
    },

    deadlock: {
      title: "Who dies in a deadlock?",
      alt: "A recorded run on PostgreSQL with two tabs. Two sessions each hold a row the other wants. If the second session blocks more than a second after the first, it is the one aborted. If it blocks within the first second, the first session is aborted instead, so the victim depends on timing, not on who came last.",
      sessions: ["A", "B"],
      tableName: "test",
      setup: ["CREATE TABLE test (pk int PRIMARY KEY)"],
      observe: "SELECT pk FROM test ORDER BY pk",
      variants: [
        {
          label: "B closes the loop late",
          summary: "B closed the cycle and died. A's own check had already run, a second after A began waiting, and found no cycle then, so it was B's check that found it.",
          steps: [
            ["A", "BEGIN", "Two sessions, each about to take a row."],
            ["B", "BEGIN", "B starts too."],
            ["A", "INSERT INTO test VALUES (20)", "A holds 20."],
            ["B", "INSERT INTO test VALUES (21)", "B holds 21."],
            ["A", "INSERT INTO test VALUES (21)", "A wants 21 and waits for B. After one second (deadlock_timeout), A's backend checks for a cycle, finds none, and keeps waiting.", { wait: 1500 }],
            ["B", "INSERT INTO test VALUES (20)", "Now B wants 20, held by A. Each waits for the other. One second later B's check finds the cycle and aborts B.", { wait: 1600 }],
            ["A", "COMMIT", "A's insert of 21 went through when B died, so A can commit both rows."],
          ],
        },
        {
          label: "B closes the loop early",
          summary: "A entered the wait first and still died, because its one-second check fired after the cycle existed. The rule isn't that the last one in fails: it's whoever's check runs first once the cycle exists.",
          steps: [
            ["A", "BEGIN", "The same steps, closer together."],
            ["B", "BEGIN", "B starts too."],
            ["A", "INSERT INTO test VALUES (20)", "A holds 20."],
            ["B", "INSERT INTO test VALUES (21)", "B holds 21."],
            ["A", "INSERT INTO test VALUES (21)", "A wants 21 and waits, and its one-second timer starts.", { wait: 150, settle: 0 }],
            ["B", "INSERT INTO test VALUES (20)", "B closes the cycle within the second, so A's timer fires first and finds it.", { wait: 1600 }],
            ["B", "COMMIT", "This time B survives."],
          ],
        },
      ],
    },

    "duplicate-wait": {
      title: "Waiting on someone else's uncommitted key",
      alt: "A recorded run on PostgreSQL with two tabs. Session A inserts a key without committing. Session B inserts the same key and waits, because the outcome depends on A. If A rolls back, B's insert succeeds. If A commits, B fails with a duplicate key error.",
      sessions: ["A", "B"],
      tableName: "test",
      setup: ["CREATE TABLE test (pk int PRIMARY KEY)"],
      observe: "SELECT pk FROM test ORDER BY pk",
      variants: [
        { label: "A rolls back", vars: { end: "ROLLBACK" }, summary: "B's insert succeeded: the key turned out to be free." },
        { label: "A commits", vars: { end: "COMMIT" }, summary: "B got a duplicate key error, as soon as A's fate was known." },
      ],
      steps: [
        ["A", "BEGIN", "A opens a transaction."],
        ["A", "INSERT INTO test VALUES (1)", "A inserts key 1, uncommitted."],
        ["B", "INSERT INTO test VALUES (1)", "B can't know yet if this key is taken, so it waits for A's outcome."],
        ["A", "{end}", "A ends with {end}, and B's statement returns."],
      ],
    },

    "double-booking": {
      title: "Two people book the same seat",
      alt: "A recorded run on PostgreSQL with one tab per approach. Without locks both sessions see the seat free and both book it, and the last write wins. With SELECT FOR UPDATE the second session waits and then sees the seat taken. An UPDATE with the condition in its WHERE clause also works at read committed. At repeatable read the same UPDATE fails with a serialization error.",
      sessions: ["Ana", "Ben"],
      tableName: "seats",
      setup: SEATS,
      observe: SEAT_VIEW,
      variants: [
        {
          label: "No lock",
          summary: "Both were told they had seat 1. The table shows only Ben, so Ana has a booking confirmation for a seat she doesn't have.",
          steps: [
            ["Ana", "BEGIN", "Ana opens the booking page."],
            ["Ben", "BEGIN", "So does Ben."],
            ["Ana", "SELECT * FROM seats WHERE id = 1 AND isbooked = 0", "Seat 1 looks free."],
            ["Ben", "SELECT * FROM seats WHERE id = 1 AND isbooked = 0", "Ben sees it free as well. Plain reads don't block."],
            ["Ana", "UPDATE seats SET isbooked = 1, name = 'Ana' WHERE id = 1", "Ana books it, and holds the row lock."],
            ["Ben", "UPDATE seats SET isbooked = 1, name = 'Ben' WHERE id = 1", "Ben's update waits for Ana."],
            ["Ana", "COMMIT", "Ana is told she has the seat."],
            ["Ben", "COMMIT", "Ben's update overwrote hers, and he's told the same thing."],
          ],
        },
        {
          label: "SELECT FOR UPDATE",
          summary: "Ben waited, and then found the seat taken. The application told him so.",
          steps: [
            ["Ana", "BEGIN", "The same flow, locking on the read."],
            ["Ben", "BEGIN", "Ben starts too."],
            ["Ana", "SELECT * FROM seats WHERE id = 1 AND isbooked = 0 FOR UPDATE", "Ana gets the seat and an exclusive lock on it."],
            ["Ben", "SELECT * FROM seats WHERE id = 1 AND isbooked = 0 FOR UPDATE", "Ben's locking read waits for Ana."],
            ["Ana", "UPDATE seats SET isbooked = 1, name = 'Ana' WHERE id = 1", "Ana books."],
            ["Ana", "COMMIT", "When Ana commits, Ben's query re-checks the row, sees isbooked = 1, and returns no rows."],
            ["Ben", "ROLLBACK", "No rows came back, so the application tells Ben the seat is gone."],
          ],
        },
        {
          label: "UPDATE with the check",
          summary: "UPDATE 0 tells Ben he lost. It worked at read committed, because the waiting UPDATE re-evaluated its WHERE clause on the new row.",
          steps: [
            ["Ana", "BEGIN", "One statement does both the check and the write."],
            ["Ben", "BEGIN", "Ben starts too."],
            ["Ana", "UPDATE seats SET isbooked = 1, name = 'Ana' WHERE id = 1 AND isbooked = 0", "Ana's update matches, so she holds the row."],
            ["Ben", "UPDATE seats SET isbooked = 1, name = 'Ben' WHERE id = 1 AND isbooked = 0", "Ben's update waits."],
            ["Ana", "COMMIT", "Postgres re-checks Ben's WHERE clause against Ana's new row version. It no longer matches, so he gets UPDATE 0."],
            ["Ben", "COMMIT", "The application reads the count of 0 and tells Ben the seat is gone."],
          ],
        },
        {
          label: "The same at repeatable read",
          summary: "The same statement behaves differently at a stricter level: it fails rather than re-checking, so the code must catch the error.",
          steps: [
            ["Ana", "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ", "The same statement at a stricter level."],
            ["Ben", "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ", "Ben starts too."],
            ["Ana", "UPDATE seats SET isbooked = 1, name = 'Ana' WHERE id = 1 AND isbooked = 0", "Ana's update matches."],
            ["Ben", "UPDATE seats SET isbooked = 1, name = 'Ben' WHERE id = 1 AND isbooked = 0", "Ben's update waits."],
            ["Ana", "COMMIT", "Ben can't re-check at this level, because his snapshot is fixed. He gets a serialization error."],
            ["Ben", "ROLLBACK", "The seat is safe either way."],
          ],
        },
      ],
      steps: [],
    },

    "no-waiting": {
      title: "Three ways not to wait",
      alt: "A recorded run on PostgreSQL. Session A locks seat 1. Session B tries three options: lock_timeout gives up after 200 milliseconds with an error, NOWAIT fails at once, and SKIP LOCKED returns the next free seat instead.",
      sessions: ["A", "B"],
      tableName: "seats",
      setup: SEATS,
      steps: [
        ["A", "BEGIN", "Session A is halfway through booking."],
        ["A", "SELECT * FROM seats WHERE id = 1 FOR UPDATE", "A holds seat 1."],
        ["B", "SET lock_timeout = '200ms'", "Option one: give up after a while."],
        ["B", "SELECT * FROM seats WHERE id = 1 FOR UPDATE", "After 200 ms the statement fails.", { wait: 700 }],
        ["B", "RESET lock_timeout", "Back to waiting by default."],
        ["B", "SELECT * FROM seats WHERE id = 1 FOR UPDATE NOWAIT", "Option two: fail at once."],
        ["B", "SELECT * FROM seats WHERE isbooked = 0 ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED", "Option three: take the next one nobody holds. This is how a job queue is built on a table."],
      ],
    },

    "duplicate-page": {
      title: "A row inserted between two pages",
      alt: "A recorded run on PostgreSQL. A reader fetches page one with OFFSET 0, a writer inserts a new top story, and the reader fetches page two with OFFSET 3. The last story of page one appears again at the top of page two.",
      sessions: ["Reader", "Writer"],
      tableName: "news",
      setup: ["CREATE TABLE news (id serial PRIMARY KEY, title text)", "INSERT INTO news (title) SELECT 'story ' || g FROM generate_series(1, 10) g"],
      steps: [
        ["Reader", "SELECT id, title FROM news ORDER BY id DESC OFFSET 0 LIMIT 3", "Page one: stories 10, 9 and 8."],
        ["Writer", "INSERT INTO news (title) VALUES ('breaking story')", "A new story arrives at the top, and every row shifts down one place."],
        ["Reader", "SELECT id, title FROM news ORDER BY id DESC OFFSET 3 LIMIT 3", "Page two starts with story 8 again, because offsets count positions, not rows."],
        ["Reader", "SELECT id, title FROM news WHERE id < 8 ORDER BY id DESC LIMIT 3", "Keyset pagination asks for what comes after the last row seen, so the insert doesn't matter."],
      ],
    },
  },

  runs: {
    "lock-views": {
      setup: ["CREATE TABLE t (id int PRIMARY KEY, v int)", "INSERT INTO t VALUES (1, 1)"],
      sql: `BEGIN;
LOCK TABLE t IN ACCESS EXCLUSIVE MODE;
SELECT locktype, mode, granted FROM pg_locks WHERE relation = 't'::regclass;
ROLLBACK;`,
    },
    "pool-bench": poolBench,
    "leak": leak,
    "offset-plans": {
      setup: ["CREATE TABLE news (id serial PRIMARY KEY, title text)", "INSERT INTO news (title) SELECT 'story ' || g FROM generate_series(1, 2000000) g", "VACUUM ANALYZE news"],
      sql: `EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF, SUMMARY ON) SELECT id, title FROM news ORDER BY id DESC OFFSET 1000000 LIMIT 10;
EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF, SUMMARY ON) SELECT id, title FROM news WHERE id < 1000000 ORDER BY id DESC LIMIT 10;`,
    },
    "read-only": {
      setup: ["CREATE TABLE t (id int)"],
      sql: `BEGIN READ ONLY;
INSERT INTO t VALUES (1);
ROLLBACK;
BEGIN;
SELECT pg_current_xact_id_if_assigned() AS id_after_a_read;
SELECT count(*) FROM t;
SELECT pg_current_xact_id_if_assigned() AS id_still;
INSERT INTO t VALUES (1);
SELECT pg_current_xact_id_if_assigned() AS id_after_a_write;
COMMIT;`,
    },
  },

  charts: {
    pagination,
    "pool-sizes": poolSizes,
  },

  playgrounds: {
    paging: {
      title: "Offset or keyset?",
      hint: "200,000 stories. Compare the rows read in each plan, then try a deeper OFFSET.",
      setup: `CREATE TABLE news (id serial PRIMARY KEY, title text);
INSERT INTO news (title) SELECT 'story ' || g FROM generate_series(1, 200000) g;
VACUUM ANALYZE news;`,
      query: `EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF, SUMMARY ON)
SELECT id, title FROM news ORDER BY id DESC OFFSET 100000 LIMIT 10;`,
      presets: [
        { label: "Keyset at the same depth", sql: `EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF, SUMMARY ON)
SELECT id, title FROM news WHERE id < 100001 ORDER BY id DESC LIMIT 10;` },
        { label: "Both give the same rows", sql: `SELECT id FROM news ORDER BY id DESC OFFSET 100000 LIMIT 3;
SELECT id FROM news WHERE id < 100001 ORDER BY id DESC LIMIT 3;` },
      ],
    },
    locks: {
      title: "See your own locks",
      hint: "One session, so nothing can block here, but you can read what you hold. Compare what each statement takes in pg_locks.",
      setup: `CREATE TABLE t (id int PRIMARY KEY, v int);
INSERT INTO t VALUES (1, 1), (2, 2);`,
      query: `BEGIN;
SELECT * FROM t WHERE id = 1 FOR UPDATE;
SELECT locktype, mode, relation::regclass FROM pg_locks WHERE relation = 't'::regclass;
ROLLBACK;`,
      presets: [
        { label: "A plain SELECT", sql: `BEGIN;
SELECT * FROM t;
SELECT locktype, mode FROM pg_locks WHERE relation = 't'::regclass;
ROLLBACK;` },
        { label: "ALTER TABLE", sql: `BEGIN;
ALTER TABLE t ADD COLUMN w int;
SELECT locktype, mode FROM pg_locks WHERE relation = 't'::regclass;
ROLLBACK;` },
        { label: "The row lock lives in the row", sql: `BEGIN;
SELECT * FROM t WHERE id = 1 FOR UPDATE;
SELECT id, xmin, xmax FROM t;
ROLLBACK;` },
      ],
    },
  },
};

export default spec;
