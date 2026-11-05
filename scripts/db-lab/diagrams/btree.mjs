import { AMBER, FAINT, GREEN, MUTED } from "../canvas.mjs";

const post = {
  slug: "db-btrees-and-bplus-trees",
  diagrams: {
    "node-is-a-page": {
      alt: "One B-tree node is one disk page. The page holds keys, each with its value, and pointers down to child pages. A node with three children holds two elements. The search rule: go left of a key for smaller values, right for larger.",
      draw(c) {
        c.size(720, 280).title("One node is one page", "Textbooks draw two keys. A real page holds hundreds.");
        c.rect(150, 70, 420, 76, { tone: "cream", rx: 8 });
        c.text(160, 90, "page 7 (a node with 3 children holds 2 elements)", { size: 11, fill: AMBER, weight: 700 });
        const cell = (x, key) => {
          c.box(x, 98, 126, 40, `key ${key}`, { tone: "plain", lines: "+ the row's address", size: 11.5, small: 9.5 });
        };
        cell(214, 20);
        cell(366, 40);
        [[176, "< 20"], [352, "20 to 40"], [530, "> 40"]].forEach(([x, label], i) => {
          c.arrow([x, 146], [100 + i * 260, 212], { color: MUTED });
          c.box(40 + i * 260, 214, 120, 44, `child page ${i + 1}`, { tone: "raised", lines: `keys ${label}`, size: 11.5 });
        });
      },
    },

    "btree-vs-bplus": {
      alt: "The same keys in both structures. In a B-tree every node holds keys and values, so internal pages carry values that a search only passes through. In a B+tree internal pages hold keys alone and fit many more per page, while all the values sit in the leaves, which are linked to each other.",
      draw(c) {
        c.size(720, 320).title("Where the values live");
        c.text(20, 54, "B-Tree: values in every node", { size: 12.5, weight: 700 });
        c.box(100, 66, 130, 40, "4 + value", { tone: "amber", size: 11.5 });
        c.box(20, 150, 130, 40, "2 + value", { tone: "amber", size: 11.5 });
        c.box(180, 150, 130, 40, "6 + value", { tone: "amber", size: 11.5 });
        c.arrow([140, 106], [90, 148]);
        c.arrow([190, 106], [240, 148]);
        c.para(20, 216, "A search reads values it doesn't want on the way down. Fewer keys fit per page, so the tree is taller.", { width: 300 });
        c.text(380, 54, "B+Tree: keys route, leaves hold values", { size: 12.5, weight: 700 });
        c.box(480, 66, 90, 40, "4", { tone: "cream", size: 12 });
        const l1 = c.box(380, 150, 100, 40, "2, 3", { tone: "green", lines: "+ values", size: 11.5, small: 9.5 });
        const l2 = c.box(490, 150, 100, 40, "4, 5", { tone: "green", lines: "+ values", size: 11.5, small: 9.5 });
        const l3 = c.box(600, 150, 100, 40, "6, 7", { tone: "green", lines: "+ values", size: 11.5, small: 9.5 });
        c.arrow([510, 106], [430, 148]);
        c.arrow([530, 106], [540, 148]);
        c.arrow([550, 106], [650, 148]);
        c.arrow(l1.right, l2.left, { color: GREEN, both: true });
        c.arrow(l2.right, l3.left, { color: GREEN, both: true });
        c.para(380, 216, "Internal pages are slim and stay in memory. Keys are repeated in the leaves, a small price. A range is one walk along the leaf links.", { width: 320 });
        c.line([350, 40], [350, 300], { color: FAINT, dash: "3 4" });
      },
    },

    "leaf-contents": {
      alt: "What a leaf entry holds in each design. A Postgres index leaf holds the key and a 6-byte heap address. An InnoDB secondary index leaf holds the key and the whole primary key. An InnoDB primary key leaf holds the key and the entire row. So a wide primary key inflates every secondary index in InnoDB.",
      draw(c) {
        c.size(720, 240).title("What's in a leaf entry");
        const row = (y, name, parts) => {
          c.text(20, y + 24, name, { size: 12, weight: 700 });
          let x = 250;
          for (const [label, w, tone] of parts) {
            c.box(x, y, w, 38, label, { tone, size: 11.5 });
            x += w + 4;
          }
        };
        row(58, "Postgres, any index", [["key", 90, "cream"], ["heap address, 6 bytes", 150, "green"]]);
        row(108, "InnoDB, secondary index", [["key", 90, "cream"], ["primary key value", 240, "amber"]]);
        row(158, "InnoDB, primary key", [["key", 90, "cream"], ["the whole row", 340, "raised"]]);
      },
    },

    "summary-map": {
      alt: "A map of this post in three columns. B-Trees: balanced, one node per page, values at every level, weak at ranges. B+Trees: keys route, values in leaves, leaves linked, so ranges are cheap. In practice: fanout depends on key size, a real tree is three or four pages tall, and InnoDB's primary key travels into every secondary index.",
      draw(c) {
        c.size(720, 260).title("The post on one page");
        const cols = [
          ["B-Tree", "amber", ["Balanced, one node a page", "Values at every level", "Ranges jump around the tree"]],
          ["B+Tree", "green", ["Internal pages only route", "All values in the leaves", "Leaves are linked for ranges"]],
          ["In practice", "cream", ["Key size sets the fanout", "A million rows, 3 levels", "A wide InnoDB key costs twice"]],
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
