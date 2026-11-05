// Post 12: MongoDB, Memcached and Redis, all run for real.
import { spawnSync } from "node:child_process";
import net from "node:net";
import { docker, ENGINES, inContainer, pause, start, version } from "../lab.mjs";

// ---------------------------------------------------------------- Memcached

/** A tiny text-protocol client over a real socket. */
class Mem {
  constructor(port) {
    this.port = port;
  }
  async open() {
    this.s = net.connect(this.port, "127.0.0.1");
    this.s.setEncoding("latin1");
    this.buffer = "";
    this.s.on("data", (d) => (this.buffer += d));
    this.s.on("error", () => {});
    await new Promise((r, no) => {
      this.s.once("connect", r);
      this.s.once("error", no);
    });
    return this;
  }
  async ask(text, until) {
    this.buffer = "";
    this.s.write(text);
    for (let i = 0; i < 4000; i++) {
      if (until.test(this.buffer)) break;
      await pause(1);
    }
    return this.buffer.replace(/\r/g, "").trimEnd();
  }
  set(key, value, ttl = 0) {
    return this.ask(`set ${key} 0 ${ttl} ${value.length}\r\n${value}\r\n`, /\r\n$/);
  }
  get(key) {
    return this.ask(`get ${key}\r\n`, /END\r\n$/);
  }
  stats(kind = "") {
    return this.ask(`stats ${kind}\r\n`, /END\r\n$/);
  }
  close() {
    this.s.destroy();
  }
}

const parseStats = (text) => Object.fromEntries(text.split("\n").filter((l) => l.startsWith("STAT")).map((l) => l.split(" ").slice(1, 3)));

async function memcachedSlabs() {
  const name = "dbe-mem-slabs";
  const port = 51212;
  spawnSync("docker", ["rm", "-f", name]);
  docker("run", "-d", "--name", name, "-p", `${port}:11211`, "memcached:1.6", "-m", "64");
  await pause(800);
  const m = await new Mem(port).open();
  // Three sizes of value, to land in three slab classes.
  for (const [size, n] of [[100, 2000], [500, 2000], [5000, 2000]]) {
    const value = "x".repeat(size);
    for (let i = 0; i < n; i++) await m.set(`k${size}-${i}`, value);
  }
  const slabs = await m.stats("slabs");
  const stat = parseStats(slabs);
  const classes = [...new Set(Object.keys(stat).map((k) => k.split(":")[0]).filter((k) => /^\d+$/.test(k)))];
  const lines = classes.map((c) => {
    const size = Number(stat[`${c}:chunk_size`]);
    const used = Number(stat[`${c}:used_chunks`]);
    const perPage = Number(stat[`${c}:chunks_per_page`]);
    return `class ${String(c).padStart(2)}  chunk ${String(size).padStart(5)} bytes  ${String(perPage).padStart(5)} chunks per 1 MB page  ${used} in use`;
  });
  const tooLong = await m.ask(`get ${"k".repeat(251)}\r\n`, /\r\n$/);
  const tooBig = await m.ask(`set big 0 0 2000000\r\n${"x".repeat(2000000)}\r\n`, /\r\n$/);
  // Fill past the 64 MB limit and watch the LRU evict.
  const value = "y".repeat(5000);
  for (let i = 0; i < 16000; i++) await m.set(`fill-${i}`, value);
  const after = parseStats(await m.stats());
  const oldest = await m.get("fill-0");
  const newest = await m.get("fill-15999");
  m.close();
  spawnSync("docker", ["rm", "-f", name]);
  return {
    engine: await version("memcached"),
    blocks: [
      { cmd: "-- 2,000 values each of 100, 500 and 5,000 bytes, then:\nstats slabs", out: lines.join("\n") },
      { cmd: "get <a 251-character key>", out: tooLong.split("\n")[0] },
      { cmd: "set big 0 0 2000000   -- a 2 MB value", out: tooBig.split("\n")[0] },
      {
        cmd: "-- 16,000 more values of 5,000 bytes, about 80 MB, into a 64 MB cache",
        out: `evictions: ${after.evictions}\nget fill-0: ${oldest.includes("VALUE") ? "hit" : "miss, evicted"}\nget fill-15999: ${newest.includes("VALUE") ? "hit" : "miss"}`,
      },
    ],
  };
}

