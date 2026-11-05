// Everything the recordings need: the five engines in Docker, one session type per engine, and the
// recorders. record.mjs walks the specs in scripts/db-lab/specs and calls these.
import { execFileSync, spawnSync } from "node:child_process";
import net from "node:net";
import pg from "pg";
import mysql from "mysql2/promise";

export const ENGINES = {
  postgres: { name: "dbe-pg", image: "postgres:18", port: 55432, inner: 5432, env: ["POSTGRES_PASSWORD=postgres"], args: ["-c", "shared_buffers=256MB"] },
  mysql: { name: "dbe-mysql", image: "mysql:8.4", port: 53306, inner: 3306, env: ["MYSQL_ROOT_PASSWORD=password"] },
  mongo: { name: "dbe-mongo", image: "mongo:8.0", port: 57017, inner: 27017 },
  redis: { name: "dbe-redis", image: "redis:8.0", port: 56379, inner: 6379 },
  memcached: { name: "dbe-memcached", image: "memcached:1.6", port: 51211, inner: 11211 },
};

export const pause = (ms) => new Promise((r) => setTimeout(r, ms));
export const docker = (...args) => execFileSync("docker", args, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], maxBuffer: 1 << 28 });

/** Runs a shell line inside a container, feeding `input` on stdin, with stderr folded into stdout. */
export function inContainer(name, line, input = "", env = []) {
  const r = spawnSync("docker", ["exec", "-i", ...env.flatMap((e) => ["-e", e]), name, "sh", "-c", `${line} 2>&1`], {
    input,
    encoding: "utf8",
    maxBuffer: 1 << 28,
  });
  return (r.stdout ?? "").replace(/\r/g, "");
}

const CHECKS = {
  postgres: async () => {
    const c = pgClient("postgres");
    await c.connect();
    await c.end();
  },
  mysql: async () => {
    const c = await mysqlClient();
    await c.end();
  },
  mongo: async () => {
    if (!inContainer("dbe-mongo", "mongosh --quiet --eval 'db.runCommand({ping:1}).ok'").includes("1")) throw new Error("no");
  },
  redis: async () => {
    if (!inContainer("dbe-redis", "redis-cli ping").includes("PONG")) throw new Error("no");
  },
  memcached: async () => {
    await new Promise((ok, no) => {
      const s = net.connect(ENGINES.memcached.port, "127.0.0.1", () => (s.end(), ok()));
      s.on("error", no);
    });
  },
};

const started = new Set();

export async function start(engine) {
  if (started.has(engine)) return;
  const e = ENGINES[engine];
  if (!docker("ps", "--filter", `name=^${e.name}$`, "--format", "{{.Names}}").trim()) {
    if (docker("ps", "-a", "--filter", `name=^${e.name}$`, "--format", "{{.Names}}").trim()) docker("start", e.name);
    else docker("run", "-d", "--name", e.name, "--shm-size=1g", "-p", `${e.port}:${e.inner}`, ...(e.env ?? []).flatMap((v) => ["-e", v]), e.image, ...(e.args ?? []));
  }
  for (let i = 0; i < 120; i++) {
    try {
      await CHECKS[engine]();
      started.add(engine);
      return;
    } catch {
      await pause(1000);
    }
  }
  throw new Error(`${engine} did not start`);
}

export const pgClient = (database) => {
  const c = new pg.Client({ host: "127.0.0.1", port: ENGINES.postgres.port, user: "postgres", password: "postgres", database });
  c.on("error", () => {});
  return c;
};

export const mysqlClient = (database) =>
  mysql.createConnection({ host: "127.0.0.1", port: ENGINES.mysql.port, user: "root", password: "password", database, multipleStatements: true, dateStrings: true });

function plain(v) {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString().replace("T", " ").replace(/\.\d+Z$/, "");
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "object") return JSON.stringify(v);
  return v;
}

class PgSession {
  async open(db) {
    this.c = pgClient(db);
    await this.c.connect();
    return this;
  }
  async run(sql) {
    const r = await this.c.query(sql);
    const last = Array.isArray(r) ? r[r.length - 1] : r;
    const cols = last.fields?.map((f) => f.name) ?? [];
    const tag = last.command ? `${last.command}${!cols.length && last.rowCount != null ? ` ${last.rowCount}` : ""}` : "";
    return { tag, cols, rows: cols.length ? last.rows.map((row) => cols.map((c) => plain(row[c]))) : [] };
  }
  async close() {
    await this.c.end().catch(() => {});
  }
}

class MySession {
  async open(db) {
    this.c = await mysqlClient(db);
    return this;
  }
  async run(sql) {
    const [res, fields] = await this.c.query(sql);
    if (Array.isArray(res)) {
      const cols = (fields ?? []).map((f) => f.name);
      return { tag: `${res.length} row${res.length === 1 ? "" : "s"}`, cols, rows: res.map((row) => cols.map((c) => plain(row[c]))) };
    }
    return { tag: `OK, ${res.affectedRows} row${res.affectedRows === 1 ? "" : "s"} affected`, cols: [], rows: [] };
  }
  async close() {
    await this.c.end().catch(() => {});
  }
}

