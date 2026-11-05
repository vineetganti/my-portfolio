// Post 7: sharding. Three real Postgres servers, a real hash ring, and real data movement.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import pg from "pg";
import { docker, pause, version } from "../lab.mjs";

const PORTS = [55441, 55442, 55443];
const name = (i) => `dbe-shard${i + 1}`;

const client = (port) => {
  const c = new pg.Client({ host: "127.0.0.1", port, user: "postgres", password: "postgres", database: "postgres" });
  c.on("error", () => {});
  return c;
};

async function up() {
  for (let i = 0; i < PORTS.length; i++) {
    spawnSync("docker", ["rm", "-f", name(i)]);
    docker("run", "-d", "--name", name(i), "-p", `${PORTS[i]}:5432`, "-e", "POSTGRES_PASSWORD=postgres", "postgres:18");
  }
  for (const port of PORTS) {
    for (let i = 0; i < 90; i++) {
      const c = client(port);
      try {
        await c.connect();
        await c.end();
        break;
      } catch {
        await c.end().catch(() => {});
        await pause(500);
      }
    }
  }
}

const down = () => PORTS.forEach((_, i) => spawnSync("docker", ["rm", "-f", name(i)]));

const md5int = (s) => parseInt(createHash("md5").update(s).digest("hex").slice(0, 8), 16);

function ring(nodes, vnodes = 64) {
  const points = nodes.flatMap((n) => Array.from({ length: vnodes }, (_, v) => [md5int(`${n}#${v}`), n])).sort((a, b) => a[0] - b[0]);
  return (key) => {
    const h = md5int(key);
    let lo = 0;
    let hi = points.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (points[mid][0] < h) lo = mid + 1;
      else hi = mid;
    }
    return points[lo % points.length][1];
  };
}

const shortCode = (url) => createHash("sha256").update(url).digest("base64url").slice(0, 5);

