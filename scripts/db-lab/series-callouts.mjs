// Writes the series list into every Database Engineering post, between the two marker comments, with
// the current post in bold. Run it after adding or renaming a post.
import fs from "node:fs";
import path from "node:path";

const POSTS = [
  ["db-acid-transactions", "Transactions and ACID", "what a database promises, and how isolation levels bend it."],
  ["db-how-data-sits-on-disk", "How data sits on disk", "pages, heaps, row and column stores, clustered tables."],
  ["db-indexes-and-query-plans", "Indexes and query plans", "reading EXPLAIN the way the planner thinks."],
  ["db-bloom-filters-and-uuids", "Bloom filters, billion-row tables and UUIDs", "skipping work, and the keys that hurt."],
  ["db-btrees-and-bplus-trees", "B-Trees and B+Trees", "the structure under nearly every index."],
  ["db-partitioning", "Partitioning", "one logical table, many physical ones."],
  ["db-sharding", "Sharding and consistent hashing", "splitting data across servers."],
  ["db-locks-and-connection-pools", "Locks, deadlocks and connection pools", "double bookings, pagination and pools."],
  ["db-replication-and-cap", "Replication and CAP", "copies, lag and what you give up."],
  ["db-system-design", "System design from the database up", "a Twitter feature and a URL shortener."],
  ["db-engines-and-cursors", "Engines and cursors", "MyISAM, InnoDB, LSM trees, and reading results in pieces."],
  ["db-mongo-memcached-redis", "Inside MongoDB, Memcached and Redis", "how the NoSQL engines store things."],
  ["db-security", "Database security", "TLS, the wire protocol, least privilege, homomorphic encryption."],
  ["db-postgres-mysql-internals", "Inside Postgres and MySQL", "processes, WAL, MVCC, and why Uber moved."],
];

const START = "{/* series:start */}";
const END = "{/* series:end */}";
const NOTE =
  "Notes from Hussein Nasser's course [Fundamentals of Database Engineering](https://www.udemy.com/course/database-engines-crash-course/). The structure is the course's; the explanations and examples are rewritten, every demo is re-run for real, and the labels say what was verified: [how to read this series](/blog/db-acid-transactions#how-to-read-this-series).";

function callout(slug) {
  const items = POSTS.map(([s, title, blurb], i) => {
    const n = String(i + 1).padStart(2, "0");
    return s === slug ? `${i + 1}. **${n} · ${title}** (this post): ${blurb}` : `${i + 1}. [${n} · ${title}](/blog/${s}): ${blurb}`;
  });
  return `<Callout type="info" title="The Database Engineering series">\n\n${items.join("\n")}\n\n${NOTE}\n\n</Callout>`;
}

const dir = path.join(process.cwd(), "content/blog");
for (const [slug] of POSTS) {
  const file = path.join(dir, `${slug}.mdx`);
  if (!fs.existsSync(file)) continue;
  const text = fs.readFileSync(file, "utf8");
  const a = text.indexOf(START);
  const b = text.indexOf(END);
  if (a === -1 || b === -1) throw new Error(`${slug}: no series markers`);
  fs.writeFileSync(file, `${text.slice(0, a + START.length)}\n\n${callout(slug)}\n\n${text.slice(b)}`);
}
