import { AMBER, GREEN, INK, MUTED } from "../canvas.mjs";

const post = {
  slug: "db-bloom-filters-and-uuids",
  diagrams: {
    "username-check": {
      alt: "Checking whether a username exists. The request reaches the server, which looks in a small in-memory Bloom filter. A clear bit means the name is definitely free, so the server answers without touching the database. A set bit means maybe, so the server asks the database for the real answer.",
      draw(c) {
        c.size(720, 260).title("A Bloom filter in front of the database");
        const client = c.box(20, 100, 110, 60, "client", { tone: "plain", lines: "is 'sara' taken?" });
        const server = c.box(190, 100, 120, 60, "server", { tone: "raised" });
        c.box(370, 60, 150, 60, "Bloom filter", { tone: "amber", lines: "a few KB, in memory" });
        c.box(570, 150, 130, 60, "database", { tone: "cream", lines: "the real answer" });
        c.arrow(client.right, server.left, { label: "GET" });
        c.arrow([310, 116], [368, 96], { label: "" });
        c.arrow([520, 110], [598, 148], { color: AMBER, label: "maybe: ask", labelDy: -10, labelDx: 44 });
        c.route([[445, 122], [445, 190], [250, 190], [250, 162]], { color: GREEN, label: "definitely not: answer now", labelAt: [346, 190], labelDy: 16 });
        c.flow("client", "server", "GET", "request");
        c.flow("server", "Bloom filter", "", "request");
        c.flow("Bloom filter", "database", "maybe: ask", "metadata");
      },
    },

    "billion-row-ladder": {
      alt: "A ladder of options for a billion-row table, in the order to try them. First avoid it with a better design. Then index the columns you search. Then partition the table within one server. Then shard across servers. Last, brute-force it in parallel, which only suits analytical work.",
      draw(c) {
        c.size(720, 300).title("Five ways to deal with a billion rows, in order");
        const steps = [
          ["1  Avoid it", "green", "Does this table need to exist in this shape?"],
          ["2  Index it", "cream", "Search a small structure, not the table"],
          ["3  Partition it", "cream", "Smaller pieces on one server, invisible to clients"],
          ["4  Shard it", "amber", "Pieces on many servers, and clients must know"],
          ["5  Brute force", "red", "Scan in parallel, for analytics, not transactions"],
        ];
        steps.forEach(([name, tone, line], i) => {
          const y = 52 + i * 48;
          c.box(20 + i * 26, y, 190, 40, name, { tone, size: 13 });
          c.para(226 + i * 26, y + 25, line, { width: 460, size: 12, fill: INK });
        });
      },
    },

    "uuid-anatomy": {
      alt: "The bit layout of three kinds of identifier. UUIDv4 is 122 random bits, so consecutive values have no order. UUIDv7 starts with a 48-bit timestamp in milliseconds followed by random bits. ULID also starts with a 48-bit timestamp, followed by 80 random bits. Time-first identifiers sort in creation order.",
      draw(c) {
        c.size(720, 250).title("Three 128-bit identifiers");
        const row = (y, name, parts) => {
          c.text(20, y + 23, name, { size: 12.5, weight: 700 });
          let x = 110;
          for (const [label, w, tone] of parts) {
            c.box(x, y, w, 36, label, { tone, size: 11 });
            x += w + 3;
          }
        };
        row(60, "UUIDv4", [["122 random bits (and 6 fixed)", 590, "red"]]);
        row(112, "UUIDv7", [["48-bit time, ms", 220, "green"], ["version", 56, "neutral"], ["random bits", 308, "red"]]);
        row(164, "ULID", [["48-bit time, ms", 220, "green"], ["80 random bits", 367, "red"]]);
        c.para(110, 222, "Green sorts by creation time. New values land next to each other at the end of an index.", { width: 590, weight: 700, fill: MUTED });
      },
    },

    thrashing: {
      alt: "Why random keys thrash the buffer pool. With ordered keys, inserts keep hitting the same few pages at the tail of the index, and those stay in memory. With random keys, each insert needs a different page anywhere in the index, so a page has to be read in and another written out, again and again.",
      draw(c) {
        c.size(720, 280).title("The same memory, two insert patterns");
        const strip = (y, label, hot, tone) => {
          c.text(20, y + 22, label, { size: 12.5, weight: 700 });
          for (let i = 0; i < 18; i++) c.rect(150 + i * 30, y, 26, 34, { tone: hot.includes(i) ? tone : "plain", rx: 3 });
        };
        strip(62, "Ordered keys", [15, 16, 17], "green");
        c.para(150, 116, "Inserts land on the last pages, which stay in memory until they're full. Each page is written once.", { width: 540 });
        strip(156, "Random keys", [0, 2, 3, 5, 7, 8, 10, 12, 14, 15], "red");
        c.para(150, 210, "Inserts land anywhere, so nearly every page is needed sooner or later. Once the index outgrows memory, each insert may read one page in and push another out.", { width: 540 });
      },
    },

    "summary-map": {
      alt: "A map of this post in three columns. Bloom filters: a definite no or a maybe, bits and hashes, they saturate. Billion rows: avoid, index, partition, shard, brute force, and a JSON list moves the cost to writes. Keys: random keys scatter inserts, ordered keys append, idempotency keys make retries safe.",
      draw(c) {
        c.size(720, 260).title("The post on one page");
        const cols = [
          ["Bloom filters", "amber", ["A definite no, or a maybe", "Bits and hash functions", "They saturate when full"]],
          ["Billion rows", "cream", ["Avoid, index, partition, shard", "Brute force is for analytics", "JSON lists move cost to writes"]],
          ["Keys", "green", ["Random keys scatter inserts", "UUIDv7 and ULID append", "Idempotency keys make retries safe"]],
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
