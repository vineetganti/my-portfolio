import { AMBER, FAINT, GREEN, MUTED, RED } from "../canvas.mjs";

const post = {
  slug: "db-how-data-sits-on-disk",
  diagrams: {
    "logical-to-physical": {
      alt: "A logical table of employee rows on the left, each with an internal row id. On the right the same rows packed into fixed-size pages, three rows to a page, so that 1,001 rows need 334 pages. The collection of pages is the heap.",
      draw(c) {
        c.size(720, 280).title("What you see, and what's stored");
        c.text(20, 60, "The table you query", { size: 12, weight: 700 });
        const rows = ["1  Ana", "2  Ben", "3  Cara", "4  Dev", "5  Eli", "6  Fay"];
        rows.forEach((r, i) => c.box(20, 70 + i * 28, 150, 24, "", { tone: "plain" }) && c.text(32, 86 + i * 28, r, { size: 11.5, mono: true }));
        c.arrow([180, 150], [244, 150], { color: AMBER, label: "stored as" });
        c.text(254, 60, "The heap: a file of fixed-size pages", { size: 12, weight: 700 });
        [0, 1, 2].forEach((p) => {
          const x = 254 + p * 152;
          c.rect(x, 70, 144, 112, { tone: "cream", rx: 8 });
          c.text(x + 10, 88, `page ${p}`, { size: 11, weight: 700, fill: AMBER });
          if (p < 2) rows.slice(p * 3, p * 3 + 3).forEach((r, i) => c.text(x + 12, 110 + i * 22, r, { size: 11.5, mono: true }));
          else {
            c.text(x + 72, 130, "…", { size: 20, anchor: "middle", fill: MUTED });
          }
        });
        c.para(254, 208, "One read fetches a whole page, so asking for row 2 brings rows 1 and 3 along. With 3 rows to a page, 1,001 rows need 334 pages.", { width: 450 });
      },
    },

    "read-path": {
      alt: "The path of a read. The query asks the buffer pool for a page. If the page is there, no I/O happens. Otherwise the database asks the operating system for the file, offset and length. The OS checks its own file cache, and only on a miss does the read reach the disk. The page travels back up into the buffer pool.",
      draw(c) {
        c.size(720, 250).title("A read tries two caches before it reaches the disk");
        const q = c.box(20, 90, 110, 70, "query", { tone: "plain", lines: "needs row 42" });
        const pool = c.box(180, 90, 150, 70, "buffer pool", { tone: "cream", lines: "the database's memory" });
        const os = c.box(380, 90, 140, 70, "OS file cache", { tone: "neutral", lines: "the kernel's memory" });
        const disk = c.box(570, 90, 130, 70, "disk", { tone: "raised", lines: "file + offset + length" });
        c.arrow(q.right, pool.left, { label: "page?" });
        c.arrow(pool.right, os.left, { label: "miss" });
        c.arrow(os.right, disk.left, { label: "miss" });
        c.para(180, 186, "Found here: no I/O at all", { width: 150, size: 11, fill: GREEN, weight: 700 });
        c.para(380, 186, "Found here: an I/O call, but no disk read", { width: 140, size: 11, fill: AMBER, weight: 700 });
        c.para(570, 186, "Found here: a real read, the slow case", { width: 130, size: 11, fill: RED, weight: 700 });
        c.flow("query", "buffer pool", "page?", "request");
        c.flow("buffer pool", "OS file cache", "miss", "request");
        c.flow("OS file cache", "disk", "miss", "request");
      },
    },

    "write-path": {
      alt: "The path of a write. The database reads the page into the buffer pool and changes the row in memory, which makes the page dirty. It also appends a small log record and forces that to disk, which is what makes the commit durable. The page itself stays in memory, can take many more writes, and is flushed to its file later.",
      draw(c) {
        c.size(720, 250).title("A write changes memory now and the data file later");
        c.box(20, 90, 110, 70, "UPDATE", { tone: "plain", lines: "one row" });
        const page = c.box(190, 60, 170, 70, "page in buffer pool", { tone: "amber", lines: "dirty: differs from disk" });
        const log = c.box(190, 160, 170, 60, "log record", { tone: "green", lines: "small, written at commit" });
        const file = c.box(500, 60, 200, 70, "data file", { tone: "raised", lines: "many changes, one write, later" });
        const wal = c.box(500, 160, 200, 60, "WAL file", { tone: "green", lines: "appended and fsynced" });
        c.arrow([130, 110], [188, 95], { label: "" });
        c.arrow([130, 140], [188, 188], { label: "" });
        c.arrow(page.right, file.left, { dash: "6 4", label: "at a checkpoint" });
        c.arrow(log.right, wal.left, { color: GREEN, label: "at COMMIT", labelFill: GREEN });
        c.flow("UPDATE", "page in buffer pool", "", "data");
        c.flow("UPDATE", "log record", "", "data");
        c.flow("log record", "WAL file", "at COMMIT", "data");
        c.flow("page in buffer pool", "data file", "at a checkpoint", "metadata");
      },
    },

    "heap-vs-clustered": {
      alt: "Two ways to find a row by a secondary key. In Postgres every index is separate from the heap: the index entry holds the row's address, and one more step reads the row from the heap. In InnoDB the table is itself a tree ordered by primary key: a secondary index entry holds the primary key value, and a second tree walk finds the row inside the clustered index.",
      draw(c) {
        c.size(720, 300).title("Finding a row by email");
        c.text(20, 56, "Postgres: a heap and separate indexes", { size: 12.5, weight: 700 });
        const a = c.box(20, 70, 150, 70, "email index", { tone: "cream", lines: "entry: email → (page, item)" });
        const h = c.box(220, 70, 130, 70, "heap", { tone: "green", lines: "rows, in no order" });
        c.arrow(a.right, h.left, { color: AMBER, label: "ctid" });
        c.para(20, 170, "The address is physical. If the row moves, every index on the table may need a new entry.", { width: 330 });
        c.text(390, 56, "InnoDB: the table is the primary key's tree", { size: 12.5, weight: 700 });
        const b = c.box(390, 70, 140, 70, "email index", { tone: "cream", lines: "entry: email → primary key" });
        const k = c.box(570, 70, 130, 70, "primary key tree", { tone: "green", lines: "leaf pages hold whole rows" });
        c.arrow(b.right, k.left, { color: AMBER, label: "id" });
        c.para(390, 170, "The address is logical. Rows can move freely, and every secondary lookup pays a second tree walk. A wide primary key makes every index wider.", { width: 310 });
        c.line([372, 40], [372, 280], { color: FAINT, dash: "3 4" });
      },
    },

    "disk-kinds": {
      alt: "Two kinds of disk. A hard disk reads and writes sectors, and moves a head to reach them, so random access is slow. An SSD has no moving parts, reads and writes pages inside erase blocks, can't overwrite a page in place, and remaps writes to fresh pages, wearing out cells slowly.",
      draw(c) {
        c.size(720, 260).title("What's under the page");
        const hdd = c.box(20, 60, 330, 170, "", { tone: "raised" });
        c.text(hdd.cx, 84, "Hard disk (HDD)", { size: 13, weight: 700, anchor: "middle" });
        c.circle(90, 150, 52, { tone: "neutral" });
        c.circle(90, 150, 30, { tone: "plain" });
        c.circle(90, 150, 6, { tone: "cream" });
        c.line([90, 150], [150, 108], { color: AMBER, width: 2.5 });
        c.para(166, 110, "A spinning platter and a moving head. Reads are addressed by block, and a far-away block costs a seek. Rewriting the same block is fine.", { width: 175 });
        const ssd = c.box(370, 60, 330, 170, "", { tone: "raised" });
        c.text(ssd.cx, 84, "Solid-state drive (SSD)", { size: 13, weight: 700, anchor: "middle" });
        for (let b = 0; b < 2; b++) {
          c.rect(386 + b * 72, 104, 64, 92, { tone: "neutral", rx: 4 });
          for (let p = 0; p < 4; p++) c.rect(392 + b * 72, 110 + p * 21, 52, 16, { tone: b === 0 && p === 1 ? "red" : p === 2 && b === 1 ? "green" : "plain", rx: 2 });
        }
        c.text(386, 210, "erase block", { size: 10, fill: FAINT });
        c.para(536, 110, "No moving parts, so random reads are cheap. A page can't be overwritten: a rewrite goes to a fresh page, and the old one waits for its block to be erased.", { width: 158 });
      },
    },

    "summary-map": {
      alt: "A map of this post in four columns. Pages: fixed size, the unit of every read and write, and an address of file plus offset. Inside a page: header, line pointers, rows, special space. Tables: a heap with separate indexes in Postgres, a clustered tree in InnoDB. Layout: row stores for transactions, column stores for analytics.",
      draw(c) {
        c.size(720, 280).title("The post on one page");
        const cols = [
          ["Pages", "cream", ["Fixed size: 8 KB or 16 KB", "The unit of every I/O", "file + page × size"]],
          ["Inside a page", "amber", ["Header, pointers, rows", "ctid = page, pointer", "Updates add versions"]],
          ["Tables", "green", ["Postgres: heap + indexes", "InnoDB: clustered on the key", "Secondary: address or key"]],
          ["Layout", "raised", ["Row store: whole rows", "Column store: one column", "Match it to the workload"]],
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
