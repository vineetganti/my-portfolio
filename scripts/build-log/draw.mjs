// Draws the diagrams for the "Building this site" series as SVG files, with the same canvas and palette
// as the Database Engineering diagrams (scripts/db-lab/canvas.mjs).
//
//   node scripts/build-log/draw.mjs [post ...]
//
// Each file in scripts/build-log/diagrams exports { slug, diagrams }, where a diagram is an alt text and
// a function that draws on a blank canvas. A diagram that calls c.flow() also gets a .flow.json, which
// makes the site animate messages along its arrows.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Canvas } from "../db-lab/canvas.mjs";

const dir = path.join(process.cwd(), "scripts/build-log/diagrams");
const wanted = process.argv.slice(2);
// Files starting with "_" are shared helpers, not posts.
const files = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith(".mjs") && !f.startsWith("_") && (!wanted.length || wanted.includes(f.replace(".mjs", ""))));
for (const f of files) {
  const { slug, diagrams } = (await import(pathToFileURL(path.join(dir, f)).href)).default;
  const out = path.join(process.cwd(), "public/images/build-logs/building-this-site", slug);
  fs.mkdirSync(out, { recursive: true });
  for (const [name, { alt, draw }] of Object.entries(diagrams)) {
    const c = new Canvas();
    draw(c);
    fs.writeFileSync(path.join(out, `${name}.svg`), c.render(name.replace(/-/g, " "), alt));
    const flow = path.join(out, `${name}.flow.json`);
    if (c.steps.length) fs.writeFileSync(flow, JSON.stringify({ steps: c.steps }, null, 2) + "\n");
    else fs.rmSync(flow, { force: true });
  }
  console.log(`${slug}: ${Object.keys(diagrams).length} diagrams`);
}
