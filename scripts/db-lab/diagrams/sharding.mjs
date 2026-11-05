import { FAINT, GREEN, INK, MUTED } from "../canvas.mjs";

const post = {
  slug: "db-sharding",
  diagrams: {
    "write-path": {
      alt: "The write path of the sharded URL shortener. A client posts a long URL. The server hashes it with SHA-256 and keeps the first five characters as the short code. The hash ring maps that code to one of three Postgres servers, and the row is inserted there.",
      draw(c) {
        c.size(720, 300).title("Shortening a URL across three servers");
        const client = c.box(20, 110, 100, 60, "client", { tone: "plain", lines: "POST a URL" });
        const app = c.box(170, 110, 130, 60, "server", { tone: "raised", lines: "sha256, first 5" });
        const hash = c.box(350, 110, 120, 60, "hash ring", { tone: "amber", lines: "code → server" });
        c.box(540, 40, 160, 56, "shard 1", { tone: "cream", lines: "port 5432" });
        const s2 = c.box(540, 112, 160, 56, "shard 2", { tone: "green", lines: "port 5433" });
        c.box(540, 184, 160, 56, "shard 3", { tone: "cream", lines: "port 5434" });
        c.arrow(client.right, app.left);
        c.arrow(app.right, hash.left);
        c.arrow([470, 124], [538, 72], { color: FAINT, dash: "3 4" });
        c.arrow(hash.right, s2.left, { color: GREEN, width: 2, label: "INSERT", labelDy: -6 });
        c.arrow([470, 156], [538, 208], { color: FAINT, dash: "3 4" });
        c.para(20, 268, "Reads run the same code through the same ring, so they reach the same server.", { width: 680, weight: 700, fill: MUTED });
        c.flow("client", "server", "", "request");
        c.flow("server", "hash ring", "", "metadata");
        c.flow("hash ring", "shard 2", "INSERT", "data");
      },
    },

    "escalation": {
      alt: "What to try before sharding, in order. Partition the table, cache hot reads, replicate to serve reads from copies, use multi-region replication, and only then shard. Each step adds complexity, and reads are far easier to scale than writes.",
      draw(c) {
        c.size(720, 240).title("Sharding is the last step, not the first");
        const steps = [
          ["Partition", "cream", "smaller tables, same server"],
          ["Cache", "cream", "hot reads skip the database"],
          ["Replicate", "amber", "reads from copies"],
          ["Multi-region", "amber", "writes near users"],
          ["Shard", "red", "split the writes"],
        ];
        let prev;
        steps.forEach(([name, tone, line], i) => {
          const b = c.box(20 + i * 140, 74, 122, 76, name, { tone, lines: line });
          if (prev) c.arrow(prev.right, b.left);
          prev = b;
        });
        c.arrow([40, 184], [680, 184], { color: FAINT, label: "more complexity, fewer guarantees", labelDy: -6, labelFill: MUTED });
        c.para(20, 214, "Find the real bottleneck first. Reads are easy to spread out, and writes are the hard case.", { width: 680, size: 12, fill: INK });
      },
    },

    "partition-layers": {
      alt: "How the layers stack. A billion rows are spread over shards on separate servers. Within each shard the table is partitioned, and within each partition an index narrows the search further, until a query only looks at a few thousand rows.",
      draw(c) {
        c.size(720, 230).title("The layers stack");
        const items = [
          ["1,000,000,000 rows", "red", 640],
          ["a shard: 100,000,000 rows", "amber", 500],
          ["a partition: 10,000,000 rows", "cream", 360],
          ["an index range: a few thousand", "green", 240],
        ];
        items.forEach(([name, tone, w], i) => c.box(360 - w / 2, 54 + i * 42, w, 36, name, { tone, size: 12 }));
      },
    },

    "summary-map": {
      alt: "A map of this post in three columns. Routing: a shard key, then range, list or hash, and the client must know. Hashing: modulo moves most keys when servers change, while a ring moves about one share, and virtual nodes even out the load. The cost: no cross-shard transactions or joins, and schema changes on every server.",
      draw(c) {
        c.size(720, 260).title("The post on one page");
        const cols = [
          ["Routing", "cream", ["A shard key picks the server", "Range, list or hash", "The client has to know"]],
          ["Hashing", "amber", ["Modulo moves most keys", "A ring moves about 1 in N", "More points, even load"]],
          ["The cost", "red", ["No cross-shard transactions", "No cross-shard joins", "Every change, on every server"]],
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
