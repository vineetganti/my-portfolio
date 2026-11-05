import { FAINT, GREEN, INK, MUTED } from "../canvas.mjs";

const post = {
  slug: "db-mongo-memcached-redis",
  diagrams: {
    "mongo-eras": {
      alt: "Three ways MongoDB has found a document. With MMAPv1 the _id index held a direct file location, one index walk. With WiredTiger the _id index holds a record id, and a second tree maps that to the document, two walks. A clustered collection stores documents in the _id tree itself, one walk.",
      draw(c) {
        c.size(720, 300).title("Three eras of finding a document by _id");
        const row = (y, name, tone, parts, note) => {
          c.text(20, y + 26, name, { size: 12.5, weight: 700 });
          let prev;
          parts.forEach(([label, w], i) => {
            const x = i === 0 ? 170 : prev.x + prev.w + 34;
            const b = c.box(x, y, w, 42, label, { tone: i === parts.length - 1 ? tone : "cream", size: 11 });
            if (prev) c.arrow(prev.right, b.left);
            prev = b;
          });
          c.text(170, y + 60, note, { size: 11, fill: MUTED });
        };
        row(56, "MMAPv1", "raised", [["_id index", 120], ["file + offset", 130]], "One tree walk, then a direct read. Removed in 4.2.");
        row(134, "WiredTiger", "raised", [["_id index", 120], ["recordId tree", 130], ["document", 100]], "Two tree walks, and the recordId stays small.");
        row(212, "Clustered", "green", [["_id tree with documents", 240]], "One tree walk. Secondary indexes hold _id instead, as in InnoDB.");
      },
    },

    "cache-aside": {
      alt: "The usual way to use a cache. The application asks the cache first. On a hit it's done. On a miss it reads the database, stores the result in the cache, and returns it.",
      draw(c) {
        c.size(720, 230).title("A cache sits beside the database");
        c.box(40, 90, 130, 60, "application", { tone: "plain" });
        c.box(300, 40, 150, 60, "Memcached", { tone: "amber", lines: "RAM, expires" });
        c.box(300, 140, 150, 60, "database", { tone: "cream", lines: "source of truth" });
        c.arrow([170, 106], [298, 74], { label: "1. get", both: true, labelDy: -8 });
        c.arrow([170, 134], [298, 166], { label: "2. on a miss", color: FAINT, labelDy: 16 });
        c.para(490, 76, "No server-to-server traffic at all: the client decides which server holds a key.", { width: 210, size: 12, fill: INK });
        c.flow("application", "Memcached", "1. get", "request");
        c.flow("Memcached", "application", "", "metadata");
        c.flow("application", "database", "2. on a miss", "request");
      },
    },

    "redis-durability": {
      alt: "Redis durability options. A write lands in memory. RDB saves a snapshot of everything from time to time, so a crash loses what came after the last snapshot. AOF appends every command to a log, flushed every second or on each write, so a crash loses at most a moment or nothing, at more cost.",
      draw(c) {
        c.size(720, 260).title("Redis keeps data in memory, and optionally on disk");
        const w = c.box(20, 90, 100, 60, "SET", { tone: "plain" });
        const m = c.box(180, 90, 120, 60, "memory", { tone: "amber", lines: "the real store" });
        c.box(390, 40, 150, 60, "RDB snapshot", { tone: "cream", lines: "everything, now and then" });
        c.box(390, 140, 150, 60, "AOF", { tone: "green", lines: "every command" });
        c.arrow(w.right, m.left);
        c.arrow([300, 106], [388, 74], { dash: "6 4" });
        c.arrow([300, 134], [388, 166], { color: GREEN });
        c.para(560, 56, "Loses everything since the last save.", { width: 150, size: 12, fill: INK });
        c.para(560, 156, "Loses up to a second, or nothing, by fsync policy.", { width: 150, size: 12, fill: INK });
        c.flow("SET", "memory", "", "data");
        c.flow("memory", "AOF", "", "data");
      },
    },

    "three-tools": {
      alt: "Three tools compared. MongoDB is a durable document database on disk. Memcached is a volatile key-value cache in memory, with no persistence and no server-to-server traffic. Redis is an in-memory data structure server with optional persistence, replication and clustering.",
      draw(c) {
        c.size(720, 250).title("Three different jobs");
        const cols = [
          ["MongoDB", "green", ["Documents on disk", "Indexes, queries, durability", "A primary database"]],
          ["Memcached", "amber", ["Keys and values in RAM", "Gone on restart", "A cache and nothing more"]],
          ["Redis", "cream", ["Data structures in RAM", "Optional persistence", "A cache, or a small store"]],
        ];
        cols.forEach(([name, tone, items], i) => {
          const x = 20 + i * 232;
          c.box(x, 56, 216, 46, name, { tone, size: 13.5 });
          items.forEach((t, j) => c.text(x + 8, 130 + j * 26, t, { size: 12.5, fill: INK }));
        });
      },
    },

    "summary-map": {
      alt: "A map of this post in three columns. MongoDB: BSON documents, WiredTiger pages, clustered collections remove a tree walk. Memcached: slabs, LRU, and client-side hashing. Redis: single-threaded commands, RESP, RDB and AOF, with measured data loss.",
      draw(c) {
        c.size(720, 260).title("The post on one page");
        const cols = [
          ["MongoDB", "green", ["WiredTiger is a B-tree", "_id then recordId: two walks", "Clustered: one walk"]],
          ["Memcached", "amber", ["Slabs avoid fragmentation", "LRU evicts per class", "Clients do the hashing"]],
          ["Redis", "cream", ["One thread runs commands", "RDB or AOF for durability", "Real crashes lost real keys"]],
        ];
        cols.forEach(([name, tone, items], i) => {
          const x = 20 + i * 230;
          c.box(x, 56, 220, 44, name, { tone, size: 13.5 });
          items.forEach((t, j) => c.box(x, 108 + j * 42, 220, 36, "", { tone: "plain", lines: t, small: 11 }));
        });
      },
    },
  },
};

export default post;
