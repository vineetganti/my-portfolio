// Post 2: how tables and indexes sit on disk.
import { dropDb, freshDb, inContainer, session, version } from "../lab.mjs";

const employees = `CREATE TABLE employees (id int PRIMARY KEY, first_name text, last_name text, ssn text, dob date, salary int);
INSERT INTO employees
SELECT g, 'first' || g, 'last' || g, lpad(g::text, 9, '0'), date '1990-01-01' + (g % 9000), 40000 + (g * 37) % 60000
FROM generate_series(1, 100000) g;
ANALYZE employees;`;

/** Follows one 8 KB page through inserts, an update, a delete and a vacuum, from pageinspect. */
async function pageSteps() {
  const db = await freshDb("postgres");
  const s = await session("postgres").open(db);
  await s.run("CREATE EXTENSION pageinspect");
  await s.run("CREATE TABLE t (id int, name text) WITH (autovacuum_enabled = off, fillfactor = 100)");
  const snapshot = async (label, caption) => {
    await s.run("CHECKPOINT");
    const h = await s.run("SELECT lower, upper, special, pagesize FROM page_header(get_raw_page('t', 0))");
    const r = await s.run(`SELECT lp, lp_off, lp_len, lp_flags, t_xmin::text, t_xmax::text, t_ctid::text,
        CASE WHEN t_data IS NULL THEN NULL ELSE length(t_data) END AS data_len
      FROM heap_page_items(get_raw_page('t', 0)) ORDER BY lp`);
    const rows = await s.run("SELECT ctid::text, id, name FROM t ORDER BY ctid");
    const [lower, upper, special, pagesize] = h.rows[0];
    return {
      label,
      caption,
      lower,
      upper,
      special,
      pagesize,
      items: r.rows.map(([lp, off, len, flags, xmin, xmax, ctid]) => ({ lp, off, len, flags, xmin, xmax, ctid })),
      rows: rows.rows,
    };
  };
  await s.run("INSERT INTO t VALUES (1, 'Ana')");
  const steps = [await snapshot("Insert a row", "A new table has no pages at all, so the first INSERT creates page 0. The page starts with a 24-byte header. The row lands at the very end of the page, and a 4-byte line pointer at the front says where it is. lower marks where the pointers stop and upper where the rows start, and free space is the gap between them.")];
  await s.run("INSERT INTO t VALUES (2, 'Ben')");
  steps.push(await snapshot("Insert another", "Row 2 goes just before row 1. Its address is its ctid: page 0, line pointer 2."));
  await s.run("INSERT INTO t VALUES (3, 'A much longer name than the others')");
  steps.push(await snapshot("A wider row", "Row sizes vary, so you can't compute where row 3 starts from its number. The line pointer is what makes a ctid usable: it holds the row's offset and length."));
  await s.run("UPDATE t SET name = 'Benjamin' WHERE id = 2");
  steps.push(await snapshot("Update row 2", "An UPDATE writes a whole new row version. The old one stays, marked with xmax, and points at its replacement. Nothing was overwritten."));
  await s.run("DELETE FROM t WHERE id = 1");
  steps.push(await snapshot("Delete row 1", "A DELETE removes nothing. It only stamps xmax on the row, which still takes up space, because an older snapshot may still need it."));
  await s.run("VACUUM t");
  steps.push(await snapshot("VACUUM", "Now the dead versions are gone and the live rows are packed back together at the end of the page. Line pointer 1 is free for reuse, and pointer 2 redirects to the current row so an index entry for it stays valid."));
  await s.close();
  await dropDb("postgres", db);
  return { engine: await version("postgres"), steps };
}

/** How many rows of a given width fit in one page, by filling one and counting. */
async function rowsPerPage() {
  const db = await freshDb("postgres");
  const s = await session("postgres").open(db);
  const points = [];
  for (const width of [4, 16, 32, 64, 128, 256, 512, 1024, 2000]) {
    await s.run("DROP TABLE IF EXISTS w");
    const type = width === 4 ? "int" : "text";
    await s.run(`CREATE TABLE w (v ${type}) WITH (autovacuum_enabled = off)`);
    await s.run("ALTER TABLE w ALTER COLUMN v SET STORAGE PLAIN");
    const value = width === 4 ? "1" : `repeat('x', ${width})`;
    await s.run(`INSERT INTO w SELECT ${value} FROM generate_series(1, 2000)`);
    const r = await s.run("SELECT count(*)::int FROM w WHERE (ctid::text::point)[0] = 0");
    points.push([width, r.rows[0][0]]);
  }
  await s.close();
  await dropDb("postgres", db);
  return {
    engine: await version("postgres"),
    title: "Rows that fit in one 8 KB page",
    alt: "Measured rows per 8 KB Postgres page against the width of the row's data. Rows of 4 bytes fit 226 to a page. The count falls as rows widen, to 4 rows at 2000 bytes each.",
    x: { label: "bytes of data in each row", log: true },
    y: { label: "rows per page", log: true },
    series: [{ name: "rows per page", points }],
  };
}

