import { format } from "date-fns";
import type { Note } from "@/lib/notes";

/**
 * A chronological, text-only feed of notes, newest first. On /notes each date links to its own anchor;
 * the home page widget passes `anchorBase="/notes"` (and `compact`) so a date opens the note on its page.
 */
export default function NoteList({ notes, anchorBase = "", compact = false }: { notes: Note[]; anchorBase?: string; compact?: boolean }) {
  return (
    <ol className="divide-y divide-border">
      {notes.map((note) => (
        <li
          key={note.id}
          id={anchorBase ? undefined : note.id}
          className={`${compact ? "py-4" : "py-5"} first:pt-0 last:pb-0 scroll-mt-24`}
        >
          <a href={`${anchorBase}#${note.id}`} className="text-sm font-bold text-ink-muted hover:text-accent transition-colors">
            <time dateTime={note.date}>{format(new Date(note.date), "MMMM d, yyyy")}</time>
          </a>
          <div className={`mt-2 ${compact ? "space-y-2 text-[0.95rem]" : "space-y-3"} text-ink-2 leading-relaxed`}>
            {note.text.split(/\n\s*\n/).map((paragraph, i) => (
              <p key={i} className="whitespace-pre-line">
                {paragraph}
              </p>
            ))}
          </div>
        </li>
      ))}
    </ol>
  );
}
