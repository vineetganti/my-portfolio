// Uploads the signed Second brain snapshot (written by `nb publish`) to Vercel Blob.
//
//   node --env-file=.env.local scripts/upload-second-brain.mjs [folder] [--dry-run] [--key <base64 or file>]
//
// folder defaults to second-brain/data/out/public. Needs BLOB_READ_WRITE_TOKEN (like scripts/upload-audio.mjs); the token
// stays on this machine and is never read by the website. --dry-run verifies and prints the plan without uploading.
//
// Safety rules:
//  1. EVERY file is verified against the public key first (signature, then content checks, the same code the site runs).
//     If anything fails, nothing is uploaded.
//  2. The files currently live (current/) are copied to previous/ first, so the site always has a verified fallback.
//  3. status.json is uploaded last, so a new status never points at half-uploaded lists.
// Afterwards set SECOND_BRAIN_BASE_URL (printed below) in Vercel, once.
import fs from "node:fs";
import path from "node:path";
import { copy, put } from "@vercel/blob";
import { SNAPSHOT_FILES, publicKeyFromRaw, verifyAndParse, verifySignature } from "../src/lib/secondBrainCore.mjs";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const positional = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--key");
const dir = path.resolve(positional[0] ?? "second-brain/data/out/public");
const dryRun = flag("--dry-run");
const PREFIX = "second-brain";
const CONTENT_TYPES = { ".json": "application/json", ".xml": "application/rss+xml; charset=utf-8", ".sig": "text/plain" };

function loadKey() {
  const given = option("--key") ?? process.env.SECOND_BRAIN_PUBLIC_KEY;
  const fromFile = path.resolve("second-brain/data/keys/public.raw.b64");
  const raw = given && fs.existsSync(given) ? fs.readFileSync(given, "utf8") : (given ?? (fs.existsSync(fromFile) ? fs.readFileSync(fromFile, "utf8") : ""));
  if (!raw.trim()) fail("No public key. Pass --key, set SECOND_BRAIN_PUBLIC_KEY, or run `nb keys init` first.");
  return publicKeyFromRaw(raw);
}

function fail(message) {
  console.error(`\nREFUSING TO UPLOAD: ${message}`);
  process.exit(1);
}

if (!fs.existsSync(dir)) fail(`${dir} does not exist. Run \`nb publish\` first.`);
const key = loadKey();

// 1. verify everything before touching the network
const files = [];
for (const name of SNAPSHOT_FILES) {
  const dataPath = path.join(dir, name);
  const sigPath = `${dataPath}.sig`;
  if (!fs.existsSync(dataPath) || !fs.existsSync(sigPath)) fail(`${name} or its .sig is missing in ${dir}. Run \`nb publish\` with a signing key (\`nb keys init\`).`);
  const bytes = fs.readFileSync(dataPath);
  const sig = fs.readFileSync(sigPath, "utf8");
  let summary;
  if (name.endsWith(".json")) {
    const r = verifyAndParse(name === "status.json" ? "status" : "feed", bytes, sig, key);
    if (!r.ok) fail(`${name}: ${r.reason}`);
    summary = r.status ? `enabled=${r.status.enabled}${r.status.note ? ` ("${r.status.note}")` : ""}` : `${r.feed.items.length} items, generated ${r.feed.generatedAt}`;
  } else {
    if (!verifySignature(bytes, sig, key)) fail(`${name}: signature does not verify`);
    summary = "signature ok";
  }
  files.push({ name, bytes, sigBytes: Buffer.from(sig), summary });
  console.log(`verified  ${name.padEnd(18)} ${String(bytes.length).padStart(7)} bytes  ${summary}`);
}

if (dryRun) {
  console.log(`\nDry run: all ${files.length} files verified. Would copy ${PREFIX}/current/* to ${PREFIX}/previous/*, then upload to ${PREFIX}/current/ (status.json last).`);
  process.exit(0);
}
if (!process.env.BLOB_READ_WRITE_TOKEN) fail("BLOB_READ_WRITE_TOKEN is not set. Run with: node --env-file=.env.local scripts/upload-second-brain.mjs");

const blobOptions = (name) => ({
  access: "public",
  contentType: CONTENT_TYPES[path.extname(name)],
  addRandomSuffix: false, // keep the URLs predictable: <base>/current/<file>
  allowOverwrite: true,
  cacheControlMaxAge: 60, // the shortest Blob allows: a new snapshot or a pause should not sit in a CDN for long
});

// 2. keep the live copy as the fallback
console.log("\nkeeping the live copy as previous/ ...");
for (const name of SNAPSHOT_FILES.flatMap((n) => [n, `${n}.sig`])) {
  try {
    await copy(`${PREFIX}/current/${name}`, `${PREFIX}/previous/${name}`, blobOptions(name));
  } catch (e) {
    // First upload: nothing to keep. Blob reports a missing source as "The specified key does not exist".
    if (e?.name === "BlobNotFoundError" || /not found|does not exist/i.test(String(e?.message))) continue;
    throw e;
  }
}

// 3. upload: the data files and their signatures, status last
let base = "";
for (const f of files) {
  process.stdout.write(`uploading ${f.name} ... `);
  const data = await put(`${PREFIX}/current/${f.name}`, f.bytes, blobOptions(f.name));
  await put(`${PREFIX}/current/${f.name}.sig`, f.sigBytes, blobOptions(`${f.name}.sig`));
  base = data.url.slice(0, data.url.lastIndexOf("/current/"));
  console.log("done");
}
console.log(`\nUploaded ${files.length} files. The site picks them up within about 15 minutes.\nSet this once in Vercel (Production and Preview) and in .env.local:\n  SECOND_BRAIN_BASE_URL=${base}`);