/** Reads a real table's file at a real offset, the way the database's own read works. */
async function fileOffset() {
  const db = await freshDb("postgres");
  const s = await session("postgres").open(db);
  await s.run("CREATE TABLE test (id int, name text)");
  await s.run("INSERT INTO test SELECT g, 'row ' || g FROM generate_series(1, 5000) g");
  await s.run("CHECKPOINT");
  const path = (await s.run("SELECT pg_relation_filepath('test')")).rows[0][0];
  const pages = (await s.run("SELECT pg_relation_size('test') / 8192")).rows[0][0];
  const file = `/var/lib/postgresql/18/docker/${path}`;
  const size = inContainer("dbe-pg", `stat -c '%s bytes' ${file}`).trim();
  const dd = inContainer("dbe-pg", `dd if=${file} bs=8192 skip=2 count=8 status=none | wc -c`).trim();
  const first = (await s.run("SELECT min(ctid::text) FROM test WHERE (ctid::text::point)[0] = 2")).rows[0][0];
  await s.close();
  await dropDb("postgres", db);
  const shown = path.replace(/\d+\/\d+$/, "<db>/<table>");
  return {
    engine: await version("postgres"),
    blocks: [
      { cmd: "SELECT pg_relation_filepath('test');", out: shown },
      { cmd: "$ stat -c '%s bytes' <that file>", out: `${size}, which is ${pages} pages of 8192 bytes` },
      { cmd: "# pages 2 through 9: skip 2 pages, read 8\n$ dd if=<that file> bs=8192 skip=2 count=8 | wc -c", out: dd },
      { cmd: "SELECT min(ctid::text) FROM test WHERE page = 2;", out: `${first}   (the first row those bytes hold)` },
    ],
  };
}

