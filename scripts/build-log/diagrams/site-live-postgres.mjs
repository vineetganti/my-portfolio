import { AMBER, GREEN, MUTED, RED } from "../../db-lab/canvas.mjs";
import { summaryMap } from "./_shared.mjs";

const post = {
  slug: "site-live-postgres",
  diagrams: {
    "load-on-click": {
      alt: "What happens when a reader presses Run in a live box for the first time on a page. Three downloads start together: PGlite's JavaScript entry, the six extension modules, and the gzipped file system image, which the browser unpacks with DecompressionStream. PGlite then starts PostgreSQL in WebAssembly, the box creates its own schema and runs its setup, and then the reader's SQL runs one statement at a time.",
      draw(c) {
        c.size(720, 300).title("Nothing loads until the first press of Run");
        const run = c.box(20, 118, 110, 60, "Run", { tone: "amber", lines: "first press" });
        c.box(180, 44, 200, 50, "/pglite/index.js", { tone: "raised", mono: true, size: 11.5 });
        c.box(180, 123, 200, 50, "6 extension modules", { tone: "raised", lines: "pageinspect, bloom, …" });
        c.box(180, 202, 200, 50, "pglite.data.gzipped", { tone: "cream", lines: "unpacked in the browser", mono: true, size: 11.5 });
        const pg = c.box(430, 118, 130, 60, "PGlite.create", { tone: "green", lines: "Postgres in WASM" });
        const box = c.box(600, 118, 100, 60, "lab_<id>", { tone: "plain", lines: "schema + setup", mono: true, size: 11.5 });
        c.arrow([130, 132], [178, 69]);
        c.arrow(run.right, [178, 148]);
        c.arrow([130, 164], [178, 227]);
        c.arrow([380, 69], [428, 132]);
        c.arrow([380, 148], [428, 148]);
        c.arrow([380, 227], [428, 164]);
        c.arrow(pg.right, box.left, { color: GREEN });
        c.para(430, 214, "Later boxes on the page reuse the same instance: one download per page load.", { width: 270, size: 10.5 });
        c.flow("Run", "6 extension modules", "", "request");
        c.flow("6 extension modules", "PGlite.create", "", "data");
        c.flow("PGlite.create", "lab_<id>", "", "data");
        void MUTED;
      },
    },

    "download-size": {
      alt: "The download before and after the fix, measured on a production server. Before: 9.86 MB, of which pglite.data was 6.24 MB because hosts do not compress a .data file, plus 3.29 MB of gzipped WebAssembly and 0.33 MB of the rest. After gzipping the data file at build time and unpacking it in the browser: 5.74 MB, with the data file at 2.13 MB.",
      draw(c) {
        c.size(720, 250).title("What a reader downloads on the first Run");
        const scale = 520 / 10;
        const bar = (y, label, parts) => {
          c.text(20, y + 24, label, { size: 12, weight: 700 });
          let x = 100;
          for (const [mb, tone, name] of parts) {
            const w = mb * scale;
            c.box(x, y, w - 2, 36, w > 70 ? `${name} ${mb.toFixed(2)}` : "", { tone, size: 11 });
            x += w;
          }
        };
        bar(60, "Before", [[6.24, "red", "pglite.data"], [3.29, "amber", "wasm"], [0.33, "neutral", "js"]]);
        bar(130, "After", [[2.13, "green", "data.gzipped"], [3.29, "amber", "wasm"], [0.33, "neutral", "js"]]);
        c.text(100 + 9.86 * scale + 8, 84, "9.86 MB", { size: 12, weight: 700, fill: RED });
        c.text(100 + 5.75 * scale + 8, 154, "5.74 MB", { size: 12, weight: 700, fill: GREEN });
        c.para(20, 206, "Measured with Edge's network events on next start. Vercel compresses .wasm but not application/octet-stream, so the fix is to ship the data file already gzipped.", { width: 680, size: 11 });
        void AMBER;
      },
    },

    "schema-per-box": {
      alt: "Several live boxes on one page share one PGlite database. Each box creates its own schema named lab_ plus its id and sets the search path to it, so two boxes can each have a table t without clashing. Queries should look a table up with 't'::regclass, which follows the search path, rather than relname = 't', which can match another box's table.",
      draw(c) {
        c.size(720, 260).title("One database per page, one schema per box");
        c.rect(20, 50, 680, 150, { tone: "neutral" });
        c.text(36, 74, "PGlite: one PostgreSQL instance", { size: 12.5, weight: 700 });
        c.box(40, 90, 190, 90, "lab_acid_transfer", { tone: "plain", lines: ["accounts", "search_path → here"], mono: true, size: 11 });
        c.box(260, 90, 190, 90, "lab_acid_rule_break", { tone: "plain", lines: ["accounts", "its own copy"], mono: true, size: 11 });
        c.box(480, 90, 200, 90, "public", { tone: "raised", lines: ["extensions", "shared"], mono: true, size: 11 });
        c.para(20, 222, "Use 't'::regclass, which follows the search path. relname = 't' in pg_class matches every box's t on the page.", { width: 680, fill: MUTED });
      },
    },

    "stale-cache": {
      alt: "A bug found in the final review. Before: dbLab.ts kept each recording file in a module-level cache, so a dev server started before a re-record kept serving the old recording, and the roles box looked broken. After: the cache is used only in production builds, where the files cannot change, and the dev server reads the file on every request.",
      draw(c) {
        c.size(720, 240).title("Before and after: a cache that outlived the file");
        c.text(20, 62, "Before", { size: 12.5, weight: 700, fill: RED });
        const steps1 = [["dev server starts", "plain"], ["file read, cached", "raised"], ["re-record writes file", "amber"], ["old data served", "red"]];
        steps1.forEach(([n, t], i) => {
          c.box(20 + i * 172, 72, 150, 42, n, { tone: t, size: 11.5 });
          if (i) c.arrow([i * 172 - 2, 93], [20 + i * 172 - 2, 93], { color: RED });
        });
        c.text(20, 150, "After", { size: 12.5, weight: 700, fill: GREEN });
        const steps2 = [["NODE_ENV check", "plain"], ["dev: read each time", "green"], ["production: cache", "raised"], ["fresh in dev", "green"]];
        steps2.forEach(([n, t], i) => {
          c.box(20 + i * 172, 160, 150, 42, n, { tone: t, size: 11.5 });
          if (i) c.arrow([i * 172 - 2, 181], [20 + i * 172 - 2, 181], { color: GREEN });
        });
      },
    },

    "summary-map": {
      alt: "A map of the live Postgres post. Load: nothing until Run, then one instance per page. Isolation: a schema per box and statements run one at a time. Size: 5.74 MB after gzipping the data file. Tests: every control clicked and every box run, on desktop and phone, in production.",
      draw(c) {
        summaryMap(
          c,
          "Real PostgreSQL in the browser",
          [
            { name: "Load", lines: ["on first Run", "one per page", "6 extensions"] },
            { name: "Isolation", lines: ["schema per box", "statement by statement", "Reset rebuilds"] },
            { name: "Size", lines: ["9.86 → 5.74 MB", "gzip at build", "unpack in browser"] },
            { name: "Tests", lines: ["220 controls", "106 box steps", "desktop + phone"] },
          ],
        );
      },
    },
  },
};

export default post;
