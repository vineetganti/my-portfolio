// Post 13: TLS, the wire protocol, least privilege and a very large query.
import { spawnSync } from "node:child_process";
import net from "node:net";
import pg from "pg";
import { docker, ENGINES, freshDb, dropDb, inContainer, pause, start, version } from "../lab.mjs";

const NAME = "dbe-tls";
const PORT = 55461;
const PROXY = 55462;
const DATA = "/var/lib/postgresql/18/docker";

const client = (extra = {}) => {
  const c = new pg.Client({ host: "127.0.0.1", port: PORT, user: "postgres", password: "postgres", database: "postgres", ...extra });
  c.on("error", () => {});
  return c;
};

async function ready() {
  for (let i = 0; i < 90; i++) {
    const c = client();
    try {
      await c.connect();
      await c.end();
      return;
    } catch {
      await c.end().catch(() => {});
      await pause(500);
    }
  }
  throw new Error("no postgres");
}

const attempt = async (config, sql) => {
  const c = client(config);
  try {
    await c.connect();
    const r = sql ? await c.query(sql) : null;
    await c.end();
    return r ? JSON.stringify(r.rows[0]) : "connected";
  } catch (e) {
    await c.end().catch(() => {});
    return `error: ${e.message}`;
  }
};

async function tls() {
  spawnSync("docker", ["rm", "-f", NAME]);
  docker("run", "-d", "--name", NAME, "-p", `${PORT}:5432`, "-e", "POSTGRES_PASSWORD=postgres", "postgres:18");
  await ready();
  const before = await attempt({ ssl: { rejectUnauthorized: false } });
  const sh = (line) => inContainer(NAME, line);
  sh(`cd ${DATA} && openssl req -x509 -newkey rsa:4096 -nodes -keyout private.pem -out cert.pem -days 30 -subj /CN=localhost 2>/dev/null; chown postgres private.pem cert.pem; chmod 644 private.pem`);
  sh(`printf "ssl = on\\nssl_cert_file = 'cert.pem'\\nssl_key_file = 'private.pem'\\n" >> ${DATA}/postgresql.conf`);
  spawnSync("docker", ["restart", NAME]);
  await pause(2500);
  const logs = spawnSync("docker", ["logs", "--tail", "6", NAME], { encoding: "utf8" });
  const badKey = `${logs.stdout}\n${logs.stderr}`.split("\n").find((l) => /private key file/.test(l))?.replace(/^\S+ \S+ \S+ \[\d+\] /, "") ?? "(no message)";
  const state = spawnSync("docker", ["inspect", "-f", "{{.State.Status}}", NAME], { encoding: "utf8" }).stdout.trim();
  // The server won't start with the key readable, so fix it from a helper container.
  spawnSync("docker", ["run", "--rm", "--volumes-from", NAME, "postgres:18", "chmod", "600", `${DATA}/private.pem`]);
  spawnSync("docker", ["start", NAME]);
  await ready();
  const on = await attempt({ ssl: { rejectUnauthorized: false } }, "SELECT ssl, version, cipher FROM pg_stat_ssl WHERE pid = pg_backend_pid()");
  const plain = await attempt({}, "SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()");
  const verify = await attempt({ ssl: { rejectUnauthorized: true } });
  // Only allow TLS from now on.
  sh(`sed -i 's/^host all all all scram-sha-256/hostssl all all all scram-sha-256/' ${DATA}/pg_hba.conf`);
  const c = client({ ssl: { rejectUnauthorized: false } });
  await c.connect();
  await c.query("SELECT pg_reload_conf()");
  await c.end();
  await pause(400);
  const refused = await attempt({});
  return {
    engine: await version("postgres"),
    blocks: [
      { cmd: "-- a new container, client asks for TLS", out: before },
      { cmd: "$ openssl req -x509 -newkey rsa:4096 -nodes -keyout private.pem -out cert.pem\n# ssl = on in postgresql.conf, key left readable by everyone (chmod 644)\n$ docker restart", out: `container state: ${state}\n${badKey}` },
      { cmd: "$ chmod 600 private.pem\n$ docker restart\n-- connect with TLS", out: on },
      { cmd: "-- connect without TLS: it's still allowed", out: plain },
      { cmd: "-- connect with TLS, checking the certificate", out: verify },
      { cmd: "# pg_hba.conf: host all all all  ->  hostssl all all all\n-- connect without TLS again", out: refused },
    ],
  };
}

// ---------------------------------------------------------------- the wire

