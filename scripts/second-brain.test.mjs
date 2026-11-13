// Tests for src/lib/secondBrainCore.mjs.   Run: npm run test:second-brain   (uses Node's built-in test runner)
//
// Part 1 uses a fixture written and signed by the real Python publisher, proving the two languages agree.
// Part 2 signs hand-made files with a throwaway key to prove every bad input is rejected.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  MAX_ITEMS,
  isSafeHttpsUrl,
  publicKeyFromRaw,
  validateFeed,
  verifyAndParse,
  verifySignature,
} from "../src/lib/secondBrainCore.mjs";

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "second-brain");
const read = (name) => fs.readFileSync(path.join(FIXTURE, name));
const text = (name) => fs.readFileSync(path.join(FIXTURE, name), "utf8").trim();
const NOW = Date.parse("2026-11-03T00:00:00Z"); // the fixture was generated 2026-11-02T12:00Z
const DAY = 24 * 60 * 60 * 1000;
const key = publicKeyFromRaw(text("public.raw.b64"));

// ---- Part 1: files written and signed by the Python publisher -----------------------------------------------------------
test("python-signed good-reads.json verifies and is normalised", () => {
  const r = verifyAndParse("feed", read("good-reads.json"), text("good-reads.json.sig"), key, NOW);
  assert.equal(r.ok, true, r.reason);
  assert.deepEqual(r.feed.items.map((i) => i.title).sort(), ["Post alpha", "Post beta"]);
  assert.equal(r.feed.ageDays, 0);
  const it = r.feed.items[0];
  assert.match(it.url, /^https:\/\//);
  assert.ok(it.aiLabel.startsWith("Written by an AI") && it.summary && it.source);
  assert.deepEqual(Object.keys(it).sort(), ["aiLabel", "id", "published", "source", "summary", "tags", "title", "url", "why"]);
});

test("python-signed daily feed and status verify", () => {
  const daily = verifyAndParse("feed", read("feed.json"), text("feed.json.sig"), key, NOW);
  assert.equal(daily.ok, true, daily.reason);
  assert.deepEqual(daily.feed.items.map((i) => i.title), ["Post daily"]); // a good read is not repeated in the daily list
  assert.ok(daily.feed.items[0].tags.includes("raft"));
  const status = verifyAndParse("status", read("status.json"), text("status.json.sig"), key, NOW);
  assert.equal(status.ok, true, status.reason);
  assert.equal(status.status.enabled, true);
});

test("the python-signed xml verifies too (the RSS route serves verified bytes)", () => {
  assert.equal(verifySignature(read("good-reads.xml"), text("good-reads.xml.sig"), key), true);
  assert.equal(verifySignature(read("feed.xml"), text("feed.xml.sig"), key), true);
});

test("one changed byte, a swapped signature, a missing or garbage signature, and another key all fail", () => {
  const bytes = read("good-reads.json");
  const sig = text("good-reads.json.sig");
  const tampered = Buffer.from(bytes);
  tampered[tampered.indexOf(Buffer.from("Post alpha"))] ^= 0x01;
  assert.equal(verifyAndParse("feed", tampered, sig, key, NOW).ok, false);
  assert.equal(verifyAndParse("feed", bytes, text("feed.json.sig"), key, NOW).ok, false); // another genuine file's signature
  assert.equal(verifyAndParse("feed", bytes, "", key, NOW).ok, false);
  assert.equal(verifyAndParse("feed", bytes, "not base64 at all !!", key, NOW).ok, false);
  assert.equal(verifyAndParse("feed", bytes, Buffer.alloc(10).toString("base64"), key, NOW).ok, false); // wrong length
  const other = crypto.generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "der" }).subarray(-32).toString("base64");
  assert.equal(verifyAndParse("feed", bytes, sig, publicKeyFromRaw(other), NOW).ok, false);
});

test("an attacker cannot flip the kill switch: a status edited to enabled=true or false fails", () => {
  const sig = text("status.json.sig");
  const edited = Buffer.from(read("status.json").toString("utf8").replace("true", "false"));
  assert.equal(verifyAndParse("status", edited, sig, key, NOW).ok, false);
});

// ---- Part 2: hand-made files signed with a throwaway key ---------------------------------------------------------------------
const pair = crypto.generateKeyPairSync("ed25519");
const myKey = publicKeyFromRaw(pair.publicKey.export({ type: "spki", format: "der" }).subarray(-32).toString("base64"));
const signed = (obj) => {
  const bytes = Buffer.from(JSON.stringify(obj));
  return [bytes, crypto.sign(null, bytes, pair.privateKey).toString("base64")];
};
const item = (over = {}) => ({
  id: "abc123", external_url: "https://example.com/post", title: "T", content_text: "S", date_published: "2026-11-01T00:00:00Z",
  tags: ["a"], authors: [{ name: "Src" }], _ai_note: { label: "Written by an AI model", why_it_matters: "w" }, ...over,
});
const feed = (over = {}, items = [item()]) => ({ _schema: 1, _generated_at: "2026-11-02T12:00:00Z", _count: items.length, items, ...over });
const check = (obj, kind = "feed") => verifyAndParse(kind, ...signed(obj), myKey, NOW);

