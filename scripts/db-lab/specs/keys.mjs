// Post 4: Bloom filters, billion-row tables, and the keys that hurt.
import { dropDb, freshDb, session, version } from "../lab.mjs";

const fmt = (n) => Number(n);

/** A popular user's follower list as one JSON array: what does each new follower cost? */
async function jsonFollowers() {
  const db = await freshDb("postgres");
  const s = await session("postgres").open(db);
  await s.run("CREATE TABLE profile (id int PRIMARY KEY, followers_count int, followers jsonb)");
  await s.run("CREATE TABLE follows (follower int, followee int)");
  await s.run("CREATE INDEX ON follows (followee, follower)");
  const time = [];
  const wal = [];
  for (const size of [1000, 10000, 100000, 1000000]) {
    await s.run("TRUNCATE profile");
    await s.run(`INSERT INTO profile SELECT 1, ${size}, jsonb_agg(g) FROM generate_series(1, ${size}) g`);
    await s.run(`TRUNCATE follows`);
    await s.run(`INSERT INTO follows SELECT g, 1 FROM generate_series(1, ${size}) g`);
    const measure = async (sql) => {
      const before = (await s.run("SELECT pg_current_wal_insert_lsn()")).rows[0][0];
      const start = process.hrtime.bigint();
      const n = 20;
      for (let i = 0; i < n; i++) await s.run(sql.replace("$i", String(size + 1 + i)));
      const ms = Number(process.hrtime.bigint() - start) / 1e6 / n;
      const bytes = (await s.run(`SELECT (pg_current_wal_insert_lsn() - '${before}'::pg_lsn)::bigint`)).rows[0][0];
      return { ms, bytes: fmt(bytes) / n };
    };
    const list = await measure("UPDATE profile SET followers = followers || '$i'::jsonb, followers_count = followers_count + 1 WHERE id = 1");
    const row = await measure("INSERT INTO follows VALUES ($i + 1000000, 1)");
    time.push([size, +list.ms.toFixed(2), +row.ms.toFixed(2)]);
    wal.push([size, Math.round(list.bytes / 1024), Math.round(row.bytes / 1024)]);
  }
  await s.close();
  await dropDb("postgres", db);
  const engine = await version("postgres");
  const pick = (rows, i) => rows.map((r) => [r[0], r[i]]);
  return {
    time: {
      engine,
      title: "The cost of one new follower",
      alt: "Time to record one new follower as a user's follower count grows from a thousand to a million. Inserting a row into a follows table stays flat at under a millisecond. Appending to a JSON array on the profile row grows with the size of the list, because the whole row is rewritten.",
      x: { label: "followers already", log: true },
      y: { label: "ms per follow", log: true, unit: "ms" },
      series: [
        { name: "JSON list", points: pick(time, 1) },
        { name: "follows table", points: pick(time, 2) },
      ],
    },
    wal: { size: wal },
  };
}

let followers;
const followerCost = () => (followers ??= jsonFollowers());

/** Inserts rows in batches, with each kind of primary key, into one engine. */
async function raceEngine(engine, kinds, makeTable, insert, rows, batch, extra) {
  const series = [];
  const details = [];
  for (const [name, key] of Object.entries(kinds)) {
    const db = await freshDb(engine);
    const s = await session(engine).open(db);
    await makeTable(s, key);
    const points = [];
    let done = 0;
    const wal0 = engine === "postgres" ? (await s.run("SELECT pg_current_wal_insert_lsn()")).rows[0][0] : null;
    while (done < rows) {
      const start = process.hrtime.bigint();
      await insert(s, key, done, batch);
      const secs = Number(process.hrtime.bigint() - start) / 1e9;
      done += batch;
      points.push([done, Math.round(batch / secs)]);
      console.log(`    ${engine} ${name} ${done}: ${Math.round(batch / secs)} rows/s`);
    }
    series.push({ name, points });
    details.push({ name, ...(await extra(s, wal0)) });
    await s.close();
    await dropDb(engine, db);
  }
  return { series, details };
}