const FRONTEND = { p: "PasswordMessage / SASL response", Q: "Query", X: "Terminate", P: "Parse", B: "Bind", E: "Execute", S: "Sync", D: "Describe" };
const BACKEND = {
  R: "Authentication",
  S: "ParameterStatus",
  K: "BackendKeyData",
  Z: "ReadyForQuery",
  T: "RowDescription",
  D: "DataRow",
  C: "CommandComplete",
  E: "ErrorResponse",
};
const AUTH = { 0: "AuthenticationOk", 10: "AuthenticationSASL", 11: "AuthenticationSASLContinue", 12: "AuthenticationSASLFinal" };

const printable = (buf) => buf.toString("latin1").replace(/[^\x20-\x7e]+/g, " ").trim();

function decodeFrontend(buf, first) {
  const out = [];
  let i = 0;
  if (first) {
    const len = buf.readInt32BE(0);
    const code = buf.readInt32BE(4);
    if (code === 80877103) out.push({ dir: "C", name: "SSLRequest", len, detail: "May we speak TLS?" });
    else out.push({ dir: "C", name: "StartupMessage", len, detail: printable(buf.subarray(8, len)) });
    i = len;
  }
  while (i < buf.length) {
    const type = String.fromCharCode(buf[i]);
    const len = buf.readInt32BE(i + 1);
    const body = buf.subarray(i + 5, i + 1 + len);
    out.push({ dir: "C", name: FRONTEND[type] ?? type, len: len + 1, detail: printable(body).slice(0, 120) });
    i += len + 1;
  }
  return out;
}

function decodeBackend(buf) {
  const out = [];
  let i = 0;
  while (i < buf.length) {
    const type = String.fromCharCode(buf[i]);
    const len = buf.readInt32BE(i + 1);
    const body = buf.subarray(i + 5, i + 1 + len);
    let name = BACKEND[type] ?? type;
    let detail = printable(body).slice(0, 120);
    if (type === "R") {
      name = AUTH[body.readInt32BE(0)] ?? name;
      detail = printable(body.subarray(4)).slice(0, 90);
    }
    out.push({ dir: "S", name, len: len + 1, detail });
    i += len + 1;
  }
  return out;
}

/** A logging TCP proxy: every byte between a real client and a real server passes through it. */
function proxy(onChunk) {
  const server = net.createServer((c) => {
    const up = net.connect(PORT, "127.0.0.1");
    c.on("data", (d) => {
      onChunk("C", d);
      up.write(d);
    });
    up.on("data", (d) => {
      onChunk("S", d);
      c.write(d);
    });
    const end = () => {
      c.destroy();
      up.destroy();
    };
    c.on("close", end);
    up.on("close", end);
    c.on("error", end);
    up.on("error", end);
  });
  return new Promise((r) => server.listen(PROXY, "127.0.0.1", () => r(server)));
}

async function capture(useTls) {
  const chunks = [];
  const server = await proxy((dir, data) => chunks.push({ dir, data: Buffer.from(data) }));
  const c = new pg.Client({ host: "127.0.0.1", port: PROXY, user: "postgres", password: "postgres", database: "postgres", ssl: useTls ? { rejectUnauthorized: false } : false });
  c.on("error", () => {});
  await c.connect();
  await c.query("SELECT 'my secret value' AS note");
  await c.end();
  await pause(150);
  server.close();
  return chunks;
}

async function wire() {
  const prepare = client({ ssl: { rejectUnauthorized: false } });
  await prepare.connect();
  inContainer(NAME, `sed -i 's/^hostssl all all all scram-sha-256/host all all all scram-sha-256/' ${DATA}/pg_hba.conf`);
  await prepare.query("SELECT pg_reload_conf()");
  await prepare.end();
  await pause(300);

  const plain = await capture(false);
  const messages = [];
  let first = true;
  for (const { dir, data } of plain) {
    try {
      if (dir === "C") {
        messages.push(...decodeFrontend(data, first));
        first = false;
      } else if (data.length === 1) {
        messages.push({ dir: "S", name: "SSL refused", len: 1, detail: data.toString() });
      } else messages.push(...decodeBackend(data));
    } catch {
      messages.push({ dir, name: "(split message)", len: data.length, detail: "" });
    }
  }
  const grouped = [];
  for (const m of messages) {
    const last = grouped[grouped.length - 1];
    if (last && m.name === "ParameterStatus" && last.name === "ParameterStatus") {
      last.count = (last.count ?? 1) + 1;
      last.len += m.len;
      last.detail = `${last.count} settings, such as server_version and TimeZone`;
    } else grouped.push({ ...m });
  }
  const seenPlain = Buffer.concat(plain.map((c) => c.data)).includes("my secret value");

  const secure = await capture(true);
  const tlsRecord = (b) => ({ 20: "ChangeCipherSpec", 21: "Alert", 22: "Handshake", 23: "ApplicationData" })[b[0]] ?? `0x${b[0].toString(16)}`;
  const tlsMessages = secure.map(({ dir, data }, i) => {
    if (i === 0) return { dir, name: "SSLRequest", len: data.length, detail: "May we speak TLS?" };
    if (data.length === 1) return { dir, name: data.toString() === "S" ? "SSL accepted" : "SSL refused", len: 1, detail: `'${data.toString()}'` };
    return { dir, name: `TLS ${tlsRecord(data)}`, len: data.length, detail: data.subarray(0, 12).toString("hex").replace(/(..)/g, "$1 ").trim() + " …" };
  });
  const seenTls = Buffer.concat(secure.map((c) => c.data)).includes("my secret value");
  return {
    engine: await version("postgres"),
    plain: { messages: grouped, secretVisible: seenPlain },
    tls: { messages: tlsMessages, secretVisible: seenTls },
  };
}

