import { AMBER, GREEN } from "../../db-lab/canvas.mjs";
import { summaryMap } from "./_shared.mjs";

const post = {
  slug: "site-notes-and-feeds",
  diagrams: {
    "notes-flow": {
      alt: "Where a note goes. A Markdown file in content/notes with a date and plain text is read by notes.ts, which drops notes without text or with a bad date and sorts the rest newest first. Three places use the same list: the /notes page, a scrolling box on the home page, and the RSS feed at /notes/feed.xml.",
      draw(c) {
        c.size(720, 260).title("One folder, three readers");
        const file = c.box(20, 100, 140, 60, "content/notes", { tone: "plain", lines: "date + plain text" });
        const lib = c.box(210, 100, 140, 60, "notes.ts", { tone: "amber", lines: "filter, sort newest" });
        c.box(420, 40, 150, 50, "/notes", { tone: "raised", lines: "the full feed" });
        c.box(420, 105, 150, 50, "home page", { tone: "raised", lines: "scrolling box" });
        c.box(420, 170, 150, 50, "/notes/feed.xml", { tone: "green", lines: "RSS 2.0" });
        c.arrow(file.right, lib.left);
        c.arrow([350, 118], [418, 65]);
        c.arrow([350, 130], [418, 130]);
        c.arrow([350, 142], [418, 195], { color: GREEN });
        c.para(590, 70, "NoteList renders both pages, so they cannot drift apart.", { width: 120, size: 11 });
        c.flow("content/notes", "notes.ts", "", "data");
        c.flow("notes.ts", "/notes", "", "data");
        c.flow("notes.ts", "home page", "", "data");
        c.flow("notes.ts", "/notes/feed.xml", "", "data");
      },
    },

    "two-feeds": {
      alt: "The site's two RSS feeds come from different places. The notes feed is built from files in the repository at build time. The Second brain feed is built at request time from data that has already passed signature verification, never by copying the uploaded XML file.",
      draw(c) {
        c.size(720, 250).title("Two RSS routes, two levels of trust");
        c.text(20, 60, "Notes: from the repository", { size: 12.5, weight: 700, fill: AMBER });
        const a = c.box(20, 72, 150, 50, "markdown files", { tone: "plain", lines: "in git, reviewed" });
        const b = c.box(220, 72, 150, 50, "route handler", { tone: "amber", lines: "escapes, builds XML" });
        c.arrow(a.right, b.left);
        c.text(20, 160, "Second brain: from verified data", { size: 12.5, weight: 700, fill: GREEN });
        const d = c.box(20, 172, 150, 50, "signed JSON", { tone: "cream", lines: "from Blob" });
        const e = c.box(220, 172, 150, 50, "verify + validate", { tone: "green", lines: "secondBrainCore" });
        const f = c.box(420, 172, 150, 50, "feed.xml route", { tone: "raised", lines: "builds XML from it" });
        c.arrow(d.right, e.left);
        c.arrow(e.right, f.left);
        c.para(420, 82, "The uploaded feed.xml is signed too, but the site never serves it: it rebuilds the XML from the checked JSON.", { width: 280 });
      },
    },

    "summary-map": {
      alt: "A map of the notes post. Writing: one Markdown file with a date. Reading: notes.ts filters and sorts. Showing: /notes, the home page box and NoteList. Feeding: RSS 2.0 built by a route handler.",
      draw(c) {
        summaryMap(c, "Notes and feeds", [
          { name: "Write", lines: ["one .md file", "date + plain text", "no title or tags"] },
          { name: "Read", lines: ["notes.ts", "drop bad dates", "newest first"] },
          { name: "Show", lines: ["/notes", "home page box", "one NoteList"] },
          { name: "Feed", lines: ["route handler", "RSS 2.0", "escaped XML"] },
        ]);
      },
    },
  },
};

export default post;