test("a minimal valid, properly signed feed is accepted", () => assert.equal(check(feed()).ok, true));

test("ids in the pipeline's real format (source:hash) are accepted, anything that could break out of an attribute is not", () => {
  assert.equal(check(feed({}, [item({ id: "meta-eng:f40574f2d402" })])).ok, true);
  for (const bad of ['a"b', "a b", "a<b", "a/b", "a#b", "a\nb"]) assert.match(check(feed({}, [item({ id: bad })])).reason, /id/, bad);
});

test("envelope problems are rejected: schema, dates, counts", () => {
  assert.match(check(feed({ _schema: 2 })).reason, /schema/);
  assert.match(check(feed({ _schema: undefined })).reason, /schema/);
  assert.match(check(feed({ _generated_at: "yesterday" })).reason, /_generated_at/);
  assert.match(check(feed({ _generated_at: new Date(NOW - 31 * DAY).toISOString() })).reason, /older than/);
  assert.equal(check(feed({ _generated_at: new Date(NOW - 29 * DAY).toISOString() })).ok, true); // old but inside the limit
  assert.equal(check(feed({ _generated_at: new Date(NOW - 29 * DAY).toISOString() })).feed.ageDays, 29); // so the page can warn
  assert.match(check(feed({ _generated_at: new Date(NOW + 3 * 3600 * 1000).toISOString() })).reason, /future/);
  assert.match(check(feed({ _count: 5 })).reason, /_count/);
  assert.match(check(feed({ items: "nope", _count: undefined })).reason, /list/);
  assert.match(check([1, 2]).reason, /object/);
});

test("links must be https, without credentials, with a real host", () => {
  for (const bad of ["http://example.com/x", "javascript:alert(1)", "data:text/html,<script>1</script>", "https://user:pw@example.com/x",
    "https://localhost/x", "ftp://example.com/x", "//example.com/x", "", "x".repeat(3000)]) {
    assert.equal(isSafeHttpsUrl(bad), false, bad);
    assert.match(check(feed({}, [item({ external_url: bad })])).reason, /external_url/);
  }
  assert.equal(isSafeHttpsUrl("https://www.uber.com/gb/en/blog/post/"), true);
});

test("malformed items are rejected, not repaired", () => {
  const cases = [
    [{ id: "has space" }, /id/], [{ id: "" }, /id/], [{ title: "" }, /title/], [{ title: "x".repeat(301) }, /title/],
    [{ content_text: "x".repeat(2001) }, /summary/], [{ date_published: "soon" }, /date/], [{ tags: "a" }, /tags/],
    [{ tags: Array(13).fill("t") }, /tags/], [{ authors: [] }, /source/], [{ _ai_note: { label: "" } }, /AI note/], [{ _ai_note: undefined }, /AI note/],
  ];
  for (const [over, re] of cases) {
    const r = check(feed({}, [item(over)]));
    if (re) assert.match(r.reason ?? "ok", re, JSON.stringify(over));
  }
  assert.equal(check(feed({ _count: MAX_ITEMS + 1 }, Array.from({ length: MAX_ITEMS + 1 }, (_, i) => item({ id: `i${i}` })))).ok, false);
});

test("unknown fields are dropped: only the whitelisted fields reach the page", () => {
  const r = check(feed({}, [item({ secret: "x", relevance: 5, url_key: "k", note: "private" })]));
  assert.equal(r.ok, true);
  assert.equal(JSON.stringify(r.feed).includes("private"), false);
  assert.equal("relevance" in r.feed.items[0], false);
});

test("status: enabled must be a boolean, and a paused status carries its note", () => {
  const base = { _schema: 1, _generated_at: "2026-11-02T12:00:00Z" };
  assert.equal(check({ ...base, enabled: "yes" }, "status").ok, false);
  assert.equal(check({ ...base }, "status").ok, false);
  const paused = check({ ...base, enabled: false, note: "Back soon" }, "status");
  assert.deepEqual([paused.ok, paused.status.enabled, paused.status.note], [true, false, "Back soon"]);
  assert.equal(check({ ...base, enabled: false, note: "x".repeat(201) }, "status").ok, false);
});

test("a public key of the wrong size is refused, and invalid JSON behind a valid signature is rejected", () => {
  assert.throws(() => publicKeyFromRaw("AAAA"));
  assert.throws(() => publicKeyFromRaw(""));
  const bytes = Buffer.from("{not json");
  const sig = crypto.sign(null, bytes, pair.privateKey).toString("base64");
  assert.match(verifyAndParse("feed", bytes, sig, myKey, NOW).reason, /JSON/);
  assert.equal(validateFeed(null, NOW).ok, false);
});