async function loginErrors() {
  const errors = [];
  for (const [label, config] of [["wrong password", { password: "nope" }], ["unknown user", { user: "ghost" }], ["unknown database", { database: "ghost" }]]) {
    const c = client({ ...config, ssl: false });
    try {
      await c.connect();
    } catch (e) {
      errors.push(`${label}: ${e.severity} ${e.code} "${e.message}" (${e.file}:${e.line}, ${e.routine})`);
    }
    await c.end().catch(() => {});
  }
  const c = client({ ssl: false });
  await c.connect();
  const enc = (await c.query("SHOW password_encryption")).rows[0].password_encryption;
  const hash = (await c.query("SELECT left(rolpassword, 30) AS hash FROM pg_authid WHERE rolname = 'postgres'")).rows[0].hash;
  await c.end();
  spawnSync("docker", ["rm", "-f", NAME]);
  return {
    engine: await version("postgres"),
    blocks: [
      { cmd: "SHOW password_encryption;\nSELECT left(rolpassword, 30) FROM pg_authid WHERE rolname = 'postgres';", out: `${enc}\n${hash}…` },
      { cmd: "-- three failed logins, and everything the server sent back", out: errors.join("\n") },
    ],
  };
}

let tlsDone;
const tlsLab = () => (tlsDone ??= tls());

/** A query built by string concatenation, on a real server, at growing sizes. */
async function bigQuery() {
  await start("postgres");
  const db = await freshDb("postgres");
  const c = new pg.Client({ host: "127.0.0.1", port: ENGINES.postgres.port, user: "postgres", password: "postgres", database: db });
  c.on("error", () => {});
  await c.connect();
  await c.query("CREATE TABLE t (id int PRIMARY KEY, v text); INSERT INTO t SELECT g, 'x' FROM generate_series(1, 1000000) g");
  await c.query("VACUUM ANALYZE t");
  const lines = [];
  const orSeries = [];
  const anySeries = [];
  for (const n of [100, 1000, 10000, 100000, 1000000]) {
    const sql = `SELECT count(*) FROM t WHERE ${Array.from({ length: n }, (_, i) => `id = ${i + 1}`).join(" OR ")}`;
    const bytes = Buffer.byteLength(sql);
    let result;
    const start_ = process.hrtime.bigint();
    try {
      await c.query(sql);
      const ms = Number(process.hrtime.bigint() - start_) / 1e6;
      orSeries.push([n, +ms.toFixed(1)]);
      result = `ok in ${ms.toFixed(0)} ms`;
    } catch (e) {
      result = `failed: ${e.message}`;
    }
    const ids = Array.from({ length: n }, (_, i) => i + 1);
    const t2 = process.hrtime.bigint();
    await c.query("SELECT count(*) FROM t WHERE id = ANY($1::int[])", [ids]);
    const ms2 = Number(process.hrtime.bigint() - t2) / 1e6;
    anySeries.push([n, +ms2.toFixed(1)]);
    lines.push(`${String(n).padStart(9)} ids  ${(bytes / 1024).toFixed(0).padStart(7)} KB of SQL  ~${String(Math.ceil(bytes / 1460)).padStart(6)} TCP segments  ${result}`);
  }
  await c.end();
  await dropDb("postgres", db);
  return { lines, orSeries, anySeries };
}

let big;
const bigLab = () => (big ??= bigQuery());

