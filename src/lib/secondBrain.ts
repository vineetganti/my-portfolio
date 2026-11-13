import { cacheLife, cacheTag } from "next/cache";
import { publicKeyFromRaw, verifyAndParse } from "./secondBrainCore.mjs";

/**
 * The Second brain page's data. Everything here comes from files the owner's pipeline signs with a private key that never
 * leaves the owner's machine. This module fetches them, verifies the signature on the raw bytes BEFORE parsing, validates the
 * content, and returns plain data. It never returns anything unverified, and there is no code path that writes anything.
 *
 * Configuration (Vercel environment variables):
 *   SECOND_BRAIN_BASE_URL    where the files are hosted, e.g. https://<store>.public.blob.vercel-storage.com/second-brain
 *   SECOND_BRAIN_PUBLIC_KEY  the 32-byte Ed25519 public key, base64 (second-brain/data/keys/public.raw.b64). Public by design.
 *   SECOND_BRAIN_ENABLED     "false" hides the feature (needs a redeploy to take effect; `nb publish --pause` is the fast switch)
 */

export interface SecondBrainItem {
  id: string;
  title: string;
  /** The ORIGINAL article. Always https. */
  url: string;
  /** AI-written summary, plain text. */
  summary: string;
  /** ISO date of the article. */
  published: string;
  tags: string[];
  /** The publication it came from. */
  source: string;
  /** Label saying the summary and note are AI-written. */
  aiLabel: string;
  /** AI-written "why it matters", plain text. */
  why: string;
}

export interface SecondBrainFeed {
  generatedAt: string;
  ageDays: number;
  items: SecondBrainItem[];
}

export type SecondBrainSnapshot =
  | { state: "off" }
  | { state: "not-configured" }
  | { state: "paused"; note: string }
  | { state: "unavailable" }
  | { state: "ok"; goodReads: SecondBrainFeed | null; daily: SecondBrainFeed | null; updatedAt: string; staleDays: number };

type Parsed =
  | { ok: false; reason: string }
  | { ok: true; feed: SecondBrainFeed; status?: undefined }
  | { ok: true; status: { enabled: boolean; note: string; generatedAt: string }; feed?: undefined };

const FETCH_TIMEOUT_MS = 8000; // a slow host must not hang a build or a request
const STALE_NOTICE_DAYS = 7;

async function fetchBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

/** Fetch `name` and its `.sig` from current/, then previous/. Returns the first copy that verifies, or null. */
async function fetchVerified(
  kind: "feed" | "status",
  name: string,
  base: string,
  key: ReturnType<typeof publicKeyFromRaw>,
): Promise<Parsed | null> {
  for (const folder of ["current", "previous"]) {
    try {
      const [file, sig] = await Promise.all([
        fetchBytes(`${base}/${folder}/${name}`),
        fetchBytes(`${base}/${folder}/${name}.sig`),
      ]);
      const parsed = verifyAndParse(kind, file, new TextDecoder().decode(sig), key) as Parsed;
      if (parsed.ok) return parsed;
      // A stable prefix, so Vercel's log search or an alert can catch it.
      console.error(`[second-brain] verify-failed ${name} (${folder}): ${parsed.reason}`);
    } catch (e) {
      console.error(`[second-brain] fetch-failed ${name} (${folder}): ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return null;
}

/**
 * The verified snapshot, cached for 15 minutes (so a published change, or a pause, shows within about 15 minutes).
 * A failed fetch is cached for the same time, which bounds how long a transient problem is visible.
 */
export async function getSecondBrain(): Promise<SecondBrainSnapshot> {
  "use cache";
  cacheLife({ stale: 300, revalidate: 900, expire: 86400 });
  cacheTag("second-brain");

  if (process.env.SECOND_BRAIN_ENABLED === "false") return { state: "off" };
  const base = process.env.SECOND_BRAIN_BASE_URL?.replace(/\/+$/, "");
  const rawKey = process.env.SECOND_BRAIN_PUBLIC_KEY;
  if (!base || !rawKey) return { state: "not-configured" };

  let key: ReturnType<typeof publicKeyFromRaw>;
  try {
    key = publicKeyFromRaw(rawKey);
  } catch (e) {
    console.error(`[second-brain] bad-public-key: ${e instanceof Error ? e.message : String(e)}`);
    return { state: "not-configured" };
  }

  const [status, good, daily] = await Promise.all([
    fetchVerified("status", "status.json", base, key),
    fetchVerified("feed", "good-reads.json", base, key),
    fetchVerified("feed", "feed.json", base, key),
  ]);

  // No verified status means we cannot know the switch is on: fail closed.
  if (!status?.ok || !status.status) return { state: "unavailable" };
  if (!status.status.enabled) return { state: "paused", note: status.status.note };

  const goodReads = good?.ok && good.feed ? good.feed : null;
  const dailyFeed = daily?.ok && daily.feed ? daily.feed : null;
  if (!goodReads && !dailyFeed) return { state: "unavailable" };

  const newest = [goodReads, dailyFeed].filter((f): f is SecondBrainFeed => f !== null).map((f) => f.generatedAt).sort().pop()!;
  const staleDays = Math.max(0, ...[goodReads, dailyFeed].filter((f): f is SecondBrainFeed => f !== null).map((f) => f.ageDays));
  return { state: "ok", goodReads, daily: dailyFeed, updatedAt: newest, staleDays: staleDays >= STALE_NOTICE_DAYS ? staleDays : 0 };
}
