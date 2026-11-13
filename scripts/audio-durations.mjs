// Measures the length of each recorded narration and writes content/audio-durations.json
// ({ slug: seconds }), which the Podcasts pages show next to each episode.
//
//   node scripts/audio-durations.mjs [folder]
//
// folder defaults to public/audio. Needs ffprobe (part of FFmpeg) on the PATH.
// scripts/upload-audio.mjs runs this after an upload, so a re-recording updates its length.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function measure(file) {
  const out = execFileSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", file],
    { encoding: "utf-8" },
  );
  const seconds = Number.parseFloat(out.trim());
  if (!Number.isFinite(seconds)) throw new Error(`ffprobe gave no duration for ${file}`);
  return Math.round(seconds);
}

export function writeDurations(dir) {
  const manifestPath = path.resolve("content/audio-durations.json");
  const existing = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, "utf-8")) : {};
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".m4a"));
  for (const file of files) existing[file.replace(/\.m4a$/, "")] = measure(path.join(dir, file));
  const sorted = Object.fromEntries(Object.entries(existing).sort(([a], [b]) => a.localeCompare(b)));
  fs.writeFileSync(manifestPath, JSON.stringify(sorted, null, 2) + "\n");
  return { manifestPath, count: files.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = path.resolve(process.argv[2] ?? "public/audio");
  try {
    const { manifestPath, count } = writeDurations(dir);
    console.log(`Measured ${count} files; wrote ${path.relative(process.cwd(), manifestPath)}.`);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    console.error("Is ffprobe installed and on the PATH?");
    process.exit(1);
  }
}
