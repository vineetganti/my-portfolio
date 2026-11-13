import { AMBER, FAINT, GREEN, MUTED } from "../../db-lab/canvas.mjs";
import { summaryMap } from "./_shared.mjs";

const post = {
  slug: "site-sections-and-series",
  diagrams: {
    "three-layers": {
      alt: "Three ways to label a post. A section is the shelf it sits on, one per post, from a short fixed list: AI and LLMs, Systems, Data Engineering, Build Logs, Essays. A series is an optional reading order with a part number. Tags are free-form detail. One post carries all three, for example section build-logs, series building-this-site part 2, and a few tags.",
      draw(c) {
        c.size(720, 330).title("Section, series and tag do three different jobs");
        const cols = [
          ["Section", "which shelf?", ["AI & LLMs", "Systems", "Data Engineering", "Build Logs", "Essays"], "amber", "one per post, fixed list"],
          ["Series", "what order?", ["LLM Architectures", "Agentic AI", "Database Engineering", "Building this site"], "green", "optional, Part N of M"],
          ["Tag", "what about?", ["Next.js", "MDX", "PGlite", "anything"], "cream", "free-form, any number"],
        ];
        cols.forEach(([name, q, items, tone, foot], i) => {
          const x = 20 + i * 232;
          c.box(x, 50, 216, 46, name, { tone, lines: q, size: 13 });
          items.forEach((it, j) => c.box(x + 12, 106 + j * 30, 192, 24, it, { tone: "plain", size: 11 }));
          c.text(x + 108, 268, foot, { size: 11, fill: MUTED, anchor: "middle" });
        });
        c.rect(20, 282, 680, 34, { tone: "raised", rx: 8 });
        c.text(360, 304, "One post: section build-logs, series building-this-site (part 2), tags Next.js, MDX", { size: 11.5, weight: 700, anchor: "middle" });
      },
    },

    "url-space": {
      alt: "The blog's URL space. /blog lists everything. /blog/[slug] is one segment deep and is a post. /blog/topic/[section] and /blog/series/[series] are two segments deep, so they can never collide with a post slug. Each dynamic route lists its pages with generateStaticParams, so every one is prerendered.",
      draw(c) {
        c.size(720, 280).title("Depth keeps the routes apart");
        const root = c.box(20, 112, 110, 50, "/blog", { tone: "amber", lines: "every post" });
        c.box(200, 46, 210, 50, "/blog/[slug]", { tone: "plain", lines: "one segment: a post" });
        const topic = c.box(200, 112, 210, 50, "/blog/topic/[section]", { tone: "green", lines: "two segments: a shelf" });
        c.box(200, 178, 210, 50, "/blog/series/[series]", { tone: "cream", lines: "two segments: an order" });
        c.arrow([130, 126], [198, 71]);
        c.arrow(root.right, topic.left);
        c.arrow([130, 148], [198, 203]);
        c.para(440, 60, "generateStaticParams lists every slug, section and series with posts, so each page is built as HTML ahead of time.", { width: 260 });
        c.para(440, 150, "A post slug can't be 'topic' or 'series' and shadow a shelf, because a slug is a single segment.", { width: 260 });
      },
    },

    redirects: {
      alt: "Three kinds of redirect in next.config.ts. Renamed posts, such as mentiforce01, answer 308 Permanent Redirect to their new slug. The retired build-log post how-this-site-is-built answers 308 to the series page. The old Good reads page /reads answers 307 Temporary Redirect to the Second brain page, because that page is a beta.",
      draw(c) {
        c.size(720, 280).title("Old URLs keep working");
        const rows = [
          ["/blog/mentiforce01", "308", "/blog/python-internals-…", GREEN, "renamed post"],
          ["/blog/how-this-site-is-built", "308", "/blog/series/building-…", GREEN, "post split into a series"],
          ["/reads", "307", "/second-brain#good-reads", AMBER, "beta, so not permanent"],
        ];
        rows.forEach(([from, code, to, color, why], i) => {
          const y = 54 + i * 70;
          c.box(20, y, 210, 46, from, { tone: "plain", size: 11, mono: true });
          c.box(260, y + 6, 60, 34, code, { tone: color === GREEN ? "green" : "amber", size: 13 });
          c.box(350, y, 210, 46, to, { tone: "raised", size: 11, mono: true });
          c.arrow([230, y + 23], [258, y + 23], { color });
          c.arrow([320, y + 23], [348, y + 23], { color });
          c.para(572, y + 20, why, { width: 130, size: 10.5 });
        });
        c.text(20, 268, "308 is cached by browsers and search engines; 307 can be withdrawn without leaving a stale redirect behind.", { size: 11, fill: FAINT });
      },
    },

    "summary-map": {
      alt: "A map of the post. Labels: section, series and tags in frontmatter. One config: sections.ts lists the shelves and series. Routes: /blog/topic and /blog/series, two segments deep and prerendered. Moves: readable slugs, permanent redirects and an image folder per post.",
      draw(c) {
        summaryMap(
          c,
          "Sections, series and URLs",
          [
            { name: "Labels", lines: ["section: shelf", "series + seriesOrder", "tags: free-form"] },
            { name: "One config", lines: ["sections.ts", "unknown → Essays", "a new shelf = one entry"] },
            { name: "Routes", lines: ["/blog/topic/[section]", "/blog/series/[series]", "all prerendered"] },
            { name: "Moves", lines: ["readable slugs", "308 redirects", "images by post"] },
          ],
          "Every shelf and reading list has a real URL, and no old link breaks.",
        );
      },
    },
  },
};

export default post;