/** Three servers that never talk to each other: the client's hash picks one. */
async function memcachedPool() {
  const ports = [51221, 51222, 51223];
  const names = ports.map((_, i) => `dbe-mem${i + 1}`);
  names.forEach((n) => spawnSync("docker", ["rm", "-f", n]));
  ports.forEach((p, i) => docker("run", "-d", "--name", names[i], "-p", `${p}:11211`, "memcached:1.6"));
  await pause(800);
  const clients = await Promise.all(ports.map((p) => new Mem(p).open()));
  const hash = (k) => [...k].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7);
  const pick = (k) => hash(k) % 3;
  for (let i = 0; i < 3000; i++) await clients[pick(`key-${i}`)].set(`key-${i}`, "value");
  const counts = [];
  for (const c of clients) counts.push(parseStats(await c.stats()).curr_items);
  // One server dies: only its keys are lost.
  spawnSync("docker", ["kill", names[1]]);
  await pause(300);
  let hits = 0;
  let misses = 0;
  for (let i = 0; i < 3000; i++) {
    const server = pick(`key-${i}`);
    if (server === 1) {
      misses++;
      continue;
    }
    if ((await clients[server].get(`key-${i}`)).includes("VALUE")) hits++;
  }
  clients.forEach((c) => c.close());
  names.forEach((n) => spawnSync("docker", ["rm", "-f", n]));
  return {
    engine: await version("memcached"),
    blocks: [
      { cmd: "-- 3,000 keys, client-side hash over 3 servers", out: counts.map((n, i) => `server ${i + 1}: ${n} items`).join("\n") },
      { cmd: "$ docker kill server2\n-- read all 3,000 keys again", out: `hits: ${hits}\nlost with server 2: ${misses}\nthe other servers never noticed` },
    ],
  };
}

// ---------------------------------------------------------------- Redis

const resp = (...parts) => `*${parts.length}\r\n${parts.map((p) => `$${Buffer.byteLength(String(p))}\r\n${p}\r\n`).join("")}`;

class Red {
  constructor(port) {
    this.port = port;
  }
  async open() {
    this.s = net.connect(this.port, "127.0.0.1");
    this.s.setEncoding("utf8");
    this.buffer = "";
    this.s.on("data", (d) => (this.buffer += d));
    this.s.on("error", () => (this.dead = true));
    this.s.on("close", () => (this.dead = true));
    await new Promise((r, no) => {
      this.s.once("connect", r);
      this.s.once("error", no);
    });
    return this;
  }
  /** Sends one command and waits for one reply line. */
  async cmd(...parts) {
    this.buffer = "";
    this.s.write(resp(...parts));
    for (let i = 0; i < 20000; i++) {
      if (this.dead) throw new Error("gone");
      if (this.buffer.endsWith("\r\n")) return this.buffer.replace(/\r\n$/, "");
      await new Promise((r) => setImmediate(r));
    }
    throw new Error("timeout");
  }
  close() {
    this.s.destroy();
  }
}

async function ready(port) {
  for (let i = 0; i < 100; i++) {
    try {
      const r = await new Red(port).open();
      const pong = await r.cmd("PING");
      if (pong.includes("PONG")) return r;
      r.close();
    } catch {
      // not yet
    }
    await pause(200);
  }
  throw new Error("redis did not start");
}

async function redisDurability() {
  const name = "dbe-redis-crash";
  const port = 56380;
  const modes = [
    ["no persistence", ["--save", "", "--appendonly", "no"]],
    ["RDB snapshot only", ["--save", "1 1", "--appendonly", "no"]],
    ["AOF, fsync every second", ["--save", "", "--appendonly", "yes", "--appendfsync", "everysec"]],
    ["AOF, fsync always", ["--save", "", "--appendonly", "yes", "--appendfsync", "always"]],
  ];
  const lines = [];
  for (const [label, flags] of modes) {
    spawnSync("docker", ["rm", "-f", name]);
    docker("run", "-d", "--name", name, "-p", `${port}:6379`, "redis:8.0", "redis-server", ...flags);
    const r = await ready(port);
    let acked = 0;
    const started = Date.now();
    const killer = pause(3200).then(() => spawnSync("docker", ["kill", "-s", "KILL", name]));
    try {
      for (;;) {
        await r.cmd("SET", `key:${acked}`, "value");
        acked++;
      }
    } catch {
      // the server died
    }
    const secs = (Date.now() - started) / 1000;
    await killer;
    r.close();
    docker("start", name);
    const back = await ready(port);
    const size = Number((await back.cmd("DBSIZE")).replace(":", ""));
    back.close();
    lines.push(`${label.padEnd(25)} ${String(Math.round(acked / secs)).padStart(6)} writes/s   acknowledged ${String(acked).padStart(6)}   survived ${String(size).padStart(6)}   lost ${Math.max(0, acked - size)}`);
  }
  spawnSync("docker", ["rm", "-f", name]);
  return {
    engine: await version("redis"),
    blocks: [{ cmd: "-- one client sets keys in a loop for about 3 seconds, the server is killed, then restarted", out: lines.join("\n") }],
  };
}