/** Just enough BSON to read a reply: documents, strings, numbers, booleans, dates, ids. */
function bson(buf, start = 0) {
  const end = start + buf.readInt32LE(start);
  const out = {};
  let i = start + 4;
  while (i < end - 1) {
    const type = buf[i++];
    const stop = buf.indexOf(0, i);
    const name = buf.toString("utf8", i, stop);
    i = stop + 1;
    if (type === 0x01) {
      out[name] = buf.readDoubleLE(i);
      i += 8;
    } else if (type === 0x02) {
      const n = buf.readInt32LE(i);
      out[name] = buf.toString("utf8", i + 4, i + 3 + n);
      i += 4 + n;
    } else if (type === 0x03 || type === 0x04) {
      const n = buf.readInt32LE(i);
      out[name] = bson(buf, i);
      i += n;
    } else if (type === 0x07) {
      out[name] = buf.toString("hex", i, i + 12);
      i += 12;
    } else if (type === 0x08) {
      out[name] = buf[i] === 1;
      i += 1;
    } else if (type === 0x09) {
      out[name] = new Date(Number(buf.readBigInt64LE(i))).toISOString();
      i += 8;
    } else if (type === 0x10) {
      out[name] = buf.readInt32LE(i);
      i += 4;
    } else if (type === 0x12) {
      out[name] = Number(buf.readBigInt64LE(i));
      i += 8;
    } else throw new Error(`bson type ${type}`);
  }
  return out;
}

async function mongoWire() {
  await start("mongo");
  const doc = (() => {
    const name = (s) => Buffer.from(`${s}\0`);
    const hello = Buffer.concat([Buffer.from([0x10]), name("hello"), Buffer.from([1, 0, 0, 0])]);
    const value = Buffer.from("admin\0");
    const len = Buffer.alloc(4);
    len.writeInt32LE(value.length);
    const db = Buffer.concat([Buffer.from([0x02]), name("$db"), len, value]);
    const body = Buffer.concat([hello, db, Buffer.from([0])]);
    const size = Buffer.alloc(4);
    size.writeInt32LE(body.length + 4);
    return Buffer.concat([size, body]);
  })();
  const header = Buffer.alloc(16);
  const total = 16 + 4 + 1 + doc.length;
  header.writeInt32LE(total, 0);
  header.writeInt32LE(1, 4);
  header.writeInt32LE(0, 8);
  header.writeInt32LE(2013, 12);
  const message = Buffer.concat([header, Buffer.alloc(4), Buffer.from([0]), doc]);
  const reply = await new Promise((done, no) => {
    const s = net.connect(ENGINES.mongo.port, "127.0.0.1", () => s.write(message));
    let got = Buffer.alloc(0);
    s.on("data", (d) => {
      got = Buffer.concat([got, d]);
      if (got.length >= 4 && got.length >= got.readInt32LE(0)) {
        s.destroy();
        done(got);
      }
    });
    s.on("error", no);
  });
  const body = bson(reply, 21);
  return {
    engine: await version("mongo"),
    blocks: [
      {
        cmd: `-- a hand-built OP_MSG for { hello: 1, $db: "admin" }, ${message.length} bytes`,
        out: `${message.toString("hex").replace(/(..)/g, "$1 ").trim().slice(0, 96)} …`,
      },
      {
        cmd: "-- the reply's header, then fields of its BSON document",
        out: [
          `length ${reply.readInt32LE(0)}, responseTo ${reply.readInt32LE(8)}, opCode ${reply.readInt32LE(12)} (OP_MSG)`,
          `isWritablePrimary: ${body.isWritablePrimary}`,
          `maxBsonObjectSize: ${body.maxBsonObjectSize}`,
          `maxMessageSizeBytes: ${body.maxMessageSizeBytes}`,
          `minWireVersion: ${body.minWireVersion}, maxWireVersion: ${body.maxWireVersion}`,
          `readOnly: ${body.readOnly}`,
        ].join("\n"),
      },
    ],
  };
}