/** The course's URL shortener on three real servers. */
async function shortener() {
  await up();
  const clients = PORTS.map(client);
  await Promise.all(clients.map((c) => c.connect()));
  await Promise.all(clients.map((c) => c.query("CREATE TABLE url_table (id serial PRIMARY KEY, url text, url_id char(5) UNIQUE)")));
  const pick = ring(PORTS);
  const urls = Array.from({ length: 10000 }, (_, i) => `https://example.com/page/${i}`);
  for (const url of urls) {
    const code = shortCode(url);
    await clients[PORTS.indexOf(pick(code))].query("INSERT INTO url_table (url, url_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [url, code]);
  }
  const counts = [];
  for (let i = 0; i < PORTS.length; i++) counts.push((await clients[i].query("SELECT count(*)::int AS n FROM url_table")).rows[0].n);

  // Read path: the same ring finds the same server.
  const code = shortCode(urls[1234]);
  const port = pick(code);
  const hit = (await clients[PORTS.indexOf(port)].query("SELECT url, url_id FROM url_table WHERE url_id = $1", [code])).rows[0];
  const wrong = PORTS.find((p) => p !== port);
  const miss = (await clients[PORTS.indexOf(wrong)].query("SELECT count(*)::int AS n FROM url_table WHERE url_id = $1", [code])).rows[0].n;

  // A query that doesn't use the shard key has to ask everyone.
  const start = process.hrtime.bigint();
  const found = await Promise.all(clients.map((c) => c.query("SELECT count(*)::int AS n FROM url_table WHERE url LIKE '%/page/99%'")));
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  const total = found.reduce((n, r) => n + r.rows[0].n, 0);
  await Promise.all(clients.map((c) => c.end()));
  const out = {
    engine: await version("postgres"),
    blocks: [
      {
        cmd: "-- 10,000 URLs: sha256 -> first 5 characters -> hash ring -> INSERT on that server",
        out: PORTS.map((p, i) => `server on port ${p}: ${counts[i]} rows`).join("\n"),
      },
      {
        cmd: `-- read path for code '${code}': the ring says port ${port}`,
        out: `port ${port}: ${hit.url}\nport ${wrong} (the wrong server): ${miss} rows`,
      },
      {
        cmd: "-- not by shard key: SELECT count(*) ... WHERE url LIKE '%/page/99%'",
        out: `had to ask all ${PORTS.length} servers and add up: ${found.map((r) => r.rows[0].n).join(" + ")} = ${total}, in ${ms.toFixed(1)} ms`,
      },
    ],
  };
  return out;
}

/** A transfer across two servers, where the second dies between the two commits. */
async function halfTransfer() {
  await up();
  const [a, b] = [client(PORTS[0]), client(PORTS[1])];
  await a.connect();
  await b.connect();
  await a.query("CREATE TABLE accounts (id int PRIMARY KEY, balance int); INSERT INTO accounts VALUES (1, 500)");
  await b.query("CREATE TABLE accounts (id int PRIMARY KEY, balance int); INSERT INTO accounts VALUES (2, 100)");
  await a.query("BEGIN");
  await a.query("UPDATE accounts SET balance = balance - 100 WHERE id = 1");
  await b.query("BEGIN");
  await b.query("UPDATE accounts SET balance = balance + 100 WHERE id = 2");
  await a.query("COMMIT");
  spawnSync("docker", ["kill", "-s", "KILL", name(1)]);
  let error = "";
  await b.query("COMMIT").catch((e) => (error = e.message));
  docker("start", name(1));
  await pause(1500);
  let c;
  for (let i = 0; i < 60; i++) {
    c = client(PORTS[1]);
    try {
      await c.connect();
      break;
    } catch {
      await pause(500);
    }
  }
  const left = (await a.query("SELECT balance FROM accounts WHERE id = 1")).rows[0].balance;
  const right = (await c.query("SELECT balance FROM accounts WHERE id = 2")).rows[0].balance;
  await a.end();
  await c.end();
  await b.end().catch(() => {});
  down();
  return {
    engine: await version("postgres"),
    blocks: [
      {
        cmd: "-- shard 1\nBEGIN; UPDATE accounts SET balance = balance - 100 WHERE id = 1;\n-- shard 2\nBEGIN; UPDATE accounts SET balance = balance + 100 WHERE id = 2;\n-- shard 1\nCOMMIT;\n-- shard 2 dies before its COMMIT\n$ docker kill -s KILL shard2",
        out: `COMMIT on shard 2 failed: ${error || "connection lost"}`,
      },
      { cmd: "-- after shard 2 restarts", out: `account 1 on shard 1: ${left}\naccount 2 on shard 2: ${right}\ntotal: ${left + right}, and it started at 600` },
    ],
  };
}

const KEYS = Array.from({ length: 100000 }, (_, i) => `key-${i}`);

async function movement() {
  const modulo = [];
  const consistent = [];
  for (const n of [2, 3, 4, 5, 6, 8, 10, 16]) {
    const servers = Array.from({ length: n + 1 }, (_, i) => `server-${i}`);
    const before = ring(servers.slice(0, n), 128);
    const after = ring(servers, 128);
    let ringMoved = 0;
    let modMoved = 0;
    for (const k of KEYS) {
      if (before(k) !== after(k)) ringMoved++;
      const h = md5int(k);
      if (h % n !== h % (n + 1)) modMoved++;
    }
    modulo.push([n, +((modMoved / KEYS.length) * 100).toFixed(1)]);
    consistent.push([n, +((ringMoved / KEYS.length) * 100).toFixed(1)]);
  }
  return {
    engine: "100,000 real keys, computed",
    title: "Keys that must move when you add one server",
    alt: "The share of 100,000 keys that change server when one server is added, for clusters of 2 to 16 servers. With hash modulo N the share stays between 66 and 94 percent. With a hash ring it falls to one share in N plus 1.",
    x: { label: "servers before adding one" },
    y: { label: "% of keys moved" },
    series: [
      { name: "hash % N", points: modulo },
      { name: "hash ring", points: consistent },
    ],
  };
}

async function evenness() {
  const points = [];
  for (const v of [1, 2, 4, 8, 16, 32, 64, 128, 256]) {
    const pick = ring(["a", "b", "c", "d", "e"], v);
    const load = {};
    for (const k of KEYS) load[pick(k)] = (load[pick(k)] ?? 0) + 1;
    const counts = ["a", "b", "c", "d", "e"].map((s) => load[s] ?? 0);
    points.push([v, +((Math.max(...counts) / (KEYS.length / 5)) * 100 - 100).toFixed(1)]);
  }
  return {
    engine: "100,000 real keys, computed",
    title: "How uneven is a ring of five servers?",
    alt: "How far above its fair share the busiest of five servers is, as the number of points each server has on the ring grows from 1 to 256. With one point the busiest server holds far more than its share, and with hundreds of points it's close to fair.",
    x: { label: "points per server on the ring", log: true },
    y: { label: "busiest server above fair share", unit: "%" },
    series: [{ name: "busiest server", points }],
  };
}

const spec = {
  runs: {
    shortener,
    "half-transfer": halfTransfer,
  },
  charts: {
    movement,
    evenness,
  },
  playgrounds: {
    "shard-routing": {
      title: "Hashing a key to a server, in SQL",
      hint: "One Postgres can't be three servers, but the arithmetic is the same. Try changing the 3 to a 4 and see how many keys get a new server.",
      setup: `CREATE TABLE keys AS SELECT 'key-' || g AS k FROM generate_series(1, 10000) g;`,
      query: `SELECT abs(hashtext(k)) % 3 AS server, count(*)
FROM keys GROUP BY 1 ORDER BY 1;`,
      presets: [
        { label: "Keys that move, 3 to 4", sql: `SELECT count(*) FILTER (WHERE abs(hashtext(k)) % 3 <> abs(hashtext(k)) % 4) AS moved, count(*) AS total
FROM keys;` },
        { label: "Postgres hash partitions", sql: `CREATE TABLE IF NOT EXISTS h (k text) PARTITION BY HASH (k);
CREATE TABLE IF NOT EXISTS h0 PARTITION OF h FOR VALUES WITH (MODULUS 3, REMAINDER 0);
CREATE TABLE IF NOT EXISTS h1 PARTITION OF h FOR VALUES WITH (MODULUS 3, REMAINDER 1);
CREATE TABLE IF NOT EXISTS h2 PARTITION OF h FOR VALUES WITH (MODULUS 3, REMAINDER 2);
TRUNCATE h;
INSERT INTO h SELECT k FROM keys;
SELECT tableoid::regclass, count(*) FROM h GROUP BY 1 ORDER BY 1;` },
      ],
    },
  },
};

export default spec;