async function racePostgres() {
  const kinds = {
    bigint: "nextval('seq')",
    "UUIDv7": "uuidv7()",
    "UUIDv4": "gen_random_uuid()",
  };
  const r = await raceEngine(
    "postgres",
    kinds,
    async (s, key) => {
      await s.run("CREATE EXTENSION pgstattuple");
      await s.run("CREATE SEQUENCE seq");
      await s.run(`CREATE TABLE t (id ${key.startsWith("nextval") ? "bigint" : "uuid"} PRIMARY KEY DEFAULT ${key}, pad text) WITH (autovacuum_enabled = off)`);
    },
    (s, key, done, batch) => s.run(`INSERT INTO t (pad) SELECT repeat('p', 60) FROM generate_series(1, ${batch})`),
    3000000,
    250000,
    async (s, wal0) => {
      const idx = await s.run("SELECT leaf_pages, avg_leaf_density FROM pgstatindex('t_pkey')");
      const size = await s.run("SELECT pg_size_pretty(pg_relation_size('t_pkey'))");
      const wal = await s.run(`SELECT pg_size_pretty(pg_current_wal_insert_lsn() - '${wal0}'::pg_lsn)`);
      return { leafPages: idx.rows[0][0], density: idx.rows[0][1], indexSize: size.rows[0][0], wal: wal.rows[0][0] };
    },
  );
  return r;
}

async function raceMysql() {
  // Binary(16) keys: 16 random bytes, or an 8-byte counter followed by 8 random bytes, which orders
  // like a UUIDv7. A generated numbers table keeps the client out of the measurement.
  const kinds = {
    bigint: "bigint",
    "ordered 16 bytes": "ordered",
    "random 16 bytes": "random",
  };
  const r = await raceEngine(
    "mysql",
    kinds,
    async (s, key) => {
      await s.run("CREATE TABLE nums (n int PRIMARY KEY)");
      await s.run("INSERT INTO nums WITH RECURSIVE g(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM g WHERE n < 1000) SELECT n FROM g");
      await s.run("SET SESSION cte_max_recursion_depth = 1000000");
      await s.run(`CREATE TABLE t (id ${key === "bigint" ? "bigint AUTO_INCREMENT" : "binary(16)"} PRIMARY KEY, pad varchar(100))`);
    },
    async (s, key, done, batch) => {
      const value =
        key === "bigint"
          ? ""
          : key === "ordered"
            ? `unhex(concat(lpad(hex(${done} + (a.n - 1) * 1000 + b.n), 16, '0'), lpad(hex(floor(rand() * 4294967295)), 16, '0'))),`
            : `unhex(md5(concat(rand(), ${done}, a.n, b.n))),`;
      const cols = key === "bigint" ? "(pad)" : "(id, pad)";
      await s.run(`INSERT INTO t ${cols} SELECT ${value} repeat('p', 60) FROM nums a JOIN nums b WHERE a.n <= ${batch / 1000}`);
    },
    2000000,
    200000,
    async (s) => {
      const size = await s.run("SELECT round(data_length / 1048576) AS mb, round(data_free / 1048576) AS free_mb FROM information_schema.tables WHERE table_schema = database() AND table_name = 't'");
      return { sizeMb: size.rows[0][0] };
    },
  );
  return r;
}

let pgRace;
let myRace;
const racePg = () => (pgRace ??= racePostgres());
const raceMy = () => (myRace ??= raceMysql());

const INSERT_RACE = {
  x: { label: "rows already in the table" },
  y: { label: "rows inserted per second", unit: "rows/s" },
};