const spec = {
  runs: {
    "page-size": {
      sql: `SHOW block_size;
`,
    },
    "page-size-mysql": {
      engine: "mysql",
      sql: "SELECT @@innodb_page_size;",
    },
    "file-offset": fileOffset,
    buffers: {
      setup: employees.split(";\n").filter(Boolean),
      sql: `SELECT relpages, reltuples::int FROM pg_class WHERE relname = 'employees';
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF, TIMING OFF, SUMMARY OFF) SELECT salary FROM employees WHERE id = 5000;
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF, TIMING OFF, SUMMARY OFF) SELECT sum(salary) FROM employees;`,
    },
    "heap-order": {
      sql: `CREATE TABLE people (id int PRIMARY KEY, name text);
INSERT INTO people VALUES (3, 'Cara'), (1, 'Ana'), (2, 'Ben');
SELECT ctid, id, name FROM people;`,
    },
    "clustered-order": {
      engine: "mysql",
      sql: `CREATE TABLE people (id int PRIMARY KEY, name text);
INSERT INTO people VALUES (3, 'Cara'), (1, 'Ana'), (2, 'Ben');
SELECT id, name FROM people;`,
    },
    "secondary-pg": {
      setup: [
        "CREATE TABLE users (id int PRIMARY KEY, email text, bio text)",
        "CREATE INDEX ON users (email)",
        "INSERT INTO users SELECT g, 'user' || g || '@example.com', repeat('x', 100) FROM generate_series(1, 50000) g",
        "VACUUM ANALYZE users",
      ],
      sql: `EXPLAIN (COSTS OFF) SELECT id FROM users WHERE email = 'user42@example.com';`,
    },
    "secondary-mysql": {
      engine: "mysql",
      setup: [
        "CREATE TABLE users (id int PRIMARY KEY, email varchar(100), bio text, KEY idx_email (email))",
        "INSERT INTO users SELECT g, concat('user', g, '@example.com'), repeat('x', 100) FROM (WITH RECURSIVE s(g) AS (SELECT 1 UNION ALL SELECT g + 1 FROM s WHERE g < 1000) SELECT g FROM s) n",
        "ANALYZE TABLE users",
      ],
      sql: `EXPLAIN SELECT id FROM users WHERE email = 'user42@example.com';`,
    },
    toast: {
      sql: `CREATE TABLE doc (id int, body text);
INSERT INTO doc VALUES (1, repeat('database ', 200000));
SELECT pg_size_pretty(pg_column_size(body)::bigint) AS stored, pg_size_pretty(octet_length(body)::bigint) AS original FROM doc;
SELECT pg_size_pretty(pg_relation_size('doc')) AS main_table, pg_size_pretty(pg_relation_size(reltoastrelid)) AS toast_table FROM pg_class WHERE relname = 'doc';`,
    },
    "index-special": {
      sql: `CREATE EXTENSION pageinspect;
CREATE TABLE t (id int PRIMARY KEY);
INSERT INTO t SELECT generate_series(1, 1000);
SELECT lower, upper, special FROM page_header(get_raw_page('t', 0));
SELECT lower, upper, special FROM page_header(get_raw_page('t_pkey', 1));`,
    },
    "column-proxy": {
      setup: [
        "CREATE TABLE emp_rows AS SELECT g AS id, md5(g::text) AS first_name, md5((g * 2)::text) AS last_name, md5((g * 3)::text) AS address, (g * 37) % 100000 AS salary FROM generate_series(1, 200000) g",
        "CREATE TABLE emp_salary_column AS SELECT salary FROM emp_rows",
        "VACUUM ANALYZE emp_rows",
        "VACUUM ANALYZE emp_salary_column",
      ],
      sql: `SELECT relname, relpages FROM pg_class WHERE relname IN ('emp_rows', 'emp_salary_column') ORDER BY relpages DESC;
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF, TIMING OFF, SUMMARY OFF) SELECT sum(salary) FROM emp_rows;
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF, TIMING OFF, SUMMARY OFF) SELECT sum(salary) FROM emp_salary_column;`,
    },
  },

  charts: {
    "rows-per-page": rowsPerPage,
  },

  data: {
    "page-steps": pageSteps,
  },

  playgrounds: {
    ctid: {
      title: "Every row has an address",
      hint: "ctid is (page, line pointer). Watch a row's address change when you update it, and see which rows share a page.",
      setup: `CREATE TABLE t (id int, name text);
INSERT INTO t SELECT g, 'row ' || g FROM generate_series(1, 1000) g;
ANALYZE t;`,
      query: `SELECT ctid, id, name FROM t ORDER BY id LIMIT 5;`,
      presets: [
        { label: "How many pages?", sql: `SELECT relpages, reltuples::int, pg_size_pretty(pg_relation_size('t')) AS size
FROM pg_class WHERE oid = 't'::regclass;` },
        { label: "Rows per page", sql: `SELECT (ctid::text::point)[0]::int AS page, count(*) AS rows
FROM t GROUP BY 1 ORDER BY 1 LIMIT 8;` },
        { label: "Update moves the row", sql: `SELECT ctid, id, name FROM t WHERE id = 1;
UPDATE t SET name = 'changed' WHERE id = 1;
SELECT ctid, id, name FROM t WHERE id = 1;` },
        { label: "Pages touched", sql: `EXPLAIN (ANALYZE, BUFFERS, COSTS OFF, TIMING OFF, SUMMARY OFF)
SELECT * FROM t;` },
      ],
    },
    inspect: {
      title: "Open a real page",
      hint: "pageinspect reads the raw bytes of a page. Try the presets, then delete or update a row and look again.",
      setup: `CREATE TABLE t (id int, name text) WITH (autovacuum_enabled = off);
INSERT INTO t VALUES (1, 'Ana'), (2, 'Ben'), (3, 'A much longer name than the others');`,
      query: `SELECT lower, upper, special, pagesize
FROM page_header(get_raw_page('t', 0));`,
      presets: [
        { label: "Line pointers", sql: `SELECT lp, lp_off, lp_len, t_xmin, t_xmax, t_ctid
FROM heap_page_items(get_raw_page('t', 0));` },
        { label: "Update a row, look again", sql: `UPDATE t SET name = 'Benjamin' WHERE id = 2;
SELECT lp, lp_off, lp_len, t_xmin, t_xmax, t_ctid
FROM heap_page_items(get_raw_page('t', 0));` },
        { label: "Vacuum it, look again", sql: `VACUUM t;
SELECT lp, lp_off, lp_len, lp_flags, t_xmin, t_xmax, t_ctid
FROM heap_page_items(get_raw_page('t', 0));` },
      ],
    },
  },
};

export default spec;
