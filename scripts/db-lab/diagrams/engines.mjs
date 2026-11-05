import { AMBER, FAINT, GREEN, INK, MUTED, RED } from "../canvas.mjs";

const post = {
  slug: "db-engines-and-cursors",
  diagrams: {
    "engine-layer": {
      alt: "A database management system is layers. Client connections, SQL parsing, planning and replication sit on top. The storage engine underneath handles the low-level job of putting rows on disk and getting them back. MySQL lets you swap that bottom layer, per table.",
      draw(c) {
        c.size(720, 280).title("The engine is the bottom layer");
        c.box(180, 56, 360, 44, "connections, SQL parser, planner, replication", { tone: "raised", size: 12 });
        c.arrow([360, 100], [360, 128], { color: MUTED, both: true });
        c.box(180, 130, 360, 50, "storage engine API", { tone: "cream", size: 12.5 });
        const names = ["InnoDB", "MyISAM", "RocksDB", "Memory"];
        names.forEach((n, i) => {
          c.box(80 + i * 144, 200, 128, 44, n, { tone: i === 0 ? "green" : "plain", size: 12 });
          c.line([360, 180], [144 + i * 144, 200], { color: FAINT });
        });
      },
    },

    "myisam-vs-innodb": {
      alt: "How the two MySQL engines find a row. In MyISAM, indexes point straight to a byte offset in a data file, and locks cover the whole table. In InnoDB, the table is stored in the primary key's tree, secondary indexes hold the primary key, and locks cover single rows.",
      draw(c) {
        c.size(720, 270).title("Two engines, one server");
        c.text(20, 56, "MyISAM", { size: 13, weight: 700 });
        const i1 = c.box(20, 70, 130, 56, "index", { tone: "cream", lines: "key → byte offset" });
        const f1 = c.box(210, 70, 140, 56, ".MYD file", { tone: "raised", lines: "rows in a flat file" });
        c.arrow(i1.right, f1.left, { color: AMBER });
        c.para(20, 156, "Table locks. No transactions. No crash recovery. Fast inserts at the end of the file.", { width: 330, size: 12, fill: INK });
        c.text(380, 56, "InnoDB", { size: 13, weight: 700 });
        const i2 = c.box(380, 70, 130, 56, "secondary index", { tone: "cream", lines: "key → primary key" });
        const f2 = c.box(560, 70, 140, 56, "primary key tree", { tone: "green", lines: "rows in the leaves" });
        c.arrow(i2.right, f2.left, { color: AMBER });
        c.para(380, 156, "Row locks. ACID transactions. Crash recovery. Foreign keys.", { width: 320, size: 12, fill: INK });
        c.line([365, 40], [365, 240], { color: FAINT, dash: "3 4" });
      },
    },

    "lsm-write-path": {
      alt: "An LSM tree's write path. A write goes to a log on disk and a sorted memtable in memory, and returns. When the memtable fills it's flushed to an immutable sorted file at level 0. Background compaction merges files into larger sorted runs at lower levels.",
      draw(c) {
        c.size(720, 260).title("An LSM tree never updates in place");
        c.box(20, 70, 100, 60, "write", { tone: "plain" });
        c.box(170, 40, 130, 50, "log", { tone: "green", lines: "append only" });
        const mem = c.box(170, 110, 130, 50, "memtable", { tone: "amber", lines: "sorted, in RAM" });
        const l0 = c.box(346, 110, 96, 50, "level 0", { tone: "cream", lines: "sorted files" });
        const l1 = c.box(506, 110, 90, 50, "level 1", { tone: "raised", lines: "merged" });
        const l2 = c.box(620, 110, 80, 50, "level 2", { tone: "raised" });
        c.arrow([120, 88], [168, 68]);
        c.arrow([120, 112], [168, 132]);
        c.arrow(mem.right, l0.left, { label: "flush" });
        c.arrow(l0.right, l1.left, { label: "compact" });
        c.arrow(l1.right, l2.left);
        c.para(170, 200, "Writes are sequential, which is why it's fast and gentle on SSDs. Reads may check several files, and compaction rewrites data in the background.", { width: 530 });
        c.flow("write", "log", "", "data");
        c.flow("write", "memtable", "", "data");
        c.flow("memtable", "level 0", "flush", "data");
        c.flow("level 0", "level 1", "compact", "metadata");
      },
    },

    "engine-family": {
      alt: "A family tree of database engines. B-tree engines include MyISAM, Aria, InnoDB, XtraDB, SQLite and Berkeley DB. LSM engines include LevelDB, its fork RocksDB, and the MyRocks engine for MySQL, which is built on RocksDB.",
      draw(c) {
        c.size(720, 250).title("Two families of engine");
        const left = [["MyISAM", "cream"], ["Aria", "cream"], ["InnoDB", "green"], ["XtraDB", "green"], ["SQLite", "raised"], ["Berkeley DB", "raised"]];
        c.box(20, 54, 330, 36, "B-tree family: update pages in place", { tone: "amber", size: 12 });
        left.forEach(([n, tone], i) => c.box(20 + (i % 3) * 112, 100 + Math.floor(i / 3) * 48, 106, 40, n, { tone, size: 11.5 }));
        c.box(370, 54, 330, 36, "LSM family: append, then merge", { tone: "amber", size: 12 });
        const l = c.box(370, 100, 106, 40, "LevelDB", { tone: "cream", size: 11.5 });
        const r = c.box(482, 100, 106, 40, "RocksDB", { tone: "cream", size: 11.5 });
        const m = c.box(594, 100, 106, 40, "MyRocks", { tone: "cream", size: 11.5 });
        c.arrow(l.right, r.left, { color: MUTED });
        c.arrow(r.right, m.left, { color: MUTED });
        c.para(370, 170, "RocksDB is a fork of LevelDB, and MyRocks plugs it into MySQL.", { width: 330, size: 12, fill: INK });
      },
    },

    "cursor-kinds": {
      alt: "A client-side cursor against a server-side cursor. Client-side: the server runs the query and sends every row, and the client holds them all in memory. Server-side: the server keeps the query open in a transaction and sends a batch when asked, so the client uses little memory, and the server holds state.",
      draw(c) {
        c.size(720, 240).title("Who holds the result?");
        const a = c.box(20, 70, 110, 60, "client", { tone: "red", lines: "all rows in memory" });
        const b = c.box(240, 70, 110, 60, "server", { tone: "plain", lines: "query finished" });
        c.arrow(b.left, a.right, { label: "everything", color: RED });
        const d = c.box(380, 70, 110, 60, "client", { tone: "green", lines: "one batch" });
        const e = c.box(590, 70, 110, 60, "server", { tone: "amber", lines: "cursor stays open" });
        c.arrow(d.right, e.left, { label: "FETCH 50", color: GREEN });
        c.para(20, 160, "Simple and stateless. Costs client memory, and the first row waits for the last.", { width: 330, size: 12, fill: INK });
        c.para(380, 160, "Starts fast. Holds a transaction and server state, so it ties you to one connection.", { width: 320, size: 12, fill: INK });
        c.line([365, 44], [365, 220], { color: FAINT, dash: "3 4" });
      },
    },

    "summary-map": {
      alt: "A map of this post in three columns. Engines: a swappable layer that stores rows, MyISAM against InnoDB. LSM trees: append, flush, compact, with real LevelDB. Cursors: client-side holds everything, server-side streams and keeps state.",
      draw(c) {
        c.size(720, 260).title("The post on one page");
        const cols = [
          ["Engines", "cream", ["The layer that stores rows", "MyISAM: fast, unsafe", "InnoDB: ACID, row locks"]],
          ["LSM trees", "amber", ["Append, flush, compact", "Deletes are tombstones", "Trade read work for writes"]],
          ["Cursors", "green", ["Client-side: everything at once", "Server-side: batches, and state", "Open cursors hold transactions"]],
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
