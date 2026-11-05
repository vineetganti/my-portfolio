import { AMBER, GREEN, INK, MUTED, RED } from "../canvas.mjs";

const post = {
  slug: "db-locks-and-connection-pools",
  diagrams: {
    "lock-matrix": {
      alt: "Which row locks conflict. A shared lock is compatible with another shared lock, so many readers can hold it together. A shared lock conflicts with an exclusive lock, and an exclusive lock conflicts with both. In Postgres a plain SELECT takes neither.",
      draw(c) {
        c.size(720, 230).title("Which locks can share a row?");
        c.box(180, 60, 150, 40, "shared held", { tone: "neutral", size: 11.5 });
        c.box(336, 60, 150, 40, "exclusive held", { tone: "neutral", size: 11.5 });
        c.box(20, 106, 154, 44, "ask for shared", { tone: "neutral", size: 11.5 });
        c.box(20, 156, 154, 44, "ask for exclusive", { tone: "neutral", size: 11.5 });
        c.box(180, 106, 150, 44, "allowed", { tone: "green", size: 12 });
        c.box(336, 106, 150, 44, "wait", { tone: "red", size: 12 });
        c.box(180, 156, 150, 44, "wait", { tone: "red", size: 12 });
        c.box(336, 156, 150, 44, "wait", { tone: "red", size: 12 });
        c.para(506, 112, "A plain SELECT in Postgres takes neither, so it's never in this table.", { width: 200, size: 12, fill: INK });
      },
    },

    "two-phase-locking": {
      alt: "Two-phase locking. In the first phase a transaction only acquires locks, and the number it holds rises. In the second it only releases them. In strict two-phase locking, as in real databases, all locks are held until commit and released together.",
      draw(c) {
        c.size(720, 240).title("Two-phase locking: acquire, then release");
        c.line([60, 190], [680, 190], { color: MUTED, width: 1.2 });
        c.text(60, 208, "BEGIN", { size: 11, fill: MUTED });
        c.text(680, 208, "COMMIT", { size: 11, fill: MUTED, anchor: "end" });
        c.text(24, 120, "locks held", { size: 11, fill: MUTED, rotate: -90, anchor: "middle" });
        c.route([[60, 190], [130, 190], [130, 150], [240, 150], [240, 110], [370, 110], [370, 74], [660, 74], [660, 188]], { color: AMBER, width: 2.2 });
        c.text(235, 66, "acquire phase", { size: 12, weight: 700, fill: AMBER, anchor: "middle" });
        c.text(520, 66, "held until the end", { size: 12, weight: 700, fill: GREEN, anchor: "middle" });
        c.para(380, 120, "Real databases hold locks until COMMIT, so nobody reads a value that might still roll back.", { width: 270, size: 11.5 });
      },
    },

    "deadlock-cycle": {
      alt: "A deadlock. Session A holds row 20 and waits for row 21. Session B holds row 21 and waits for row 20. Each is waiting for the other, so neither can move until the database aborts one.",
      draw(c) {
        c.size(720, 240).title("A deadlock is a cycle of waits");
        c.box(90, 80, 150, 60, "session A", { tone: "cream", lines: "holds row 20" });
        c.box(480, 80, 150, 60, "session B", { tone: "cream", lines: "holds row 21" });
        c.arrow([240, 96], [478, 96], { color: RED, label: "wants row 21", width: 2 });
        c.arrow([480, 126], [242, 126], { color: RED, label: "wants row 20", labelDy: 18, width: 2 });
        c.para(90, 186, "Neither can finish. After deadlock_timeout (1 second by default), a waiting backend checks for a cycle, and the one that finds it aborts itself.", { width: 540, size: 12, fill: INK });
      },
    },

    "offset-vs-keyset": {
      alt: "Two ways to fetch page 1,000 of a list. OFFSET walks past 10,000 rows, reading each, and throws them away before returning ten. Keyset pagination uses the last id seen to jump straight to the right place in the index and reads only ten rows.",
      draw(c) {
        c.size(720, 260).title("Getting page 1,000 of a list, ten rows a page");
        c.text(20, 62, "OFFSET 10000 LIMIT 10", { size: 12, weight: 700, mono: true });
        for (let i = 0; i < 26; i++) c.rect(20 + i * 26, 72, 22, 24, { tone: i < 23 ? "red" : "green", rx: 2 });
        c.para(20, 118, "Reads every skipped row, and throws them away. The work grows with the page number.", { width: 680 });
        c.text(20, 158, "WHERE id < 12345 ORDER BY id DESC LIMIT 10", { size: 12, weight: 700, mono: true });
        for (let i = 0; i < 26; i++) c.rect(20 + i * 26, 168, 22, 24, { tone: i < 23 ? "plain" : "green", rx: 2 });
        c.route([[40, 204], [620, 204], [620, 194]], { color: GREEN, label: "one index descent", labelAt: [330, 204], labelDy: 14 });
      },
    },

    "pool-lifecycle": {
      alt: "A connection pool. Requests borrow a ready connection, run a query and return it, so the TCP and authentication cost is paid once. When all connections are busy, new requests wait in a queue. A request that never returns its connection shrinks the pool.",
      draw(c) {
        c.size(720, 280).title("A pool: pay for the connection once");
        const reqs = c.box(20, 100, 120, 70, "requests", { tone: "plain", lines: "many, short" });
        const queue = c.box(190, 100, 110, 70, "queue", { tone: "amber", lines: "waiting for a free one" });
        const pool = c.box(350, 60, 170, 150, "", { tone: "raised" });
        c.text(pool.cx, 82, "pool", { size: 13, weight: 700, anchor: "middle" });
        [0, 1, 2].forEach((i) => c.box(366, 94 + i * 36, 138, 30, i === 0 ? "busy" : "idle", { tone: i === 0 ? "cream" : "green", size: 11 }));
        const db = c.box(570, 100, 130, 70, "database", { tone: "cream", lines: "a process per connection" });
        c.arrow(reqs.right, queue.left);
        c.arrow(queue.right, [348, 135]);
        c.arrow([520, 135], db.left, { both: true, color: AMBER });
        c.para(20, 238, "Forget to return a connection and the pool quietly shrinks, until every request waits forever.", { width: 680, weight: 700, fill: RED });
        c.flow("requests", "queue", "", "request");
        c.flow("queue", "pool", "", "request");
        c.flow("pool", "database", "", "data");
      },
    },

    "pessimistic-optimistic": {
      alt: "Two approaches to concurrency. Pessimistic control locks first, so a second transaction waits and then proceeds: never a failure, less concurrency. Optimistic control lets both run and checks at the end, so one may fail and retry: more concurrency, and the application needs retry logic.",
      draw(c) {
        c.size(720, 240).title("Assume conflict, or assume none?");
        const cols = [
          ["Pessimistic", "amber", ["Take the lock first", "Others wait", "Nothing fails, things queue", "Postgres, MySQL row locks"]],
          ["Optimistic", "green", ["Work without locks", "Check at commit", "A conflict means retry", "SERIALIZABLE, version columns"]],
        ];
        cols.forEach(([name, tone, items], i) => {
          const x = 20 + i * 350;
          c.box(x, 56, 330, 42, name, { tone, size: 13.5 });
          items.forEach((t, j) => c.text(x + 12, 124 + j * 26, t, { size: 12.5 }));
        });
      },
    },

    "summary-map": {
      alt: "A map of this post in four columns. Locks: shared and exclusive, held until commit, plain reads take none in Postgres. Deadlocks: a cycle of waits, detected after a second, and the victim depends on timing. Double booking: lock the read, or put the check in the update. Pagination and pools: keyset beats offset, and pools need a release on every path.",
      draw(c) {
        c.size(720, 280).title("The post on one page");
        const cols = [
          ["Locks", "cream", ["Shared and exclusive", "Held until commit", "Plain reads take none"]],
          ["Deadlocks", "red", ["A cycle of waits", "Detected after a second", "Timing picks the victim"]],
          ["Double booking", "amber", ["Reads alone don't protect", "FOR UPDATE, or check in UPDATE", "Levels change the behaviour"]],
          ["At scale", "green", ["Keyset, not OFFSET", "Reuse connections", "Release on every path"]],
        ];
        cols.forEach(([name, tone, items], i) => {
          const x = 20 + i * 172;
          c.box(x, 56, 164, 44, name, { tone, size: 13.5 });
          items.forEach((t, j) => c.box(x, 108 + j * 40, 164, 34, "", { tone: "plain", lines: t, small: 10.5 }));
        });
      },
    },
  },
};

export default post;