async function redisWire() {
  await start("redis");
  const raw = resp("SET", "name", "ana");
  const r = await new Red(ENGINES.redis.port).open();
  const reply = await r.cmd("SET", "name", "ana");
  const got = await r.cmd("GET", "name");
  r.close();
  const show = (s) => s.replace(/\r\n/g, "\\r\\n");
  return {
    engine: await version("redis"),
    blocks: [
      { cmd: "-- SET name ana, as it goes over TCP", out: show(raw) },
      { cmd: "-- the reply", out: show(`${reply}\r\n`) },
      { cmd: "-- GET name, and its reply", out: `${show(resp("GET", "name"))}\n${show(`${got}\r\n`)}` },
    ],
  };
}

async function redisExpiry() {
  await start("redis");
  const r = await new Red(ENGINES.redis.port).open();
  await r.cmd("FLUSHALL");
  const set = await r.cmd("SET", "session:1", "ana", "EX", "2");
  const ttl = await r.cmd("TTL", "session:1");
  const before = await r.cmd("GET", "session:1");
  await pause(2300);
  const after = await r.cmd("GET", "session:1");
  const exists = await r.cmd("EXISTS", "session:1");
  r.close();
  return {
    engine: await version("redis"),
    blocks: [
      { cmd: "> SET session:1 ana EX 2", out: set },
      { cmd: "> TTL session:1", out: ttl },
      { cmd: "> GET session:1", out: before.split("\r\n").pop() },
      { cmd: "-- 2.3 seconds later\n> GET session:1", out: after === "$-1" ? "(nil)" : after },
      { cmd: "> EXISTS session:1", out: exists },
    ],
  };
}

async function redisPubSub() {
  await start("redis");
  const sub = await new Red(ENGINES.redis.port).open();
  const pub = await new Red(ENGINES.redis.port).open();
  await sub.cmd("SUBSCRIBE", "news");
  await pause(100);
  const late = await new Red(ENGINES.redis.port).open();
  sub.buffer = "";
  const delivered = await pub.cmd("PUBLISH", "news", "hello");
  await pause(100);
  const message = sub.buffer.split("\r\n").filter((l) => !/^[*$]/.test(l) && l).join(" ");
  await late.cmd("SUBSCRIBE", "news");
  late.buffer = "";
  await pause(100);
  const missed = late.buffer.length === 0;
  [sub, pub, late].forEach((c) => c.close());
  return {
    engine: await version("redis"),
    blocks: [
      { cmd: "-- connection 1\n> SUBSCRIBE news\n-- connection 2\n> PUBLISH news hello", out: `subscribers reached: ${delivered.replace(":", "")}\nconnection 1 received: ${message}` },
      { cmd: "-- connection 3 subscribes after the message was sent", out: missed ? "received nothing: messages aren't stored" : "received something" },
    ],
  };
}

async function redisBench() {
  await start("redis");
  const out = inContainer("dbe-redis", "redis-benchmark -q -t set,get -n 100000 -c 50 2>/dev/null | tr '\\r' '\\n' | grep 'requests per second'");
  const piped = inContainer("dbe-redis", "redis-benchmark -q -t set -n 100000 -c 50 -P 16 2>/dev/null | tr '\\r' '\\n' | grep 'requests per second'");
  const info = inContainer("dbe-redis", "redis-cli info server | grep -E 'multiplexing_api|io_threads_active|process_id'; redis-cli config get io-threads");
  return {
    engine: await version("redis"),
    blocks: [
      { cmd: "$ redis-benchmark -t set,get -n 100000 -c 50", out: out.trim().split("\n").map((l) => l.trim().replace(/\s+p50=.*/, "")).filter(Boolean).slice(-2).join("\n") },
      { cmd: "$ redis-benchmark -t set -n 100000 -c 50 -P 16   # pipelining 16 commands", out: piped.trim().split("\n").map((l) => l.trim().replace(/\s+p50=.*/, "")).filter(Boolean).slice(-1).join("\n") },
      { cmd: "$ redis-cli info server; redis-cli config get io-threads", out: info.trim().replace(/process_id:\d+\n/, "") },
    ],
  };
}

