// Draws the diagrams for the Database Engineering posts as SVG files.
//
//   node scripts/db-lab/draw.mjs [post ...]
//
// Each file in scripts/db-lab/diagrams exports { slug, diagrams }, where a diagram is an alt text and
// a function that draws on a blank canvas.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Canvas } from "./canvas.mjs";

async function main() {
  const dir = path.join(process.cwd(), "scripts/db-lab/diagrams");
  const wanted = process.argv.slice(2);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".mjs") && (!wanted.length || wanted.includes(f.replace(".mjs", ""))));
  for (const f of files) {
    const { slug, diagrams } = (await import(pathToFileURL(path.join(dir, f)).href)).default;
    const out = path.join(process.cwd(), "public/images/data-engineering/database-engineering", slug);
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
}

await main();