const spec = {
  runs: {
    tls: tlsLab,
    "login-errors": async () => {
      await wireLab();
      return loginErrors();
    },
    "mongo-wire": mongoWire,
    "big-query": async () => ({
      engine: await version("postgres"),
      blocks: [{ cmd: "-- SELECT count(*) FROM t WHERE id = 1 OR id = 2 OR ...", out: (await bigLab()).lines.join("\n") }],
    }),
    "least-privilege": {
      setup: [
        "DROP ROLE IF EXISTS dbread",
        "DROP ROLE IF EXISTS dbcreate",
        "DROP ROLE IF EXISTS dbdelete",
        "CREATE TABLE todos (id serial PRIMARY KEY, text text)",
        "INSERT INTO todos (text) VALUES ('first')",
        "CREATE ROLE dbread LOGIN",
        "CREATE ROLE dbcreate LOGIN",
        "CREATE ROLE dbdelete LOGIN",
        "GRANT SELECT ON todos TO dbread",
        "GRANT INSERT ON todos TO dbcreate",
        "GRANT DELETE ON todos TO dbdelete",
      ],
      sql: `SET ROLE dbcreate;
INSERT INTO todos (text) VALUES ('second');
RESET ROLE;
GRANT USAGE ON SEQUENCE todos_id_seq TO dbcreate;
SET ROLE dbcreate;
INSERT INTO todos (text) VALUES ('second') RETURNING id;
INSERT INTO todos (text) VALUES ('third');
SELECT * FROM todos;
RESET ROLE;
SET ROLE dbdelete;
DELETE FROM todos WHERE id = 1;
RESET ROLE;
GRANT SELECT ON todos TO dbdelete;
SET ROLE dbdelete;
DELETE FROM todos WHERE id = 1;
RESET ROLE;
SET ROLE dbread;
DELETE FROM todos;
CREATE TABLE IF NOT EXISTS app_table (id int);`,
    },
    injection: {
      setup: ["DROP ROLE IF EXISTS dbread", "CREATE TABLE todos (id serial PRIMARY KEY, text text)", "INSERT INTO todos (text) VALUES ('a'), ('b')", "CREATE TABLE users (id int, password text)", "INSERT INTO users VALUES (1, 'hunter2')", "CREATE ROLE dbread LOGIN", "GRANT SELECT ON todos TO dbread"],
      sql: `-- the app builds: SELECT * FROM todos WHERE id = ` + "'" + ` + input + ` + "'" + `
SELECT * FROM todos WHERE id = 1 OR 1 = 1;
SELECT id, text FROM todos WHERE id = 0 UNION SELECT id, password FROM users;
SET ROLE dbread;
SELECT id, text FROM todos WHERE id = 0 UNION SELECT id, password FROM users;
DROP TABLE todos;`,
    },
  },

  charts: {
    "big-query": async () => {
      const b = await bigLab();
      return {
        engine: await version("postgres"),
        title: "One huge OR, or one array parameter",
        alt: "Time to count rows matching a list of ids, for lists from 100 to a million ids. A query text built from OR clauses takes far longer to parse and plan as it grows. Passing the same ids as one array parameter stays much faster.",
        x: { label: "ids in the list", log: true },
        y: { label: "time", log: true, unit: "ms" },
        series: [
          { name: "id = 1 OR id = 2 …", points: b.orSeries },
          { name: "id = ANY($1)", points: b.anySeries },
        ],
      };
    },
  },

  data: {
    wire: () => wireLab(),
  },

  playgrounds: {
    roles: {
      title: "Least privilege, tested",
      hint: "A role that can only insert. Each preset is a surprise from the course: read the error, then grant the missing right.",
      mayFail: true,
      setup: `CREATE TABLE todos (id serial PRIMARY KEY, text text);
INSERT INTO todos (text) VALUES ('first');
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'dbcreate2') THEN CREATE ROLE dbcreate2; END IF;
  EXECUTE format('GRANT USAGE ON SCHEMA %I TO dbcreate2', current_schema());
END $$;
GRANT INSERT ON todos TO dbcreate2;`,
      query: `SET ROLE dbcreate2;
INSERT INTO todos (text) VALUES ('second');`,
      presets: [
        { label: "Grant the sequence", sql: `RESET ROLE;
GRANT USAGE ON SEQUENCE todos_id_seq TO dbcreate2;
SET ROLE dbcreate2;
INSERT INTO todos (text) VALUES ('second');` },
        { label: "Try RETURNING", sql: `SET ROLE dbcreate2;
INSERT INTO todos (text) VALUES ('third') RETURNING id;` },
        { label: "Can it read?", sql: `SET ROLE dbcreate2;
SELECT * FROM todos;` },
        { label: "Who can do what", sql: `RESET ROLE;
SELECT grantee, privilege_type FROM information_schema.role_table_grants WHERE table_name = 'todos' AND grantee <> 'postgres';` },
      ],
    },
  },
};

let wireDone;
function wireLab() {
  return (wireDone ??= (async () => {
    await tlsLab();
    return wire();
  })());
}

export default spec;
