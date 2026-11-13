// Writes the series list into every "Building this site" post, between the two marker comments, with
// the current post in bold. Run it after adding or renaming a post: node scripts/build-log/series-callouts.mjs
import fs from "node:fs";
import path from "node:path";

const POSTS = [
  ["site-architecture", "The architecture", "files in, static pages out, and the few parts that run in the browser."],
  ["site-sections-and-series", "Sections, series and URLs", "shelves, reading orders, redirects and image folders."],
  ["site-audio", "Listen to this post", "a browser voice for every post and AI podcast versions for some."],
  ["site-notes-and-feeds", "Nuggets and feeds", "short notes, one list for three pages, and RSS."],
  ["site-diagrams-that-move", "Diagrams that move", "inlined SVGs, theme tokens, message-flow animation and live charts."],
  ["site-generated-content", "Content generated from real runs", "the DuckDB SQL bank and the database recording harness."],
  ["site-live-postgres", "Real PostgreSQL in the browser", "PGlite on demand, a schema per box, and a download cut by 42%."],
  ["site-second-brain-page", "The Second brain page", "signed snapshots, verification before parsing, and no write path."],
  ["second-brain-pipeline", "Building the Second brain pipeline", "from a Gmail 403 to signed files, with Claude Code."],
];

const START = "{/* series:start */}";
const END = "{/* series:end */}";
const NOTE =
  "Each part explains one feature from its code, and marks where every result comes from: ✅ ran here (re-run for this series on 2026-11-13), 📜 from the build log at the time, or 📘 from the code or docs only. The code is on [GitHub](https://github.com/vineetganti/my-portfolio).";

function callout(slug) {
  const items = POSTS.map(([s, title, blurb], i) =>
    s === slug ? `${i + 1}. **${title}** (this post): ${blurb}` : `${i + 1}. [${title}](/blog/${s}): ${blurb}`,
  );
  return `<Callout type="info" title="The Building this site series">\n\n${items.join("\n")}\n\n${NOTE}\n\n</Callout>`;
}

const dir = path.join(process.cwd(), "content/blog");
for (const [slug] of POSTS) {
  const file = path.join(dir, `${slug}.mdx`);
  if (!fs.existsSync(file)) continue;
  const text = fs.readFileSync(file, "utf8");
  const a = text.indexOf(START);
  const b = text.indexOf(END);
  if (a === -1 || b === -1) throw new Error(`${slug}: no series markers`);
  fs.writeFileSync(file, `${text.slice(0, a + START.length)}\n\n${callout(slug)}\n\n${text.slice(b)}`);
  console.log(`${slug}: series list written`);
}
