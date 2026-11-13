// Verification and validation for the Second brain snapshot. Plain JavaScript with no Next.js or environment access,
// so the site (src/lib/secondBrain.ts), the upload script (scripts/upload-second-brain.mjs) and the tests
// (scripts/second-brain.test.mjs) all run the SAME code.
//
// The pipeline (second-brain/, Python) writes JSON files and signs each one with an Ed25519 key that never leaves the
// owner's machine. Nothing is shown unless its signature verifies against the public key and the content passes the
// checks below. A failure is never "fixed up": the caller shows the previous verified copy or nothing.
import crypto from "node:crypto";

export const SCHEMA = 1;
export const MAX_AGE_DAYS = 30; // older than this is rejected (limits how long a replayed old file could be shown)
export const STALE_NOTICE_DAYS = 7; // older than this is still shown, with a "last updated" warning
export const MAX_ITEMS = 500;

const DAY_MS = 24 * 60 * 60 * 1000;
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex"); // DER header for a raw 32-byte Ed25519 public key

/** Build a public key from the 32 raw bytes, base64 encoded (second-brain/data/keys/public.raw.b64). Throws if malformed. */
export function publicKeyFromRaw(rawB64) {
  const raw = Buffer.from(String(rawB64 ?? "").trim(), "base64");
  if (raw.length !== 32) throw new Error("public key must be 32 raw bytes, base64 encoded");
  return crypto.createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, raw]), format: "der", type: "spki" });
}

/** True only for a valid signature over exactly these bytes. Any problem (bad base64, wrong length, wrong key) is false. */
export function verifySignature(bytes, sigB64, publicKey) {
  try {
    const sig = Buffer.from(String(sigB64 ?? "").trim(), "base64");
    if (sig.length !== 64) return false;
    return crypto.verify(null, bytes, publicKey, sig);
  } catch {
    return false;
  }
}

const isString = (v, max, min = 0) => typeof v === "string" && v.length >= min && v.length <= max;
const fail = (reason) => ({ ok: false, reason });

function checkEnvelope(json, now) {
  if (json === null || typeof json !== "object" || Array.isArray(json)) return "not an object";
  if (json._schema !== SCHEMA) return `unknown schema ${JSON.stringify(json._schema)}`;
  const generated = typeof json._generated_at === "string" ? Date.parse(json._generated_at) : NaN;
  if (Number.isNaN(generated)) return "missing or invalid _generated_at";
  if (generated - now > 60 * 60 * 1000) return "_generated_at is in the future";
  if (now - generated > MAX_AGE_DAYS * DAY_MS) return `older than ${MAX_AGE_DAYS} days`;
  return null;
}

/** HTTPS only, no credentials in the URL: a link a visitor can safely be sent to. */
export function isSafeHttpsUrl(value) {
  if (!isString(value, 2048, 1)) return false;
  try {
    const u = new URL(value);
    return u.protocol === "https:" && !u.username && !u.password && u.hostname.includes(".");
  } catch {
    return false;
  }
}

/** Validate one JSON Feed file (good-reads.json or feed.json). Returns {ok, feed} with ONLY whitelisted fields, or {ok:false, reason}. */
export function validateFeed(json, now = Date.now()) {
  const bad = checkEnvelope(json, now);
  if (bad) return fail(bad);
  if (!Array.isArray(json.items)) return fail("items is not a list");
  if (json.items.length > MAX_ITEMS) return fail("too many items");
  if (json._count !== undefined && json._count !== json.items.length) return fail("_count does not match items");
  const items = [];
  for (const [i, it] of json.items.entries()) {
    const where = `item ${i}`;
    if (it === null || typeof it !== "object") return fail(`${where}: not an object`);
    if (!isString(it.id, 80, 1) || !/^[A-Za-z0-9._:-]+$/.test(it.id)) return fail(`${where}: bad id`); // the pipeline's ids look like "meta-eng:f40574f2d402"
    if (!isString(it.title, 300, 1)) return fail(`${where}: bad title`);
    if (!isSafeHttpsUrl(it.external_url)) return fail(`${where}: external_url is not a safe https link`);
    if (!isString(it.content_text, 2000)) return fail(`${where}: bad summary`);
    if (Number.isNaN(Date.parse(it.date_published))) return fail(`${where}: bad date`);
    const tags = it.tags ?? [];
    if (!Array.isArray(tags) || tags.length > 12 || !tags.every((t) => isString(t, 40, 1))) return fail(`${where}: bad tags`);
    const source = it.authors?.[0]?.name;
    if (!isString(source, 120, 1)) return fail(`${where}: bad source name`);
    const note = it._ai_note ?? {};
    if (!isString(note.label, 200, 1) || !isString(note.why_it_matters ?? "", 1500)) return fail(`${where}: bad AI note`);
    items.push({
      id: it.id,
      title: it.title,
      url: it.external_url,
      summary: it.content_text,
      published: new Date(it.date_published).toISOString(),
      tags,
      source,
      aiLabel: note.label,
      why: note.why_it_matters ?? "",
    });
  }
  const generatedAt = new Date(json._generated_at).toISOString();
  return { ok: true, feed: { generatedAt, ageDays: Math.floor((now - Date.parse(generatedAt)) / DAY_MS), items } };
}

/** Validate status.json (the signed kill switch). */
export function validateStatus(json, now = Date.now()) {
  const bad = checkEnvelope(json, now);
  if (bad) return fail(bad);
  if (typeof json.enabled !== "boolean") return fail("enabled is not a boolean");
  if (!isString(json.note ?? "", 200)) return fail("bad note");
  return { ok: true, status: { enabled: json.enabled, note: json.note ?? "", generatedAt: new Date(json._generated_at).toISOString() } };
}

/**
 * Verify, then parse and validate. `bytes` is the file exactly as fetched; `kind` is "feed" or "status".
 * Order matters: the signature is checked on the raw bytes BEFORE anything is parsed.
 */
export function verifyAndParse(kind, bytes, sigB64, publicKey, now = Date.now()) {
  if (!verifySignature(bytes, sigB64, publicKey)) return fail("signature does not verify");
  let json;
  try {
    json = JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch {
    return fail("not valid JSON");
  }
  return kind === "status" ? validateStatus(json, now) : validateFeed(json, now);
}

/** Files the pipeline publishes, in upload order (status last, so a new status never points at half-uploaded lists). */
export const SNAPSHOT_FILES = ["good-reads.json", "good-reads.xml", "feed.json", "feed.xml", "status.json"];
