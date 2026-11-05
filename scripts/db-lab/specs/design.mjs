// Post 10: system design, with the course's tables built and measured.
import { createHash } from "node:crypto";
import { dropDb, freshDb, session, version } from "../lab.mjs";

const FOLLOWS = [
  "CREATE TABLE follows (follower bigint NOT NULL, followee bigint NOT NULL, PRIMARY KEY (follower, followee))",
  "CREATE INDEX follows_followee ON follows (followee, follower)",
  // One celebrity with 1,000,000 followers, and 100,000 ordinary users following 20 each.
  "INSERT INTO follows SELECT g, 1 FROM generate_series(2, 1000001) g",
  "INSERT INTO follows SELECT u, 2 + (u * 7 + k * 13) % 100000 FROM generate_series(2, 100001) u, generate_series(1, 20) k ON CONFLICT DO NOTHING",
  "VACUUM ANALYZE follows",
];

/** Short codes are hash prefixes: how many collide as the table fills? */
async function collisions() {
  const series = [];
  for (const chars of [4, 5, 6, 8]) {
    const seen = new Set();
    let clashes = 0;
    const points = [];
    for (let i = 1; i <= 1000000; i++) {
      const code = createHash("sha256").update(`https://example.com/${i}`).digest("base64url").slice(0, chars);
      if (seen.has(code)) clashes++;
      else seen.add(code);
      if ([1000, 10000, 50000, 100000, 250000, 500000, 1000000].includes(i)) points.push([i, clashes]);
    }
    series.push({ name: `${chars} characters`, points: points.map(([x, y]) => [x, Math.max(y, 0.5)]) });
  }
  return {
    engine: "1,000,000 real SHA-256 hashes",
    title: "Clashes as short codes fill up",
    alt: "The number of colliding short codes as a million URLs are hashed and cut to 4, 5, 6 or 8 characters. By a million URLs, four characters had about 29,000 clashes, five had 436, six had 8, and eight had none, which is drawn at the bottom of the scale.",
    x: { label: "URLs shortened", log: true },
    y: { label: "collisions so far", log: true, zeroAt: 0.5 },
    series,
  };
}

/** Home timeline: pull at read time, or push at write time? */
async function timeline() {
  const db = await freshDb("postgres");
  const s = await session("postgres").open(db);
  await s.run("CREATE TABLE tweets (id bigserial PRIMARY KEY, author bigint, body text, at timestamptz DEFAULT now())");
  await s.run("CREATE INDEX tweets_author ON tweets (author, id DESC)");
  await s.run("INSERT INTO tweets (author, body) SELECT g % 10000, 'tweet ' || g FROM generate_series(1, 2000000) g");
  await s.run("CREATE TABLE follows (follower bigint, followee bigint, PRIMARY KEY (follower, followee))");
  await s.run("CREATE TABLE timelines (user_id bigint, tweet_id bigint, PRIMARY KEY (user_id, tweet_id))");
  await s.run("VACUUM ANALYZE tweets");
  const pull = [];
  for (const n of [10, 100, 500, 1000, 5000]) {
    await s.run("TRUNCATE follows");
    await s.run(`INSERT INTO follows SELECT 1, g FROM generate_series(0, ${n - 1}) g`);
    await s.run("ANALYZE follows");
    const sql = `SELECT t.id, t.author, t.body FROM follows f CROSS JOIN LATERAL (SELECT * FROM tweets t WHERE t.author = f.followee ORDER BY t.id DESC LIMIT 20) t WHERE f.follower = 1 ORDER BY t.id DESC LIMIT 20`;
    await s.run(sql);
    const times = [];
    for (let i = 0; i < 5; i++) {
      const start = process.hrtime.bigint();
      await s.run(sql);
      times.push(Number(process.hrtime.bigint() - start) / 1e6);
    }
    pull.push([n, +times.sort((a, b) => a - b)[2].toFixed(2)]);
  }
  const push = [];
  for (const n of [10, 100, 1000, 10000, 100000, 1000000]) {
    await s.run("TRUNCATE timelines");
    const start = process.hrtime.bigint();
    await s.run(`INSERT INTO timelines SELECT g, 1 FROM generate_series(1, ${n}) g`);
    push.push([n, +(Number(process.hrtime.bigint() - start) / 1e6).toFixed(2)]);
  }
  await s.close();
  await dropDb("postgres", db);
  const engine = await version("postgres");
  return {
    pull: {
      engine,
      title: "Reading a timeline by asking everyone you follow",
      alt: "Time to build a home timeline at read time, from a table of two million tweets, as the number of accounts followed grows from 10 to 5,000. The time grows with the number of accounts.",
      x: { label: "accounts followed", log: true },
      y: { label: "time per timeline read", log: true, unit: "ms" },
      series: [{ name: "pull at read time", points: pull }],
    },
    push: {
      engine,
      title: "Writing one tweet into every follower's timeline",
      alt: "Time to copy one tweet into every follower's timeline, as the follower count grows from 10 to a million. It grows in step with the followers, reaching seconds for a celebrity.",
      x: { label: "followers", log: true },
      y: { label: "time per tweet", log: true, unit: "ms" },
      series: [{ name: "push at write time", points: push }],
    },
  };
}