const spec = {
  theaters: {
    idempotency: {
      title: "The same payment, sent twice",
      alt: "A recorded run on PostgreSQL. Two sessions send the same payment with one idempotency key, as a retry would. The second insert waits for the first to commit, then inserts nothing, so the customer is charged once.",
      sessions: ["First try", "Retry"],
      tableName: "payments",
      setup: ["CREATE TABLE payments (idempotency_key uuid PRIMARY KEY, amount int)"],
      observe: "SELECT count(*) AS rows, sum(amount) AS charged FROM payments",
      steps: [
        ["First try", "BEGIN", "A client sends a payment, with a key it generated."],
        ["First try", "INSERT INTO payments VALUES ('019a0000-0000-7000-8000-000000000001', 100) ON CONFLICT DO NOTHING", "The row is in, but not committed yet."],
        ["Retry", "INSERT INTO payments VALUES ('019a0000-0000-7000-8000-000000000001', 100) ON CONFLICT DO NOTHING", "The client timed out and retried with the same key. The database can't tell yet whether the first try will commit, so it waits."],
        ["First try", "COMMIT", "The first try commits. The retry's insert returns having inserted nothing."],
      ],
    },
  },

  runs: {
    "redis-bloom": {
      engine: "redis",
      sql: `BF.RESERVE usernames 0.01 1000
BF.ADD usernames jack
BF.ADD usernames paul
BF.EXISTS usernames jack
BF.EXISTS usernames sara
BF.INFO usernames`,
    },
    "uuid-shapes": {
      sql: `SELECT gen_random_uuid() AS uuid_v4 FROM generate_series(1, 3);
SELECT uuidv7() AS uuid_v7 FROM generate_series(1, 3);
SELECT uuid_extract_version(uuidv7()) AS version, uuid_extract_timestamp(uuidv7()) AS made_at;`,
    },
    "race-postgres": async () => {
      const pg = await racePg();
      const line = (d) => `${d.name.padEnd(8)} index ${d.indexSize.padStart(7)}  leaf pages ${String(d.leafPages).padStart(6)}  ${String(d.density).padStart(5)}% full  WAL written ${d.wal}`;
      return {
        engine: await version("postgres"),
        blocks: [{ cmd: "-- after inserting 3,000,000 rows with each kind of key", out: pg.details.map(line).join("\n") }],
      };
    },
    "race-mysql": async () => {
      const my = await raceMy();
      const line = (d) => `${d.name.padEnd(17)} table on disk ${d.sizeMb} MB`;
      return {
        engine: await version("mysql"),
        blocks: [{ cmd: "-- after inserting 2,000,000 rows with each kind of key", out: my.details.map(line).join("\n") }],
      };
    },
  },

  charts: {
    "follower-cost": async () => (await followerCost()).time,
    "race-postgres": async () => {
      const pg = await racePg();
      return {
        engine: await version("postgres"),
        title: "Insert speed by primary key: Postgres",
        alt: "Rows inserted per second into a Postgres table with three kinds of primary key, as the table grows to three million rows. Sequential integers and UUIDv7 keep their speed. Random UUIDv4 falls behind as the index outgrows memory.",
        ...INSERT_RACE,
        series: pg.series,
      };
    },
    "race-mysql": async () => {
      const my = await raceMy();
      return {
        engine: await version("mysql"),
        title: "Insert speed by primary key: InnoDB",
        alt: "Rows inserted per second into an InnoDB table with three kinds of primary key, as the table grows to two million rows. Because the table is stored in primary key order, random keys fall far behind, while ordered keys hold their speed.",
        ...INSERT_RACE,
        series: my.series,
      };
    },
  },

  data: {
    "follower-wal": async () => (await followerCost()).wal,
  },

  playgrounds: {
    "bloom-index": {
      title: "Postgres has a Bloom index too",
      hint: "One signature per row, from any of the indexed columns. It answers equality on any combination of them, and false positives are rechecked against the table.",
      setup: `CREATE TABLE products (id int, color int, size int, brand int);
INSERT INTO products SELECT g, (random() * 50)::int, (random() * 50)::int, (random() * 50)::int FROM generate_series(1, 50000) g;
CREATE INDEX products_bloom ON products USING bloom (color, size, brand);
VACUUM ANALYZE products;`,
      query: `EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF, SUMMARY OFF)
SELECT * FROM products WHERE size = 7 AND brand = 12;`,
      presets: [
        { label: "Compare sizes", sql: `SELECT pg_size_pretty(pg_relation_size('products')) AS table_size,
       pg_size_pretty(pg_relation_size('products_bloom')) AS bloom_index;` },
        { label: "A btree of the same columns", sql: `CREATE INDEX IF NOT EXISTS products_btree ON products (color, size, brand);
SELECT pg_size_pretty(pg_relation_size('products_bloom')) AS bloom,
       pg_size_pretty(pg_relation_size('products_btree')) AS btree;` },
      ],
    },
    uuids: {
      title: "Random keys, ordered keys",
      hint: "Sort these by value. A UUIDv7 sorts in creation order, and a UUIDv4 doesn't.",
      setup: `CREATE TABLE ids (n int, v4 uuid DEFAULT gen_random_uuid(), v7 uuid DEFAULT uuidv7());
INSERT INTO ids (n) SELECT generate_series(1, 10);`,
      query: `SELECT n, v7 FROM ids ORDER BY v7;`,
      presets: [
        { label: "Sort the v4 column", sql: "SELECT n, v4 FROM ids ORDER BY v4;" },
        { label: "When was it made?", sql: "SELECT n, uuid_extract_timestamp(v7) AS made_at FROM ids ORDER BY v7 LIMIT 3;" },
      ],
    },
  },
};

export default spec;
