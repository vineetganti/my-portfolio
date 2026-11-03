import fs from "fs";
import path from "path";
import { getAllPosts } from "./blog";
import { getSeriesInfo } from "./sections";

/**
 * Flashcard decks for the home page, one JSON file per series in content/flashcards/.
 * A card is a multiple-choice question; `answer` is the index of the correct option and
 * `post` is the slug of the post the question comes from.
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
  series: string;
  title: string;
  cards: Flashcard[];
  /** Post slug to title, for the "from this post" link on the answer. */
  posts: Record<string, string>;
}

const DECKS_DIR = path.join(process.cwd(), "content", "flashcards");
const DECK_SERIES = ["llm-architectures", "agentic-ai"];
const DECK_SIZE = 50;

function readDeck(series: string): FlashcardDeck {
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
  return { series, title: getSeriesInfo(series).title, cards: raw, posts };
}

export function getFlashcardDecks(): FlashcardDeck[] {
  return DECK_SERIES.map(readDeck);
}
