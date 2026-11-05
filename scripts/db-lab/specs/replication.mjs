// Post 9: replication and CAP, on a real primary and a real standby in two containers.
import { spawnSync } from "node:child_process";
import pg from "pg";
import { docker, inContainer, pause, version } from "../lab.mjs";

const NET = "dbe-net";
const PRIMARY = { name: "dbe-primary", port: 55451 };
const STANDBY = { name: "dbe-standby", port: 55452 };
const VOLUME = "dbe-standby-data";
const DATA = "/var/lib/postgresql/18/docker";

const quiet = (...args) => spawnSync("docker", args, { encoding: "utf8" });

const connect = async ({ port }) => {
  for (let i = 0; i < 120; i++) {
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
  throw new Error(`no connection on ${port}`);
};

const psql = (who, sql) => inContainer(who.name, "psql -U postgres -X -q -P pager=off", sql).trimEnd();
const count = (who, table) => Number(inContainer(who.name, "psql -U postgres -X -q -At", `SELECT count(*) FROM ${table};`).trim());
const drop = (client) => client.connection?.stream?.destroy();

function cleanup() {
  quiet("rm", "-f", PRIMARY.name, STANDBY.name);
  quiet("volume", "rm", "-f", VOLUME);
  quiet("network", "rm", NET);
}

async function build() {
  cleanup();
  docker("network", "create", NET);
  docker("run", "-d", "--name", PRIMARY.name, "--network", NET, "-p", `${PRIMARY.port}:5432`, "-e", "POSTGRES_PASSWORD=postgres", "postgres:18");
  const p = await connect(PRIMARY);
  await p.query("CREATE ROLE replicator WITH REPLICATION LOGIN PASSWORD 'replicator'");
  inContainer(PRIMARY.name, `echo 'host replication replicator all scram-sha-256' >> ${DATA}/pg_hba.conf`);
  await p.query("SELECT pg_reload_conf()");
  docker("volume", "create", VOLUME);
  const backup = spawnSync(
    "docker",
    ["run", "--rm", "--user", "postgres", "--network", NET, "-e", "PGPASSWORD=replicator", "-v", `${VOLUME}:/var/lib/postgresql`, "postgres:18", "sh", "-c", `mkdir -p ${DATA} && chmod 700 ${DATA} && pg_basebackup -h ${PRIMARY.name} -U replicator -D ${DATA} -R -X stream -c fast`],
    { encoding: "utf8" },
  );
  if (backup.status !== 0) throw new Error(backup.stderr);
  docker("run", "-d", "--name", STANDBY.name, "--network", NET, "-p", `${STANDBY.port}:5432`, "-v", `${VOLUME}:/var/lib/postgresql`, "-e", "POSTGRES_PASSWORD=postgres", "postgres:18");
  const s = await connect(STANDBY);
  for (let i = 0; i < 60; i++) {
    const r = await p.query("SELECT count(*)::int AS n FROM pg_stat_replication WHERE state = 'streaming'");
    if (r.rows[0].n) break;
    await pause(500);
  }
  return { p, s };
}

async function commitRate(client, seconds = 2) {
  const end = Date.now() + seconds * 1000;
  let n = 0;
  while (Date.now() < end) {
    await client.query("INSERT INTO speed VALUES (1)");
    n++;
  }
  return Math.round(n / seconds);
}

async function run() {
  const out = {};
  let { p, s } = await build();

  // 1. It works, and the standby is read-only.
  await p.query("CREATE TABLE t (id serial PRIMARY KEY, v text)");
  await p.query("INSERT INTO t (v) SELECT 'row ' || g FROM generate_series(1, 10000) g");
  await pause(500);
  const stat = psql(PRIMARY, "SELECT client_addr IS NOT NULL AS connected, application_name, state, sync_state FROM pg_stat_replication;");
  const onStandby = psql(STANDBY, "SELECT count(*) FROM t;\nSELECT pg_is_in_recovery();");
  const refused = psql(STANDBY, "CREATE TABLE nope (id int);\nINSERT INTO t (v) VALUES ('nope');");
  await p.query("ALTER TABLE t ADD COLUMN extra int");
  await pause(300);
  const ddl = psql(STANDBY, "\\d t");
  out.basics = {
    blocks: [
      { cmd: "-- on the primary\nSELECT application_name, state, sync_state FROM pg_stat_replication;", out: stat },
      { cmd: "-- on the standby\nSELECT count(*) FROM t;\nSELECT pg_is_in_recovery();", out: onStandby },
      { cmd: "-- writing to the standby\nCREATE TABLE nope (id int);\nINSERT INTO t (v) VALUES ('nope');", out: refused },
      { cmd: "-- ALTER TABLE t ADD COLUMN extra int on the primary, then on the standby:\n\\d t", out: ddl },
    ],
  };

  // 2. What each level of synchronous commit costs.
  await p.query("CREATE TABLE speed (n int)");
  const rates = {};
  await p.query("ALTER SYSTEM SET synchronous_standby_names = 'first 1 (walreceiver)'");
  await p.query("SELECT pg_reload_conf()");
  await pause(800);
  for (const level of ["local", "remote_write", "on", "remote_apply"]) {
    await p.query(`SET synchronous_commit = ${level}`);
    rates[level] = await commitRate(p);
  }
  await p.query("RESET synchronous_commit");
  out.rates = {
    blocks: [
      {
        cmd: "-- one client, single-row commits, for each setting",
        out: [
          `synchronous_commit=local         ${rates.local} commits/s   waits for the primary's own disk`,
          `synchronous_commit=remote_write  ${rates.remote_write} commits/s   waits for the standby to receive it`,
          `synchronous_commit=on            ${rates.on} commits/s   waits for the standby's disk`,
          `synchronous_commit=remote_apply  ${rates.remote_apply} commits/s   waits until a read there would see it`,
        ].join("\n"),
      },
    ],
  };

  // 3. Synchronous replica unreachable: the write hangs. Consistency over availability.
  const syncState = psql(PRIMARY, "SELECT application_name, sync_state FROM pg_stat_replication;");
  docker("network", "disconnect", NET, STANDBY.name);
  await pause(300);
  const hung = await connect(PRIMARY);
  const notes = [];
  hung.on("notice", (n) => notes.push(`${n.severity}: ${n.message}`));
  const started = Date.now();
  let outcome = "still waiting";
  const write = hung.query("INSERT INTO t (v) VALUES ('during the partition')").then(
    () => (outcome = "returned"),
    (e) => (outcome = `error: ${e.message}`),
  );
  await pause(3000);
  const waited = Date.now() - started;
  const before = outcome;
  const seen = (await p.query("SELECT state, wait_event, left(query, 40) AS query FROM pg_stat_activity WHERE wait_event = 'SyncRep'")).rows[0];
  await p.query("SELECT pg_cancel_backend(pid) FROM pg_stat_activity WHERE wait_event = 'SyncRep'");
  await write;
  await pause(200);
  await hung.end().catch(() => {});
  out.cp = {
    blocks: [
      { cmd: "-- synchronous replication on", out: syncState },
      { cmd: "$ docker network disconnect dbe-net dbe-standby\nINSERT INTO t (v) VALUES ('during the partition');", out: `after ${(waited / 1000).toFixed(1)} s the client is ${before}\npg_stat_activity: wait_event=${seen?.wait_event}, query="${seen?.query}"` },
      { cmd: "SELECT pg_cancel_backend(pid);   -- give up on the wait", out: notes.join("\n") || outcome },
    ],
  };
  const stillThere = (await p.query("SELECT count(*)::int AS n FROM t WHERE v = 'during the partition'")).rows[0].n;
  out.cp.blocks.push({ cmd: "SELECT count(*) FROM t WHERE v = 'during the partition';", out: String(stillThere) });

  // 4. Asynchronous during a partition: writes go on, and the standby serves stale data.
  await p.query("ALTER SYSTEM RESET synchronous_standby_names");
  await p.query("SELECT pg_reload_conf()");
  await pause(500);
  await p.query("INSERT INTO t (v) SELECT 'while partitioned' FROM generate_series(1, 500)");
  const primaryCount = (await p.query("SELECT count(*)::int AS n FROM t")).rows[0].n;
  const standbyCount = count(STANDBY, "t");
  docker("network", "connect", NET, STANDBY.name);
  let caught = null;
  const reconnected = Date.now();
  for (let i = 0; i < 300; i++) {
    const n = count(STANDBY, "t");
    if (n === primaryCount) {
      caught = Date.now() - reconnected;
      break;
    }
    await pause(100);
  }
  out.ap = {
    blocks: [
      {
        cmd: "-- asynchronous, network still cut: 500 more rows on the primary",
        out: `primary: ${primaryCount} rows, and every write was accepted\nstandby: ${standbyCount} rows, still answering reads, now stale`,
      },
      { cmd: "$ docker network connect dbe-net dbe-standby", out: `standby caught up to ${primaryCount} rows after ${(caught / 1000).toFixed(1)} s` },
    ],
  };

  // 5. Read your writes, against a replica that applies WAL two seconds late.
  drop(s);
  inContainer(STANDBY.name, `echo "recovery_min_apply_delay = '2s'" >> ${DATA}/postgresql.auto.conf`);
  quiet("restart", STANDBY.name);
  s = await connect(STANDBY);
  await pause(1000);
  await p.query("CREATE TABLE profile (id int PRIMARY KEY, bio text)");
  await p.query("INSERT INTO profile VALUES (1, 'old bio')");
  await pause(2600);
  await p.query("UPDATE profile SET bio = 'new bio' WHERE id = 1");
  const t0 = Date.now();
  const samples = [];
  for (let i = 0; i < 14; i++) {
    const a = (await p.query("SELECT bio FROM profile WHERE id = 1")).rows[0].bio;
    const b = (await s.query("SELECT bio FROM profile WHERE id = 1")).rows[0].bio;
    samples.push({ ms: Date.now() - t0, primary: a, standby: b });
    await pause(250);
  }
  out.yourWrites = {
    blocks: [
      {
        cmd: "-- recovery_min_apply_delay = '2s' on the standby\nUPDATE profile SET bio = 'new bio' WHERE id = 1;   -- on the primary\n-- then read both, every 250 ms",
        out: samples.filter((_, i) => i % 2 === 0).map((x) => `${String(x.ms).padStart(5)} ms   primary: ${x.primary}   standby: ${x.standby}`).join("\n"),
      },
    ],
  };

  // 6. Failover under async: what the old primary had acknowledged but never shipped.
  drop(s);
  inContainer(STANDBY.name, `sed -i '/recovery_min_apply_delay/d' ${DATA}/postgresql.auto.conf`);
  quiet("restart", STANDBY.name);
  await pause(1500);
  await p.query("CREATE TABLE orders (id serial PRIMARY KEY)");
  await pause(1500);
  docker("network", "disconnect", NET, STANDBY.name);
  let acked = 0;
  for (let i = 0; i < 200; i++) {
    await p.query("INSERT INTO orders DEFAULT VALUES");
    acked++;
  }
  quiet("kill", "-s", "KILL", PRIMARY.name);
  drop(p);
  docker("network", "connect", NET, STANDBY.name);
  // Reconnecting the network leaves the published port stale, so talk to the standby from inside.
  const at = (sql) => inContainer(STANDBY.name, "psql -U postgres -X -q -At", sql).trim();
  const promoted = at("SELECT pg_promote(true, 30);");
  await pause(500);
  const after = { recovery: at("SELECT pg_is_in_recovery();"), rows: Number(at("SELECT count(*) FROM orders;")) };
  at("INSERT INTO orders DEFAULT VALUES;");
  out.failover = {
    blocks: [
      {
        cmd: "-- asynchronous: the primary acknowledges 200 orders the standby never received, then dies\nSELECT pg_promote();",
        out: `promoted: ${promoted}, pg_is_in_recovery: ${after.recovery}\norders acknowledged to clients: ${acked}\norders on the new primary:      ${after.rows}\nlost in the failover:           ${acked - after.rows}`,
      },
    ],
  };

  cleanup();
  const engine = await version("postgres");
  for (const key of Object.keys(out)) out[key].engine = `${engine}, primary and standby`;
  return out;
}

let done;
const lab = () => (done ??= run());
const part = (key) => async () => (await lab())[key];

const spec = {
  runs: {
    basics: part("basics"),
    rates: part("rates"),
    cp: part("cp"),
    ap: part("ap"),
    "your-writes": part("yourWrites"),
    failover: part("failover"),
  },
  playgrounds: {
    lsn: {
      title: "The log that replication ships",
      hint: "A standby replays WAL, so this is what travels. Every write moves the position forward, and pg_walinspect shows the records themselves.",
      setup: `CREATE TABLE t (id int, v text);`,
      query: `SELECT pg_current_wal_insert_lsn() AS before_write;
INSERT INTO t SELECT g, 'row' FROM generate_series(1, 1000) g;
SELECT pg_current_wal_insert_lsn() AS after_write;`,
      presets: [
        { label: "Bytes of WAL for 1,000 rows", sql: `CREATE TEMP TABLE IF NOT EXISTS mark (lsn pg_lsn);
TRUNCATE mark;
INSERT INTO mark SELECT pg_current_wal_insert_lsn();
INSERT INTO t SELECT g, 'row' FROM generate_series(1, 1000) g;
SELECT pg_size_pretty(pg_current_wal_insert_lsn() - lsn) AS wal_written FROM mark;` },
        { label: "Read the records", sql: `SELECT start_lsn, resource_manager, record_type, record_length
FROM pg_get_wal_records_info(pg_current_wal_insert_lsn() - 2000, pg_current_wal_insert_lsn())
LIMIT 8;` },
      ],
    },
  },
};

export default spec;
