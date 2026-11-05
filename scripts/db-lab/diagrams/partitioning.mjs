import { AMBER, FAINT, GREEN, INK, MUTED, RED } from "../canvas.mjs";

const post = {
  slug: "db-partitioning",
  diagrams: {
    "one-table-many": {
      alt: "A million-row customers table split into five partitions of 200,000 rows each. The parent table holds no data. A query for id 700001 reads the metadata, goes straight to the partition from 600,000 to 800,000, and works with 200,000 rows and that partition's own index.",
      draw(c) {
        c.size(720, 280).title("One logical table, five physical ones");
        const q = c.box(20, 60, 200, 54, "WHERE id = 700001", { tone: "plain", mono: true, size: 11.5 });
        const parent = c.box(280, 60, 170, 54, "customers", { tone: "cream", lines: "the parent holds no rows" });
        c.arrow(q.right, parent.left, { label: "query" });
        const ranges = ["1 to 200K", "200K to 400K", "400K to 600K", "600K to 800K", "800K to 1M"];
        ranges.forEach((r, i) => {
          const hit = i === 3;
          const b = c.box(20 + i * 138, 170, 130, 54, `part ${i + 1}`, { tone: hit ? "green" : "raised", lines: r, size: 12 });
          if (hit) c.arrow([parent.cx + 40, 114], [b.cx, 168], { color: GREEN, width: 2 });
          else c.line([parent.cx, 114], [b.cx, 170], { color: FAINT, dash: "3 4" });
        });
        c.para(20, 252, "The motto from the course: the quickest way to query a billion rows is not to query a billion rows.", { width: 680, weight: 700, fill: MUTED });
      },
    },

    "horizontal-vertical": {
      alt: "Two ways to split a table. Horizontal partitioning splits by rows, so each piece has the same columns and fewer rows. Vertical partitioning splits by columns, so a large rarely-used blob column moves to its own storage while the small hot columns stay compact.",
      draw(c) {
        c.size(720, 250).title("Horizontal or vertical?");
        const grid = (x, y, cols, rows, fill) => {
          for (let r = 0; r < rows; r++) for (let k = 0; k < cols; k++) c.rect(x + k * 40, y + r * 22, 38, 20, { tone: fill(r, k), rx: 2 });
        };
        c.text(20, 60, "Horizontal: by rows", { size: 13, weight: 700 });
        grid(20, 72, 4, 6, (r) => (r < 3 ? "cream" : "green"));
        c.line([20, 137], [180, 137], { color: AMBER, width: 2 });
        c.para(200, 88, "Same columns, fewer rows each. By range, list or hash. This is what people usually mean by partitioning.", { width: 150 });
        c.text(380, 60, "Vertical: by columns", { size: 13, weight: 700 });
        grid(380, 72, 4, 6, (r, k) => (k < 3 ? "cream" : "red"));
        c.line([500, 70], [500, 204], { color: AMBER, width: 2 });
        c.para(556, 88, "A blob column moves to its own storage. The hot columns stay compact, so more rows fit in a page.", { width: 150 });
      },
    },

    "three-kinds": {
      alt: "Three ways to choose a partition. By range, for example dates or ids. By list, for example a state or a country. By hash, where a hash of the key picks the partition and spreads rows evenly.",
      draw(c) {
        c.size(720, 220).title("Three ways to choose a partition");
        const kinds = [
          ["By range", "cream", "2023, 2024, 2025", "Dates and ids. Old ranges can move to cheap storage."],
          ["By list", "green", "California, Texas, Ohio", "Known discrete values, such as a region."],
          ["By hash", "amber", "hash(key) % 4", "Spreads rows evenly when there's no natural range."],
        ];
        kinds.forEach(([name, tone, sample, line], i) => {
          const x = 20 + i * 232;
          c.box(x, 60, 216, 58, name, { tone, lines: sample, size: 13.5, small: 11 });
          c.para(x + 4, 142, line, { width: 208, size: 12, fill: INK });
        });
      },
    },

    "partition-vs-shard": {
      alt: "Partitioning against sharding. Partitions are tables inside one database on one server, so the client sends one query and the database routes it, and joins and transactions still work. Shards are the same table on different servers, so the client or a proxy must pick the server, and joins and transactions across them stop working.",
      draw(c) {
        c.size(720, 280).title("Same idea, different boundary");
        c.text(20, 56, "Partitioning: one server", { size: 12.5, weight: 700 });
        c.rect(20, 66, 320, 120, { tone: "raised", rx: 10 });
        c.box(36, 112, 88, 54, "g0035", { tone: "cream", size: 11.5 });
        c.box(136, 112, 88, 54, "g3560", { tone: "cream", size: 11.5 });
        c.box(236, 112, 88, 54, "g6080", { tone: "cream", size: 11.5 });
        c.text(180, 92, "the database routes each query", { size: 11.5, weight: 700, anchor: "middle", fill: GREEN });
        c.para(20, 212, "The client doesn't know. Joins and transactions still work.", { width: 320, size: 12 });
        c.text(380, 56, "Sharding: many servers", { size: 12.5, weight: 700 });
        c.box(380, 112, 96, 54, "server 1", { tone: "amber", lines: "url_table", size: 11.5 });
        c.box(492, 112, 96, 54, "server 2", { tone: "amber", lines: "url_table", size: 11.5 });
        c.box(604, 112, 96, 54, "server 3", { tone: "amber", lines: "url_table", size: 11.5 });
        c.text(540, 92, "the client must pick one", { size: 11.5, weight: 700, anchor: "middle", fill: RED });
        c.para(380, 212, "Each server is a separate database. Cross-shard joins and transactions are gone.", { width: 320, size: 12 });
      },
    },

    "summary-map": {
      alt: "A map of this post in three columns. What it is: one logical table split into smaller ones, by range, list or hash, routed by the database. When it helps: pruning, a sequential scan over less data, dropping old data fast. What it costs: queries off the key scan everything, updates can move rows, and more objects to manage.",
      draw(c) {
        c.size(720, 260).title("The post on one page");
        const cols = [
          ["What it is", "cream", ["Smaller tables behind one name", "Range, list or hash", "The database routes queries"]],
          ["When it helps", "green", ["Pruning skips partitions", "Less data to scan", "Dropping old data is instant"]],
          ["What it costs", "red", ["Off-key queries scan all", "Key updates move rows", "More objects to manage"]],
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
