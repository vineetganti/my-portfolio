import fs from "fs";
import path from "path";
import { getAllPosts } from "./blog";
import { getSeriesInfo } from "./sections";

/**
 * Flashcard decks for the home page, one JSON file per deck in content/flashcards/.
 * A card is a multiple-choice question; `answer` is the index of the correct option and
 * `post` is the slug of the post the question comes from. A long series can split into several
 * decks: decks that share a `group` appear together under one entry on the home page.
 */
export interface Flashcard {
  id: string;
  post: string;
  q: string;
  options: string[];
  answer: number;
  why: string;
}

export interface FlashcardDeck {
  /** The deck's file name, also its key for the saved best score. */
  series: string;
  title: string;
  /** The group this deck sits in on the chooser, if any. */
  group?: string;
  cards: Flashcard[];
  /** Post slug to title, for the "from this post" link on the answer. */
  posts: Record<string, string>;
}

const DECKS_DIR = path.join(process.cwd(), "content", "flashcards");
const DECK_SIZE = 50;
const DB = "Database Engineering";
const DECKS: { series: string; title?: string; group?: string }[] = [
  { series: "llm-architectures" },
  { series: "agentic-ai" },
  { series: "db-transactions", title: "Transactions and concurrency", group: DB },
  { series: "db-storage-indexing", title: "Storage and indexing", group: DB },
  { series: "db-scaling", title: "Scaling out", group: DB },
  { series: "db-engines-internals", title: "Engines and internals", group: DB },
];

function readDeck({ series, title, group }: (typeof DECKS)[number]): FlashcardDeck {
  const raw = JSON.parse(fs.readFileSync(path.join(DECKS_DIR, `${series}.json`), "utf8")) as Flashcard[];
  const titles = Object.fromEntries(getAllPosts().map((p) => [p.slug, p.title]));
  const seen = new Set<string>();

  // Fail the build on a malformed card rather than shipping a deck with a wrong answer key.
  for (const card of raw) {
    const where = `flashcards/${series}.json card "${card.id}"`;
    if (seen.has(card.id)) throw new Error(`${where}: duplicate id`);
    seen.add(card.id);
    if (card.options.length !== 4) throw new Error(`${where}: needs exactly 4 options`);
    if (new Set(card.options).size !== 4) throw new Error(`${where}: options must differ`);
    if (!Number.isInteger(card.answer) || card.answer < 0 || card.answer > 3) {
      throw new Error(`${where}: answer must be 0-3`);
    }
    if (!titles[card.post]) throw new Error(`${where}: unknown post "${card.post}"`);
  }
  if (raw.length !== DECK_SIZE) throw new Error(`flashcards/${series}.json has ${raw.length} cards, expected ${DECK_SIZE}`);

  const posts = Object.fromEntries([...new Set(raw.map((c) => c.post))].map((slug) => [slug, titles[slug]]));
  return { series, title: title ?? getSeriesInfo(series).title, group, cards: raw, posts };
}

export function getFlashcardDecks(): FlashcardDeck[] {
  return DECKS.map(readDeck);
}