export const session = (engine) => (engine === "mysql" ? new MySession() : new PgSession());

let counter = 0;
const unique = () => `lab_${process.pid}_${++counter}`;

export async function freshDb(engine) {
  await start(engine);
  const db = unique();
  const s = await session(engine).open(engine === "mysql" ? undefined : "postgres");
  await s.run(`CREATE DATABASE ${db}`);
  await s.close();
  return db;
}

export async function dropDb(engine, db) {
  const s = await session(engine).open(engine === "mysql" ? undefined : "postgres");
  await s.run(engine === "mysql" ? `DROP DATABASE IF EXISTS ${db}` : `DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);
  await s.close();
}

const versions = {};

export async function version(engine) {
  if (versions[engine]) return versions[engine];
  await start(engine);
  const first = (text) => text.trim().split("\n").pop().trim();
  const read = {
    postgres: () => `PostgreSQL ${first(inContainer("dbe-pg", "postgres --version")).split(" ")[2]}`,
    mysql: () => `MySQL ${first(inContainer("dbe-mysql", "mysqld --version")).match(/Ver ([\d.]+)/)[1]}`,
    mongo: () => `MongoDB ${first(inContainer("dbe-mongo", "mongod --version | head -1")).split(" v").pop()}`,
    redis: () => `Redis ${inContainer("dbe-redis", "redis-server --version").match(/v=([\d.]+)/)[1]}`,
    memcached: () => `Memcached ${first(inContainer("dbe-memcached", "memcached --version")).split(" ")[1]}`,
  };
  versions[engine] = read[engine]();
  return versions[engine];
}

// ---------------------------------------------------------------- theaters

const fill = (sql, vars) => sql.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));

function toResult(done) {
  if (done.ok) {
    const r = { status: "ok" };
    if (done.r.tag) r.tag = done.r.tag;
    if (done.r.cols.length) {
      r.cols = done.r.cols;
      r.rows = done.r.rows.slice(0, 12);
    }
    return r;
  }
  const r = { status: "error", error: String(done.e.message).split("\n")[0] };
  if (done.e.code) r.code = done.e.code;
  return r;
}

/**
 * Steps through several real connections. A statement that hasn't returned in `wait` ms is marked
 * blocked and the run moves on; when it does return, the step that freed it is recorded.
 */
async function recordVariant(t, variant) {
  const engine = t.engine ?? "postgres";
  const vars = variant.vars ?? {};
  const db = await freshDb(engine);
  const admin = await session(engine).open(db);
  for (const stmt of t.setup) await admin.run(fill(stmt, vars));

  const sessions = {};
  for (const name of t.sessions) sessions[name] = await session(engine).open(db);
  const steps = [];
  const waiting = new Map();
  const list = [...(variant.steps ?? t.steps), ...(variant.extra ?? [])];

  for (let i = 0; i < list.length; i++) {
    const [who, rawSql, note, opts = {}] = list[i];
    const sql = fill(rawSql, vars);
    const step = { s: who, sql, note: fill(note ?? "", vars), status: "ok" };
    steps.push(step);
    const box = {};
    const began = Date.now();
    const work = sql === "\\q" ? sessions[who].close().then(() => ({ tag: "connection closed", cols: [], rows: [] })) : sessions[who].run(sql);
    const running = work.then(
      (r) => (box.done = { ok: true, r, ms: Date.now() - began }),
      (e) => (box.done = { ok: false, e, ms: Date.now() - began }),
    );
    await Promise.race([running, pause(opts.wait ?? t.wait ?? 450)]);
    if (box.done) Object.assign(step, toResult(box.done));
    else {
      step.status = "blocked";
      waiting.set(i, box);
    }
    await pause(opts.settle ?? 150);
    for (const [k, b] of [...waiting]) {
      if (!b.done) continue;
      if (k === i) continue;
      steps[k].resolvedAt = i;
      steps[k].resolved = toResult(b.done);
      waiting.delete(k);
    }
    if (t.observe) {
      const r = await admin.run(fill(t.observe, vars));
      step.table = { cols: r.cols, rows: r.rows };
    }
  }
  // A statement still blocked at the end of the run would hang the disconnect: free it.
  await admin.close();
  await dropDb(engine, db);
  await Promise.allSettled(Object.values(sessions).map((s) => s.close()));
  return steps;
}

export async function recordTheater(t) {
  const engine = t.engine ?? "postgres";
  const variants = [];
  for (const v of t.variants ?? [{ label: "" }]) {
    variants.push({ label: v.label, summary: v.summary ?? t.summary ?? "", steps: await recordVariant(t, v) });
  }
  return { title: t.title, alt: t.alt, engine: await version(engine), sessions: t.sessions, tableName: t.tableName ?? "committed rows", variants };
}

// ---------------------------------------------------------------- terminal runs

/** Splits a psql script into statements: a line ending in ; closes one, and so does a \command line. */
function statements(script) {
  const out = [];
  let cur = [];
  let quoted = false;
  for (const line of script.split("\n")) {
    if (!line.trim() && !cur.length) continue;
    cur.push(line);
    if ((line.match(/\$\$/g) ?? []).length % 2 === 1) quoted = !quoted;
    if (quoted) continue;
    if (/;\s*$/.test(line) || (cur.length === 1 && line.startsWith("\\"))) {
      out.push(cur.join("\n"));
      cur = [];
    }
  }
  if (cur.length) out.push(cur.join("\n"));
  return out;
}

const MARK = "@@lab-step@@";

function psqlBlocks(db, script) {
  const stmts = statements(script);
  const input = stmts.map((s) => `\\echo ${MARK}\n${s}`).join("\n") + "\n";
  const text = inContainer("dbe-pg", `psql -U postgres -d ${db} -X -q -P pager=off`, input);
  const parts = text.split(`${MARK}\n`).slice(1);
  return stmts.map((cmd, i) => ({ cmd, out: (parts[i] ?? "").replace(/\s+$/, "") })).filter((b) => !b.cmd.startsWith("\\timing"));
}

function mysqlBlocks(db, script) {
  const stmts = statements(script);
  const input = stmts.map((s) => `select '${MARK}' as x;\n${s}`).join("\n") + "\n";
  const text = inContainer("dbe-mysql", `mysql -uroot --table -vvv --force --unbuffered ${db}`, input, ["MYSQL_PWD=password"]);
  const parts = text.split(/--------------\nselect '@@lab-step@@' as x\n--------------\n[\s\S]*?\(\d+\.\d+ sec\)\n/).slice(1);
  return stmts.map((cmd, i) => ({
    cmd,
    out: (parts[i] ?? "")
      .replace(/^\s*--------------\n[\s\S]*?\n--------------\n/, "")
      .replace(/\nBye\s*$/, "")
      .trim(),
  }));
}

function redisBlocks(script) {
  return script
    .split("\n")
    .filter((l) => l.trim())
    .map((cmd) => ({ cmd: `> ${cmd}`, out: inContainer("dbe-redis", "redis-cli --no-raw", `${cmd}\n`).trimEnd() }));
}

function mongoBlocks(script) {
  const stmts = script.split(/\n(?=\S)/).filter((s) => s.trim());
  const body = stmts.map((s) => `print("${MARK}");\nprintjson(${s.replace(/;\s*$/, "")});`).join("\n");
  const text = inContainer("dbe-mongo", "cat > /tmp/lab.js && mongosh --quiet lab --file /tmp/lab.js", body);
  const parts = text.split(`${MARK}\n`).slice(1);
  return stmts.map((cmd, i) => ({ cmd, out: (parts[i] ?? "").trimEnd() }));
}

/** Talks the text protocol to Memcached over a real TCP socket, one command at a time. */
async function memcachedBlocks(script) {
  await start("memcached");
  const sock = net.connect(ENGINES.memcached.port, "127.0.0.1");
  await new Promise((r) => sock.once("connect", r));
  sock.setEncoding("utf8");
  let buffer = "";
  sock.on("data", (d) => (buffer += d));
  const blocks = [];
  for (const cmd of script.split("\n").filter((l) => l.length)) {
    const [line, data] = cmd.split(" || ");
    buffer = "";
    sock.write(data === undefined ? `${line}\r\n` : `${line}\r\n${data}\r\n`);
    await pause(120);
    blocks.push({ cmd: data === undefined ? line : `${line}\n${data}`, out: buffer.replace(/\r/g, "").trimEnd() });
  }
  sock.destroy();
  return blocks;
}

export async function recordRun(r) {
  const engine = r.engine ?? "postgres";
  await start(engine);
  let blocks;
  if (engine === "postgres" || engine === "mysql") {
    const db = await freshDb(engine);
    if (r.setup) {
      const s = await session(engine).open(db);
      for (const stmt of [r.setup].flat()) await s.run(stmt);
      await s.close();
    }
    blocks = engine === "mysql" ? mysqlBlocks(db, r.sql) : psqlBlocks(db, r.sql);
    await dropDb(engine, db);
  } else if (engine === "redis") {
    inContainer("dbe-redis", "redis-cli flushall");
    blocks = redisBlocks(r.sql);
  } else if (engine === "mongo") {
    inContainer("dbe-mongo", "mongosh --quiet lab --eval 'db.dropDatabase()'");
    blocks = mongoBlocks(r.sql);
  } else {
    blocks = await memcachedBlocks(r.sql);
  }
  return { engine: await version(engine), blocks };
}
