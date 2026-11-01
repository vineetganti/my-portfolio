/**
 * Turns the rendered post body into short chunks the browser can speak.
 *
 * Prose is read. Diagrams are read from their alt text (the written description
 * of the picture) when it is a real description. Code, tables and the collapsed
 * recall questions are skipped, with a short spoken note in their place
 * ("Code example skipped."). A run of the same kind of skipped block gets one
 * note, not one per block.
 */
export interface SpeechChunk {
  /** The element to highlight while this chunk is spoken. */
  el: Element;
  text: string;
  /** Index of the source block (several chunks can come from one paragraph). */
  item: number;
  words: number;
}

const SKIPPED: Record<string, string> = {
  PRE: "Code example skipped.",
  TABLE: "Table skipped.",
  IMG: "Diagram skipped.",
  DETAILS: "Recall questions skipped.",
};

const SKIP_CONTAINERS = "pre,table,details";
/** `.diagram` is an inlined SVG diagram; it is read like an image. */
const READ_SELECTOR = "h2,h3,h4,p,li,pre,table,img,.diagram,details";
/** Browsers cut off very long utterances, so keep each one short. */
const MAX_CHUNK = 180;
/** Rough speaking speed at 1x, used for time estimates. */
export const WORDS_PER_MINUTE = 165;

/** An element's own text, leaving out anything handled as its own block. */
function ownText(el: Element): string {
  const copy = el.cloneNode(true) as Element;
  const drop =
    el.tagName === "LI"
      ? "p,ul,ol,pre,table,details,blockquote,svg,button,img,.diagram,.heading-anchor"
      : "svg,button,img,.diagram,.heading-anchor";
  copy.querySelectorAll(drop).forEach((n) => n.remove());
  return copy.textContent ?? "";
}

/** Makes symbols and spacing sound right when spoken. */
export function cleanForSpeech(raw: string): string {
  return raw
    .replace(/\s*(?:→|->|⇒)\s*/g, " to ")
    .replace(/\s*×\s*/g, " times ")
    .replace(/\s*[—–]\s*/g, ", ")
    .replace(/\s*·\s*/g, ", ")
    .replace(/…/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Splits at sentence ends (not at decimals like 1.5) and regroups into short chunks. */
export function splitForSpeech(text: string): string[] {
  const sentences = text.split(/(?<=[.!?])\s+/);
  const out: string[] = [];
  let cur = "";
  for (const s of sentences) {
    if (cur && cur.length + s.length + 1 > MAX_CHUNK) {
      out.push(cur);
      cur = s;
    } else {
      cur = cur ? `${cur} ${s}` : s;
    }
  }
  if (cur) out.push(cur);
  return out;
}

const countWords = (s: string) => s.split(/\s+/).filter(Boolean).length;

export interface CollectOptions {
  /** Read an image's alt text aloud instead of skipping the image. Default true. */
  describeImages?: boolean;
}

/** Alt text counts as a description only if it is a real sentence, not a file name like `flow_chart`. */
function imageDescription(el: Element): string {
  const alt = (el.getAttribute("alt") ?? el.getAttribute("aria-label") ?? "").trim();
  return alt.length >= 12 && /\s/.test(alt) ? alt : "";
}

export function collectChunks(root: Element, options: CollectOptions = {}): SpeechChunk[] {
  const describeImages = options.describeImages ?? true;
  const chunks: SpeechChunk[] = [];
  let item = -1;
  let lastSkip = "";

  for (const el of root.querySelectorAll(READ_SELECTOR)) {
    const tag = el.matches(".diagram") ? "IMG" : el.tagName;
    const note = SKIPPED[tag];

    if (note) {
      // A skipped block nested inside another skipped block adds nothing.
      if (el.parentElement?.closest(SKIP_CONTAINERS)) continue;

      const description = tag === "IMG" && describeImages ? imageDescription(el) : "";
      if (description) {
        lastSkip = "";
        item++;
        let spoken = cleanForSpeech(`Image: ${description}`);
        if (!/[.!?:]$/.test(spoken)) spoken += ".";
        for (const part of splitForSpeech(spoken)) {
          chunks.push({ el, text: part, item, words: countWords(part) });
        }
        continue;
      }

      if (lastSkip === tag) continue;
      lastSkip = tag;
      chunks.push({ el, text: note, item: ++item, words: countWords(note) });
      continue;
    }

    if (el.closest(SKIP_CONTAINERS)) continue; // text inside code, tables, details

    let text = cleanForSpeech(ownText(el));
    if (!text) continue;
    if (/^H[2-4]$/.test(tag) && !/[.!?:]$/.test(text)) text += "."; // a pause after headings
    lastSkip = "";
    item++;
    for (const part of splitForSpeech(text)) {
      chunks.push({ el, text: part, item, words: countWords(part) });
    }
  }
  return chunks;
}

/** Index of the first chunk of the block before the one `from` is in (or the start of the current block). */
export function previousBlockStart(chunks: SpeechChunk[], from: number): number {
  const cur = chunks[from]?.item ?? 0;
  const startOfCur = chunks.findIndex((c) => c.item === cur);
  if (from > startOfCur) return startOfCur;
  const prev = chunks.findIndex((c) => c.item === cur - 1);
  return prev === -1 ? 0 : prev;
}

/** Index of the first chunk of the next block, or -1 at the end. */
export function nextBlockStart(chunks: SpeechChunk[], from: number): number {
  const cur = chunks[from]?.item ?? 0;
  return chunks.findIndex((c) => c.item > cur);
}
