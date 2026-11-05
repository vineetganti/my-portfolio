// Real crash tests: a throwaway Postgres container is killed with SIGKILL while it works, then
// restarted, and the rows that survive are counted. A container kill is a process crash, not a power
// cut: the operating system's page cache survives it, and the posts that use this say so.
import { spawn, spawnSync } from "node:child_process";
import pg from "pg";
import { docker, inContainer, pause, version } from "./lab.mjs";

const NAME = "dbe-crash";
const PORT = 55499;

const client = () => {
  const c = new pg.Client({ host: "127.0.0.1", port: PORT, user: "postgres", password: "postgres", database: "postgres" });
  c.on("error", () => {});
  return c;
};

async function ready() {
  for (let i = 0; i < 90; i++) {
    const c = client();
    try {
      await c.connect();
      await c.query("select 1");
      await c.end();
      return;
    } catch {
      await c.end().catch(() => {});
      await pause(500);
    }
  }
  throw new Error("crash container did not come up");
}

async function boot() {
  spawnSync("docker", ["rm", "-f", NAME]);
  docker("run", "-d", "--name", NAME, "-p", `${PORT}:5432`, "-e", "POSTGRES_PASSWORD=postgres", "postgres:18");
  await ready();
}

const kill = () =>
  new Promise((done) => {
    spawn("docker", ["kill", "-s", "KILL", NAME]).on("exit", done);
  });

async function restart() {
  docker("start", NAME);
  await ready();
}

const psql = (sql) => inContainer(NAME, "psql -U postgres -X -q -P pager=off", sql).trimEnd();

/** The server's own account of the restart. `docker logs` sends the server's stderr to stderr. */
function recoveryLog() {
  const r = spawnSync("docker", ["logs", NAME], { encoding: "utf8", maxBuffer: 1 << 26 });
  return `${r.stdout}\n${r.stderr}`
    .split("\n")
    .filter((l) => /interrupted|not properly shut down|redo (starts|done)|ready to accept/.test(l))
    .slice(-5)
    .map((l) => l.replace(/^\S+ \S+ \S+ \[\d+\] /, ""))
    .join("\n");
}

/** Commits as fast as it can until the server dies, then counts what survived. */
async function hammer(mode) {
  const c = client();
  await c.connect();
  await c.query("DROP TABLE IF EXISTS log; CREATE TABLE log (n int)");
  await c.query(`SET synchronous_commit = ${mode}`);
  let acked = 0;
  const killer = pause(1500).then(kill);
  try {
    for (;;) {
      await c.query("INSERT INTO log VALUES ($1)", [acked + 1]);
      acked++;
    }
  } catch {
    // the server is gone
  }
  await killer;
  await c.end().catch(() => {});
  await restart();
  const r = client();
  await r.connect();
  const { rows } = await r.query("SELECT count(*)::int AS n FROM log");
  await r.end();
  return { acked, rows: rows[0].n, lost: Math.max(0, acked - rows[0].n) };
}

async function throughput(mode) {
  const c = client();
  await c.connect();
  await c.query("DROP TABLE IF EXISTS speed; CREATE TABLE speed (n int)");
  await c.query(`SET synchronous_commit = ${mode}`);
  const end = Date.now() + 3000;
  let n = 0;
  while (Date.now() < end) {
    await c.query("INSERT INTO speed VALUES ($1)", [n]);
    n++;
  }
  await c.end();
  return Math.round(n / 3);
}

/** Row 1 commits, row 2 stays in an open transaction, the server is killed. */
export async function crashRecovery() {
  await boot();
  const a = client();
  const b = client();
  await a.connect();
  await b.connect();
  await a.query("CREATE TABLE log (n int)");
  await a.query("INSERT INTO log VALUES (1)");
  await b.query("BEGIN");
  await b.query("INSERT INTO log VALUES (2)");
  await kill();
  await a.end().catch(() => {});
  await b.end().catch(() => {});
  await restart();
  const rows = psql("SELECT n FROM log;");
  const log = recoveryLog();
  spawnSync("docker", ["rm", "-f", NAME]);
  return {
    engine: await version("postgres"),
    blocks: [
      {
        cmd: [
          "-- connection 1 commits a row",
          "INSERT INTO log VALUES (1);",
          "-- connection 2 leaves one uncommitted",
          "BEGIN;",
          "INSERT INTO log VALUES (2);",
          "-- then the server dies without warning, and comes back",
          "$ docker kill -s KILL dbe-crash",
          "$ docker start dbe-crash",
        ].join("\n"),
        out: log,
      },
      { cmd: "SELECT n FROM log;", out: rows },
    ],
  };
}

/** What synchronous_commit trades: speed against acknowledged commits that a crash can lose. */
export async function commitTradeoff() {
  await boot();
  const speed = { on: await throughput("on"), off: await throughput("off") };
  const runs = [];
  for (const mode of ["on", "off"]) {
    for (let i = 0; i < 3; i++) runs.push({ mode, ...(await hammer(mode)) });
  }
  spawnSync("docker", ["rm", "-f", NAME]);
  const line = (r) =>
    `synchronous_commit=${r.mode.padEnd(3)}  acknowledged ${String(r.acked).padStart(6)}  in table after crash ${String(r.rows).padStart(6)}  lost ${r.lost}`;
  return {
    engine: await version("postgres"),
    blocks: [
      {
        cmd: "-- one client, three seconds of single-row commits",
        out: `synchronous_commit=on   ${speed.on} commits per second\nsynchronous_commit=off  ${speed.off} commits per second`,
      },
      {
        cmd: "-- commit in a loop, kill the server after 1.5 seconds, restart, count the rows",
        out: runs.map(line).join("\n"),
      },
    ],
  };
}
