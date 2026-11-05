// Copies the PGlite runtime from node_modules into public/pglite (git-ignored), so the browser can
// load real Postgres on demand from our own origin. Runs before `next dev` and `next build`.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const from = path.join("node_modules", "@electric-sql", "pglite", "dist");
const to = path.join("public", "pglite");
const EXTENSIONS = ["pageinspect", "pg_visibility", "pg_buffercache", "pg_walinspect", "pg_freespacemap", "bloom"];

// Chunk names change between PGlite versions, so start clean rather than leave old ones behind.
fs.rmSync(to, { recursive: true, force: true });
fs.mkdirSync(path.join(to, "contrib"), { recursive: true });

for (const file of fs.readdirSync(from)) {
  const keep = (file.endsWith(".js") && !file.endsWith(".cjs")) || ["pglite.wasm", "initdb.wasm"].includes(file);
  if (keep) fs.copyFileSync(path.join(from, file), path.join(to, file));
}
for (const name of EXTENSIONS) {
  fs.copyFileSync(path.join(from, "contrib", `${name}.js`), path.join(to, "contrib", `${name}.js`));
  fs.copyFileSync(path.join(from, `${name}.tar.gz`), path.join(to, `${name}.tar.gz`));
}

// Hosts compress .wasm but not .data, which would add 4 MB to every reader's download, so this file
// ships gzipped and src/components/db/pglite.ts unpacks it. It isn't named .gz because some hosts
// add a Content-Encoding header to those, and the browser would then unpack it first.
fs.writeFileSync(path.join(to, "pglite.data.gzipped"), zlib.gzipSync(fs.readFileSync(path.join(from, "pglite.data")), { level: 9 }));

console.log(`pglite: copied runtime and ${EXTENSIONS.length} extensions to ${to}`);
