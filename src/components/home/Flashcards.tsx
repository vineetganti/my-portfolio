"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { FlashcardDeck } from "@/lib/flashcards";

interface DealtCard {
  id: string;
  post: string;
  q: string;
  /** Options in the order shown, each with whether it is the right one. */
  options: { text: string; correct: boolean }[];
  why: string;
}

const LETTERS = ["A", "B", "C", "D"];

function shuffle<T>(items: T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** A fresh shuffle of the deck, with each card's options shuffled too, so the answer position isn't a clue. */
function deal(deck: FlashcardDeck): DealtCard[] {
  return shuffle(deck.cards).map((c) => ({
    id: c.id,
    post: c.post,
    q: c.q,
    why: c.why,
    options: shuffle(c.options.map((text, i) => ({ text, correct: i === c.answer }))),
  }));
}

const bestKey = (series: string) => `flashcards:best:${series}`;

function readBest(series: string): number | null {
  try {
    const raw = localStorage.getItem(bestKey(series));
    return raw === null ? null : Number(raw);
  } catch {
    return null;
  }
}

const BEST_EVENT = "flashcards-best";

function writeBest(series: string, score: number) {
  try {
    localStorage.setItem(bestKey(series), String(score));
  } catch {
    // Storage can be unavailable (private mode); the score still shows for this visit.
  }
  window.dispatchEvent(new Event(BEST_EVENT));
}

function subscribeBests(onChange: () => void) {
  window.addEventListener(BEST_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(BEST_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function verdict(pct: number): string {
  if (pct >= 90) return "Excellent. You could teach this series.";
  if (pct >= 75) return "Strong. A few details to revisit.";
  if (pct >= 50) return "Solid base. The posts will fill the gaps.";
  return "Good start. Worth another read of the series.";
}

export default function Flashcards({ decks }: { decks: FlashcardDeck[] }) {
  const [seriesSlug, setSeriesSlug] = useState<string | null>(null);
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [dealt, setDealt] = useState<DealtCard[]>([]);
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [correct, setCorrect] = useState(0);
  const [streak, setStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);
  const nextRef = useRef<HTMLButtonElement>(null);

  const deck = useMemo(() => decks.find((d) => d.series === seriesSlug) ?? null, [decks, seriesSlug]);

  // Saved best scores live in the browser, so the server renders none and the client reads them after hydration.
  const bestsKey = useSyncExternalStore(
    subscribeBests,
    () => decks.map((d) => readBest(d.series) ?? "").join(","),
    () => decks.map(() => "").join(","),
  );
  const bests = useMemo(() => {
    const parts = bestsKey.split(",");
    return Object.fromEntries(decks.map((d, i) => [d.series, parts[i] === "" ? null : Number(parts[i])]));
  }, [bestsKey, decks]) as Record<string, number | null>;

  const total = dealt.length;
  const finished = deck !== null && index >= total;
  const card = deck && !finished ? dealt[index] : null;
  const answered = picked !== null;
  const answeredCount = index + (answered ? 1 : 0);

  // Move focus to "Next" once an answer is revealed, so the keyboard flow is answer, then Enter.
  useEffect(() => {
    if (answered) nextRef.current?.focus();
  }, [answered]);

  function start(slug: string) {
    const d = decks.find((x) => x.series === slug);
    if (!d) return;
    setSeriesSlug(slug);
    setDealt(deal(d));
    setIndex(0);
    setPicked(null);
    setCorrect(0);
    setStreak(0);
    setBestStreak(0);
  }

  function choose(i: number) {
    if (!card || answered) return;
    const right = card.options[i].correct;
    setPicked(i);
    setCorrect((c) => c + (right ? 1 : 0));
    const nextStreak = right ? streak + 1 : 0;
    setStreak(nextStreak);
    setBestStreak((b) => Math.max(b, nextStreak));
  }

  function next() {
    if (!answered) return;
    const last = index + 1 >= total;
    setIndex((i) => i + 1);
    setPicked(null);
    if (last && deck) {
      const prev = readBest(deck.series);
      if (prev === null || correct > prev) writeBest(deck.series, correct);
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!card || answered) return;
    const n = Number(e.key);
    if (n >= 1 && n <= card.options.length) {
      e.preventDefault();
      choose(n - 1);
    }
  }

  const pct = answeredCount === 0 ? 0 : Math.round((correct / answeredCount) * 100);

  // A deck on its own is one row. Decks that share a group fold into one row that opens a sub-list.
  const groups = [...new Set(decks.map((d) => d.group).filter((g): g is string => Boolean(g)))];
  const shown = openGroup ? decks.filter((d) => d.group === openGroup) : decks.filter((d) => !d.group);

  const deckRow = (d: FlashcardDeck) => {
    const best = bests[d.series];
    return (
      <button
        key={d.series}
        type="button"
        onClick={() => start(d.series)}
        className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card-2 px-4 py-3 text-left hover:border-accent transition-colors"
      >
        <span className="font-semibold text-ink">{d.title}</span>
        <span className="shrink-0 text-xs text-ink-muted tabular-nums">
          {best == null ? `${d.cards.length} cards` : `best ${best}/${d.cards.length}`}
        </span>
      </button>
    );
  };

  return (
    <div className="rounded-2xl border border-border bg-card p-4" onKeyDown={onKeyDown}>
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <h2 className="font-heading font-extrabold text-lg tracking-tight text-ink">Test yourself</h2>
        {deck && (
          <button
            type="button"
            onClick={() => setSeriesSlug(null)}
            className="text-xs font-semibold text-ink-muted hover:text-accent transition-colors"
          >
            Change deck
          </button>
        )}
      </div>

      {!deck && (
        <div>
          <p className="text-sm text-ink-2 leading-relaxed mb-3">
            {openGroup
              ? `${openGroup}: ${shown.length} decks of 50, by theme. Pick one.`
              : "50 harder-than-recall questions per deck, scored as you go. Pick one."}
          </p>
          <div className="grid gap-2">
            {shown.map(deckRow)}
            {!openGroup &&
              groups.map((g) => {
                const members = decks.filter((d) => d.group === g);
                return (
                  <button
                    key={g}
                    type="button"
                    onClick={() => setOpenGroup(g)}
                    className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card-2 px-4 py-3 text-left hover:border-accent transition-colors"
                  >
                    <span className="font-semibold text-ink">{g}</span>
                    <span className="shrink-0 text-xs text-ink-muted tabular-nums">
                      {members.length} decks &rarr;
                    </span>
                  </button>
                );
              })}
          </div>
          {openGroup && (
            <button
              type="button"
              onClick={() => setOpenGroup(null)}
              className="mt-3 text-xs font-semibold text-ink-muted hover:text-accent transition-colors"
            >
              &larr; All decks
            </button>
          )}
        </div>
      )}

      {deck && (
        <div className="mb-3">
          <div className="flex items-center justify-between text-xs text-ink-muted tabular-nums" aria-live="polite">
            <span>
              <strong className="text-ink">{correct}</strong> / {answeredCount} correct
              {answeredCount > 0 && <> &middot; {pct}%</>}
            </span>
            <span>
              streak <strong className="text-ink">{streak}</strong>
            </span>
          </div>
          <div
            className="mt-1.5 h-1.5 rounded-full bg-border overflow-hidden"
            role="progressbar"
            aria-label={`${deck.title} progress`}
            aria-valuemin={0}
            aria-valuemax={total}
            aria-valuenow={Math.min(answeredCount, total)}
          >
            <div className="h-full bg-accent transition-[width]" style={{ width: `${(Math.min(answeredCount, total) / total) * 100}%` }} />
          </div>
        </div>
      )}

      {card && (
        <div>
          <p className="text-xs font-semibold text-ink-muted mb-1.5">
            {deck?.title} &middot; question {index + 1} of {total}
          </p>
          <p className="font-semibold text-ink leading-snug mb-3">{card.q}</p>
          <div className="grid gap-2" role="group" aria-label="Answer options">
            {card.options.map((o, i) => {
              const isPicked = picked === i;
              const reveal = answered && (o.correct || isPicked);
              const tone = !reveal
                ? "border-border bg-card-2 hover:border-accent"
                : o.correct
                  ? "border-[var(--dg-green)] bg-[var(--dg-green-t)]"
                  : "border-[var(--dg-red)] bg-[var(--dg-red-t)]";
              return (
                <button
                  key={i}
                  type="button"
                  disabled={answered}
                  onClick={() => choose(i)}
                  aria-keyshortcuts={String(i + 1)}
                  className={`flex gap-2.5 rounded-lg border px-3 py-2 text-left text-sm text-ink-2 transition-colors disabled:cursor-default ${tone}`}
                >
                  <span className="shrink-0 font-bold text-ink-muted tabular-nums">{LETTERS[i]}</span>
                  <span>{o.text}</span>
                </button>
              );
            })}
          </div>

          {picked !== null && (
            <div className="mt-3 text-sm" role="status">
              <p className="font-bold text-ink">
                {card.options[picked].correct ? "Correct." : "Not quite."}
              </p>
              <p className="mt-1 text-ink-2 leading-relaxed">{card.why}</p>
              <Link
                href={`/blog/${card.post}`}
                className="mt-1.5 inline-block text-xs font-semibold text-ink-muted hover:text-accent transition-colors"
              >
                From: {deck?.posts[card.post]} &rarr;
              </Link>
              <button
                ref={nextRef}
                type="button"
                onClick={next}
                className="mt-3 w-full rounded-lg bg-accent px-4 py-2 font-semibold text-card hover:bg-accent-hover transition-colors"
              >
                {index + 1 >= total ? "See my score" : "Next question"}
              </button>
            </div>
          )}
          {!answered && <p className="mt-3 text-xs text-ink-muted">Tip: press 1 to 4 to answer.</p>}
        </div>
      )}

      {finished && deck && (
        <div className="text-center py-2" role="status">
          <p className="font-heading font-extrabold text-4xl text-ink tabular-nums">
            {correct}
            <span className="text-ink-muted text-2xl"> / {total}</span>
          </p>
          <p className="mt-1 text-sm text-ink-2">{verdict(Math.round((correct / total) * 100))}</p>
          <p className="mt-1 text-xs text-ink-muted">
            Best streak {bestStreak}
            {bests[deck.series] != null && <> &middot; best score {bests[deck.series]}</>}
          </p>
          <div className="mt-4 grid gap-2">
            <button
              type="button"
              onClick={() => start(deck.series)}
              className="rounded-lg bg-accent px-4 py-2 font-semibold text-card hover:bg-accent-hover transition-colors"
            >
              Retry, reshuffled
            </button>
            <button
              type="button"
              onClick={() => setSeriesSlug(null)}
              className="rounded-lg border border-border bg-card px-4 py-2 font-semibold text-ink-2 hover:border-ink-2 hover:text-ink transition-colors"
            >
              Try another deck
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
