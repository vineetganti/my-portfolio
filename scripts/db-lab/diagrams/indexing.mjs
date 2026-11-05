import { AMBER, FAINT, GREEN, INK, MUTED, RED } from "../canvas.mjs";

const post = {
  slug: "db-indexes-and-query-plans",
  diagrams: {
    "index-as-a-book": {
      alt: "An index compared with the phone book. Finding a name in the table without an index means reading every page. With an index, a small sorted structure points straight to the row's page, and only that page is read.",
      draw(c) {
        c.size(720, 250).title("Why an index helps: read less");
        c.text(20, 62, "No index: read every page", { size: 12.5, weight: 700 });
        for (let i = 0; i < 10; i++) c.rect(20 + i * 30, 72, 24, 34, { tone: "red", rx: 3 });
        c.para(20, 128, "The database checks each row in turn, and finds that rows match only by reading them.", { width: 300 });
        c.text(380, 62, "With an index: follow a sorted structure", { size: 12.5, weight: 700 });
        const idx = c.box(380, 72, 120, 44, "index", { tone: "cream", lines: "sorted, small" });
        for (let i = 0; i < 10; i++) c.rect(380 + i * 30, 146, 24, 34, { tone: i === 6 ? "green" : "plain", rx: 3 });
        c.route([[idx.right[0], 94], [572, 94], [572, 144]], { color: AMBER, label: "row address", labelAt: [572, 94], labelDy: -6 });
        c.para(380, 204, "A few index pages, then one heap page, instead of the whole table. The price: an index takes space, and every write has to update it.", { width: 320 });
      },
    },

    "scan-spectrum": {
      alt: "The three scans on a spectrum of how much of the table matches. Few rows: an index scan, with one random heap visit per row. A moderate share: a bitmap scan, visiting each page once in physical order. Most of the table: a sequential scan, reading every page in order.",
      draw(c) {
        c.size(720, 230).title("Which scan? It depends on how much matches");
        c.arrow([40, 66], [680, 66], { color: FAINT, label: "more of the table matches", labelAt: 0.5, labelDy: -6, labelFill: MUTED });
        const items = [
          ["Index Scan", "green", "few rows", "walk the index, jump to the heap for each row", "random reads, one per row"],
          ["Bitmap Heap Scan", "amber", "a moderate share", "note the pages first, then read each page once", "sorted reads, each page once"],
          ["Seq Scan", "red", "most of the table", "read every page in order, filter as you go", "sequential reads, no index"],
        ];
        items.forEach(([name, tone, when, how, io], i) => {
          const x = 20 + i * 232;
          c.box(x, 84, 216, 54, name, { tone, lines: when, size: 13 });
          c.para(x + 4, 158, how, { width: 208, size: 11.5, fill: INK });
          c.para(x + 4, 202, io, { width: 208, size: 11, fill: MUTED });
        });
      },
    },

    "bitmap-scan": {
      alt: "How a bitmap scan works. Phase one walks the index and sets a bit for each heap page that holds a match, without touching the table. Phase two reads only the marked pages, in order, each one once, and rechecks the condition, because a page holds other rows too.",
      draw(c) {
        c.size(720, 280).title("A bitmap scan works in two phases");
        const idx = c.box(20, 90, 130, 64, "index", { tone: "cream", lines: "x < 2000" });
        c.text(220, 76, "phase 1: a bit per heap page", { size: 11.5, weight: 700, fill: AMBER });
        const bits = [0, 1, 0, 1, 1, 0, 0, 1];
        bits.forEach((b, i) => {
          c.rect(220 + i * 28, 90, 24, 30, { tone: b ? "amber" : "plain", rx: 3 });
          c.text(232 + i * 28, 110, b, { size: 12, weight: 700, anchor: "middle", fill: b ? INK : FAINT });
        });
        c.arrow(idx.right, [218, 105], { color: AMBER });
        c.text(220, 246, "phase 2: read marked pages, in order, once each", { size: 11.5, weight: 700, fill: GREEN });
        bits.forEach((b, i) => {
          c.rect(220 + i * 28, 182, 24, 44, { tone: b ? "green" : "neutral", rx: 3 });
          if (b) c.arrow([232 + i * 28, 122], [232 + i * 28, 180], { color: GREEN, width: 1.2 });
        });
        c.para(470, 96, "No table access yet. Bitmaps from two indexes can be ANDed or ORed here.", { width: 230 });
        c.para(470, 190, "A page holds other rows, so each row is rechecked. That's the Recheck Cond line in EXPLAIN.", { width: 230 });
      },
    },

    "bitmap-and-or": {
      alt: "Combining two indexes. A bitmap from the index on a and a bitmap from the index on b are combined before the table is read. AND keeps pages marked in both, which leaves very few. OR keeps pages marked in either, which leaves many more.",
      draw(c) {
        c.size(720, 230).title("Two indexes, one trip to the heap");
        const row = (y, label, bits, tone) => {
          c.text(20, y + 19, label, { size: 12, weight: 700 });
          bits.forEach((b, i) => c.rect(150 + i * 26, y, 22, 28, { tone: b ? tone : "plain", rx: 3 }));
        };
        const A = [1, 0, 1, 1, 0, 0, 1, 0];
        const B = [0, 0, 1, 0, 1, 0, 1, 1];
        row(60, "a = 70", A, "amber");
        row(96, "b = 40", B, "amber");
        c.text(390, 78, "AND", { size: 13, weight: 700, fill: GREEN });
        row(60, "", [], "green");
        A.forEach((a, i) => c.rect(440 + i * 26, 60, 22, 28, { tone: a && B[i] ? "green" : "plain", rx: 3 }));
        c.text(392, 114, "OR", { size: 13, weight: 700, fill: RED });
        A.forEach((a, i) => c.rect(440 + i * 26, 96, 22, 28, { tone: a || B[i] ? "red" : "plain", rx: 3 }));
        c.para(150, 160, "Each index is searched once, and the bits are combined in memory. AND leaves a tiny set of pages to read. OR leaves the union, so it does more work on every side.", { width: 520 });
      },
    },

    "index-only": {
      alt: "An index-only scan. The index has the value, but it doesn't know whether that row version is visible to this transaction. So it checks the visibility map, one bit per heap page. If the page is all-visible the answer comes straight from the index. If not, the scan visits the heap, and EXPLAIN counts that as a heap fetch.",
      draw(c) {
        c.size(720, 260).title("Why an index-only scan can still visit the table");
        const idx = c.box(20, 90, 140, 66, "index", { tone: "cream", lines: "has the value, not its visibility" });
        const vm = c.box(230, 90, 160, 66, "visibility map", { tone: "amber", lines: "one bit per heap page" });
        c.box(470, 60, 230, 54, "answer from the index", { tone: "green", lines: "Heap Fetches stays 0" });
        c.box(470, 150, 230, 54, "visit the heap", { tone: "red", lines: "Heap Fetches goes up" });
        c.arrow(idx.right, vm.left);
        c.arrow([390, 110], [468, 90], { color: GREEN, label: "all-visible", labelDy: -12, labelDx: -6 });
        c.arrow([390, 136], [468, 176], { color: RED, label: "not set", labelDy: 18, labelDx: -14 });
        c.para(20, 222, "VACUUM sets the bits. Any write to a page clears its bit.", { width: 560, weight: 700, fill: MUTED });
        c.flow("index", "visibility map", "", "request");
        c.flow("visibility map", "answer from the index", "", "data");
        c.flow("visibility map", "visit the heap", "", "metadata");
      },
    },

    "composite-order": {
      alt: "A composite index on a and b is sorted by a, then by b within each a. Rows with a equal to 1 sit together, in b order, so a search on a is one range, and a search on a and b is a single point. A search on b alone has no single range: matching entries are scattered across every value of a.",
      draw(c) {
        c.size(720, 280).title("Why column order matters in a composite index", "Entries are sorted by a, then by b within each a.");
        const entries = [[1, 2], [1, 5], [1, 9], [2, 1], [2, 5], [3, 3], [3, 5], [3, 8]];
        const y = 66;
        entries.forEach(([a, b], i) => {
          const x = 20 + i * 86;
          const hitA = a === 2;
          c.box(x, y, 78, 40, `${a}, ${b}`, { tone: hitA ? "amber" : b === 5 ? "red" : "plain", size: 12.5 });
        });
        c.text(20, 134, "WHERE a = 2", { size: 12, weight: 700, mono: true, fill: AMBER });
        c.para(160, 134, "Adjacent entries: one range. Fast.", { width: 500 });
        c.text(20, 160, "WHERE a = 2 AND b = 5", { size: 12, weight: 700, mono: true, fill: GREEN });
        c.para(200, 160, "A single point: the best case.", { width: 500 });
        c.text(20, 186, "WHERE b = 5", { size: 12, weight: 700, mono: true, fill: RED });
        c.para(160, 186, "Scattered, one per value of a. Before Postgres 18 the index was little use. Now a skip scan can jump between values of a, if there are few of them.", { width: 540 });
      },
    },

    "concurrent-build": {
      alt: "The phases of CREATE INDEX CONCURRENTLY. First the index is registered as invalid, so writes begin to maintain it. Then one table scan builds it, and a second scan adds what changed during the first. Between phases it waits for older transactions. Only then is it marked valid. A failure leaves an invalid index behind.",
      draw(c) {
        c.size(720, 240).title("CREATE INDEX CONCURRENTLY: more steps, no write lock");
        const names = [
          ["Register", "invalid, writers start updating it", "cream"],
          ["Scan 1", "build from a snapshot", "amber"],
          ["Scan 2", "add what changed during scan 1", "amber"],
          ["Wait", "older transactions must finish", "neutral"],
          ["Valid", "queries can use it", "green"],
        ];
        let prev;
        names.forEach(([name, line, tone], i) => {
          const b = c.box(20 + i * 140, 74, 124, 78, name, { tone, lines: line });
          if (prev) c.arrow(prev.right, b.left);
          prev = b;
        });
        c.para(20, 186, "It reads the table twice and waits for other transactions, so it takes longer. If it fails, for example on a duplicate in a unique index, the half-built index stays behind, marked INVALID, and must be dropped.", { width: 680 });
      },
    },

    "summary-map": {
      alt: "A map of this post in four columns. Reading plans: cost is estimated in arbitrary units, startup then total, and rows estimated against actual. Scans: index, bitmap, sequential, index-only. Designing indexes: key and include columns, composite order, selectivity. Living with them: statistics, visibility, write cost, building without blocking.",
      draw(c) {
        c.size(720, 280).title("The post on one page");
        const cols = [
          ["Reading plans", "cream", ["Cost isn't milliseconds", "Startup, then total", "Estimated vs actual rows"]],
          ["Scans", "amber", ["Index: few rows", "Bitmap: a moderate share", "Seq: most of the table", "Index only: never the heap"]],
          ["Designing", "green", ["INCLUDE carries columns", "Order composite keys", "Skewed data needs care"]],
          ["Living with them", "raised", ["Stale stats, wrong plans", "VACUUM sets visibility", "CONCURRENTLY in production"]],
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
