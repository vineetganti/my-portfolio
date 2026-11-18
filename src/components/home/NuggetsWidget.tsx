import Link from "next/link";
import NoteList from "@/components/NoteList";
import type { Note } from "@/lib/notes";

/**
 * The home page's Nuggets card. On wide screens it sits under the intro and is exactly as tall as the
 * space left beside the flash cards and chart: the outer box takes the free height (with a floor), and
 * the card is absolutely positioned inside it, so a long list scrolls instead of stretching the hero.
 * On narrow screens it is an ordinary card with a capped height.
 */
export default function NuggetsWidget({ notes }: { notes: Note[] }) {
  return (
    <section aria-labelledby="nuggets-heading" className="mt-10 lg:relative lg:flex-1 lg:min-h-[16rem]">
      <div className="flex max-h-[22rem] flex-col sm:max-h-[26rem] rounded-2xl border border-border bg-card lg:absolute lg:inset-0 lg:max-h-none">
        <div className="flex items-baseline justify-between gap-3 border-b border-border px-5 pt-4 pb-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Short notes, newest first</p>
            <h2 id="nuggets-heading" className="font-heading font-extrabold text-lg tracking-tight text-ink">
              Nuggets
            </h2>
          </div>
          <Link href="/notes" className="shrink-0 text-xs font-semibold text-ink-muted hover:text-accent transition-colors">
            All nuggets &rarr;
          </Link>
        </div>
        <div
          tabIndex={0}
          role="region"
          aria-label="Nuggets, scrollable"
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-b-2xl px-5 py-4"
        >
          <NoteList notes={notes} anchorBase="/notes" compact />
        </div>
      </div>
    </section>
  );
}