// ---------------------------------------------------------------- MongoDB

const MONGO_LOAD = `db.users.insertMany(Array.from({ length: 100000 }, (_, i) => ({ _id: i, name: "user" + i, age: i % 80 }))).acknowledged
db.c_users.drop()
db.createCollection("c_users", { clusteredIndex: { key: { _id: 1 }, unique: true } }).ok
db.c_users.insertMany(Array.from({ length: 100000 }, (_, i) => ({ _id: i, name: "user" + i, age: i % 80 }))).acknowledged
db.users.createIndex({ name: 1 })
db.c_users.createIndex({ name: 1 })`;

const spec = {
  runs: {
    "mongo-basics": {
      engine: "mongo",
      sql: `db.serverStatus().storageEngine.name
ObjectId().toString().length
ObjectId("65f1a2b3c4d5e6f708192a3b").getTimestamp()
db.t.insertOne({ name: "a" }).insertedId.constructor.name
db.t.stats().wiredTiger.creationString.match(/(internal_page_max|leaf_page_max)=\\w+/g)`,
    },
    "mongo-plans": {
      engine: "mongo",
      sql: `${MONGO_LOAD}
db.users.find({ _id: 500 }).explain("executionStats").queryPlanner.winningPlan.stage
db.users.find({ name: "user500" }).explain("executionStats").executionStats.totalDocsExamined
db.users.find({ name: "user500" }).explain().queryPlanner.winningPlan.stage
db.users.find({ name: "user500" }).explain().queryPlanner.winningPlan.inputStage.stage
db.users.find({ name: "user500" }, { _id: 0, name: 1 }).explain("executionStats").executionStats.totalDocsExamined
db.users.find({ age: 7 }).explain("executionStats").queryPlanner.winningPlan.stage`,
    },
    "mongo-clustered": {
      engine: "mongo",
      sql: `${MONGO_LOAD}
db.c_users.find({ _id: 500 }).explain("executionStats").queryPlanner.winningPlan.stage
db.adminCommand({ fsync: 1 }).ok
db.users.stats().indexSizes
db.c_users.stats().indexSizes
db.users.stats().storageSize + db.users.stats().totalIndexSize
db.c_users.stats().storageSize + db.c_users.stats().totalIndexSize`,
    },
    "memcached-basics": {
      engine: "memcached",
      sql: `set name 0 3600 3 || ana
get name
set counter 0 0 1 || 5
incr counter 3
delete name
get name`,
    },
    "memcached-slabs": memcachedSlabs,
    "memcached-pool": memcachedPool,
    "redis-wire": redisWire,
    "redis-expiry": redisExpiry,
    "redis-pubsub": redisPubSub,
    "redis-durability": redisDurability,
    "redis-bench": redisBench,
  },

  playgrounds: {
    documents: {
      title: "Documents in a relational table",
      hint: "Mongo isn't available in the browser, but Postgres stores documents too. jsonb is binary, like BSON, and a GIN index can search inside it.",
      setup: `CREATE TABLE users (id serial PRIMARY KEY, doc jsonb);
INSERT INTO users (doc) SELECT jsonb_build_object('name', 'user' || g, 'age', g % 80, 'tags', jsonb_build_array('a', 'b')) FROM generate_series(1, 50000) g;
CREATE INDEX users_doc ON users USING gin (doc);
ANALYZE users;`,
      query: `SELECT doc FROM users WHERE doc @> '{"name": "user500"}';`,
      presets: [
        { label: "Its plan", sql: `EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF, SUMMARY OFF)
SELECT doc FROM users WHERE doc @> '{"name": "user500"}';` },
        { label: "Reach into a field", sql: `SELECT doc->>'name' AS name, (doc->>'age')::int AS age FROM users LIMIT 3;` },
      ],
    },
  },
};

export default spec;
