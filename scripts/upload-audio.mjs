// Uploads recorded narrations (.m4a) to Vercel Blob and lists them in content/audio.json.
//
//   node --env-file=.env.local scripts/upload-audio.mjs [folder]
//
// folder defaults to public/audio. The file name (without .m4a) must be the post's slug.
// Needs BLOB_READ_WRITE_TOKEN (from the Blob store's .env.local snippet in the Vercel dashboard).
// Afterwards set AUDIO_BASE_URL in Vercel to the base URL this script prints.
import fs from "node:fs";
import path from "node:path";
import { put } from "@vercel/blob";

if (!process.env.BLOB_READ_WRITE_TOKEN) {
  console.error("BLOB_READ_WRITE_TOKEN is not set. Run with: node --env-file=.env.local scripts/upload-audio.mjs");
  process.exit(1);
}

const dir = path.resolve(process.argv[2] ?? "public/audio");
const manifestPath = path.resolve("content/audio.json");
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".m4a"));
if (files.length === 0) {
  console.error(`No .m4a files in ${dir}`);
  process.exit(1);
}

const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, "utf-8")) : {};
let baseUrl = "";

for (const file of files) {
  const body = fs.createReadStream(path.join(dir, file));
  const size = (fs.statSync(path.join(dir, file)).size / 1024 / 1024).toFixed(1);
  process.stdout.write(`Uploading ${file} (${size} MB)... `);
  const blob = await put(`audio/${file}`, body, {
    access: "public",
    contentType: "audio/mp4",
    addRandomSuffix: false, // keep the URL predictable: <base>/<file>
    allowOverwrite: true, // re-uploading a re-recording replaces the old one
    cacheControlMaxAge: 60 * 60 * 24, // a day, so a replaced recording isn't cached for a month
    multipart: true,
  });
  manifest[file.replace(/\.m4a$/, "")] = file;
  baseUrl = blob.url.slice(0, blob.url.lastIndexOf("/"));
  console.log("done");
}

const sorted = Object.fromEntries(Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b)));
fs.writeFileSync(manifestPath, JSON.stringify(sorted, null, 2) + "\n");
console.log(`\nUpdated ${path.relative(process.cwd(), manifestPath)}.\nSet this in Vercel (Production and Preview) and in .env.local:\n  AUDIO_BASE_URL=${baseUrl}`);
