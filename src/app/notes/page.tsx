import Link from "next/link";
import { getAllNotes } from "@/lib/notes";
import NoteList from "@/components/NoteList";

export const metadata = {
  title: "Notes",
  description: "Short text notes, newest first.",
};

export default function NotesPage() {
  const notes = getAllNotes();

  return (
    <div className="max-w-content mx-auto">
      <h1 className="font-heading font-extrabold text-4xl sm:text-5xl tracking-[-0.03em] text-ink">Notes</h1>
      <p className="mt-4 text-lg text-ink-2 leading-relaxed">
        Short thoughts, in the order I had them. Longer pieces are on the{" "}
        <Link href="/blog" className="underline underline-offset-4 hover:text-accent transition-colors">
          blog
        </Link>
        . Subscribe with the{" "}
        <a href="/notes/feed.xml" className="underline underline-offset-4 hover:text-accent transition-colors">
          RSS feed
        </a>
        .
      </p>
      <div className="mt-10">
        {notes.length > 0 ? <NoteList notes={notes} /> : <p className="text-ink-muted">No notes yet.</p>}
      </div>
    </div>
  );
}
