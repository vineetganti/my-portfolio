// Fails if a tracked file could leak private data from the second-brain pipeline into this PUBLIC repo.
//
//   node scripts/check-public-safety.mjs          checks every file git tracks
//   node scripts/check-public-safety.mjs --staged  checks only what is staged (for a pre-commit hook)
//
// Two checks: (1) a tracked path that must never be public (database, tokens, keys, .env, runtime data),
// (2) file content that looks like a secret or a personal path. A match prints the file and line, never the secret.
// To allow a known-safe line (e.g. a test that plants a fake key), put `safety-ignore` on that line.
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const staged = process.argv.includes("--staged");
const files = execFileSync("git", staged ? ["diff", "--cached", "--name-only", "--diff-filter=ACMR"] : ["ls-files"], {
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
})
  .split("\n")
  .filter(Boolean);

const FORBIDDEN_PATHS = [
  [/(^|\/)\.env($|\.(?!example$))/, "an .env file (only .env.example may be tracked)"],
  [/(^|\/)(credentials|token)\.json$/, "Google OAuth credentials or token"],
  [/\.(sqlite3?|db)$/, "a database file"],
  [/\.(pem|key|p12|pfx)$/, "a private key or certificate"],
  [/(^|\/)private\.pem$/, "the signing key"],
  [/^second-brain\/data\//, "pipeline runtime data (database, keys, output)"],
  [/\.egg-info\//, "Python build output"],
  [/(^|\/)\.claude\/settings\.local\.json$/, "local assistant settings (contain machine paths and command history)"],
  [/(^|\/)build-log\.md$/, "the raw build log (review it before publishing)"],
];

const SECRET_PATTERNS = [
  [/AIza[0-9A-Za-z_-]{30,}/, "a Google API key"],
  [/ya29\.[0-9A-Za-z_-]{20,}/, "a Google OAuth access token"],
  [/gh[pousr]_[0-9A-Za-z]{30,}/, "a GitHub token"],
  [/github_pat_[0-9A-Za-z_]{30,}/, "a GitHub token"],
  [/sk-ant-[0-9A-Za-z_-]{20,}/, "an Anthropic API key"],
  [/vercel_blob_rw_[0-9A-Za-z_]+/, "a Vercel Blob read-write token"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "a private key block"],
  [/"refresh_token"\s*:\s*"[^"]{10,}"/, "an OAuth refresh token"],
  [/"client_secret"\s*:\s*"[^"]{10,}"/, "an OAuth client secret"],
  [/(NOTION_TOKEN|BLOB_READ_WRITE_TOKEN|ANTHROPIC_API_KEY)\s*=\s*[^\s#]{12,}/, "a secret assigned in a file"],
  [/[A-Za-z]:[\\/]+Users[\\/]+(?!(user|you|me|name|username|example|runner|Public|Default)[\\/])[A-Za-z0-9_.-]+[\\/]/, "a personal Windows path"],
  [/\/(Users|home)\/(?!(user|you|me|name|username|example|runner|vscode|node|ubuntu|app)\/)[a-z][a-z0-9_.-]{2,}\//, "a personal home path"], // placeholder users in tutorials are fine
];

const SKIP_CONTENT = /\.(png|jpe?g|gif|webp|ico|mp4|m4a|mp3|woff2?|gz|tar|pdf|zip|sqlite3?|lock)$|(^|\/)package-lock\.json$/;
const problems = [];

for (const f of files) {
  for (const [re, why] of FORBIDDEN_PATHS) {
    if (re.test(f)) problems.push(`${f}: tracked ${why}`);
  }
  if (SKIP_CONTENT.test(f) || f === "scripts/check-public-safety.mjs" || !fs.existsSync(f)) continue;
  let text;
  try {
    text = fs.readFileSync(f, "utf8");
  } catch {
    continue;
  }
  if (text.includes("\0")) continue; // binary
  text.split("\n").forEach((line, i) => {
    if (line.includes("safety-ignore")) return;
    for (const [re, why] of SECRET_PATTERNS) {
      if (re.test(line)) problems.push(`${f}:${i + 1}: looks like ${why}`);
    }
  });
}

if (problems.length) {
  console.error(`Public-safety check FAILED (${problems.length}):\n` + problems.map((p) => "  " + p).join("\n"));
  process.exit(1);
}
console.log(`Public-safety check passed (${files.length} files).`);