let cached;
const timelines = () => (cached ??= timeline());

const spec = {
  runs: {
    "follow-queries": {
      setup: FOLLOWS,
      sql: `\\timing on
SELECT count(*) AS followers FROM follows WHERE followee = 1;
SELECT count(*) AS following FROM follows WHERE follower = 2;
SELECT EXISTS (SELECT 1 FROM follows WHERE follower = 2 AND followee = 1) AS am_i_following;
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF, TIMING OFF, SUMMARY OFF) SELECT count(*) FROM follows WHERE followee = 1;
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF, TIMING OFF, SUMMARY OFF) SELECT EXISTS (SELECT 1 FROM follows WHERE follower = 2 AND followee = 1);`,
    },
    "url-v1": {
      sql: `CREATE TABLE urls (id bigserial PRIMARY KEY, long_url text NOT NULL);
INSERT INTO urls (long_url) VALUES ('https://example.com/a'), ('https://example.com/b') RETURNING id;
SELECT long_url FROM urls WHERE id = 2;`,
    },
    "url-v2": {
      sql: `CREATE TABLE urls (short_url char(8) PRIMARY KEY, long_url text NOT NULL);
INSERT INTO urls VALUES (left(encode(sha256('https://example.com/a'::bytea), 'base64'), 8), 'https://example.com/a') RETURNING short_url;
INSERT INTO urls VALUES (left(encode(sha256('https://example.com/a'::bytea), 'base64'), 8), 'https://example.com/a');
INSERT INTO urls VALUES (left(encode(sha256('https://example.com/a'::bytea), 'base64'), 8), 'https://example.com/a') ON CONFLICT (short_url) DO NOTHING;`,
    },
  },

  charts: {
    collisions,
    "timeline-pull": async () => (await timelines()).pull,
    "timeline-push": async () => (await timelines()).push,
  },

  playgrounds: {
    follows: {
      title: "The follows table",
      hint: "One row per follow, with an index for each direction. Try the Follow button's query, and see what a counter would save.",
      setup: `CREATE TABLE follows (follower bigint NOT NULL, followee bigint NOT NULL, PRIMARY KEY (follower, followee));
CREATE INDEX follows_followee ON follows (followee, follower);
INSERT INTO follows SELECT g, 1 FROM generate_series(2, 100001) g;
VACUUM ANALYZE follows;`,
      query: `SELECT count(*) AS followers FROM follows WHERE followee = 1;`,
      presets: [
        { label: "Am I following?", sql: `EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF, SUMMARY OFF)
SELECT EXISTS (SELECT 1 FROM follows WHERE follower = 500 AND followee = 1);` },
        { label: "Who follows me? Page 1", sql: "SELECT follower FROM follows WHERE followee = 1 ORDER BY follower LIMIT 5;" },
        { label: "Follow twice", sql: `INSERT INTO follows VALUES (500, 1) ON CONFLICT DO NOTHING;
SELECT count(*) FROM follows WHERE follower = 500;` },
      ],
    },
    shortener: {
      title: "Two short URL designs",
      hint: "Generated ids are easy and guessable. Hash codes are unguessable and can collide. Try both.",
      setup: `CREATE TABLE urls (id bigserial PRIMARY KEY, long_url text NOT NULL);
CREATE TABLE codes (code char(8) PRIMARY KEY, long_url text NOT NULL);`,
      query: `INSERT INTO urls (long_url) VALUES ('https://example.com/my-page') RETURNING id;`,
      presets: [
        { label: "Hash it", sql: `INSERT INTO codes VALUES (left(encode(sha256('https://example.com/my-page'::bytea), 'base64'), 8), 'https://example.com/my-page')
ON CONFLICT (code) DO NOTHING RETURNING code;` },
        { label: "Look it up", sql: "SELECT * FROM codes;" },
      ],
    },
  },
};

export default spec;
