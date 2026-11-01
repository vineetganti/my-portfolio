import { format } from "date-fns";
import type { Note } from "@/lib/notes";

/** A chronological, text-only feed of notes, newest first. */
export default function NoteList({ notes }: { notes: Note[] }) {
  return (
    <ol className="divide-y divide-border">
      {notes.map((note) => (
        <li key={note.id} id={note.id} className="py-5 first:pt-0 last:pb-0 scroll-mt-24">
          <a href={`#${note.id}`} className="text-sm font-bold text-ink-muted hover:text-accent transition-colors">
            <time dateTime={note.date}>{format(new Date(note.date), "MMMM d, yyyy")}</time>
          </a>
          <div className="mt-2 space-y-3 text-ink-2 leading-relaxed">
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
