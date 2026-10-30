import fs from "fs";
import path from "path";
import matter from "gray-matter";

export interface Note {
  /** File name without the extension, used as the anchor id. */
  id: string;
  /** ISO date, optionally with a time (`2026-10-30T12:00`), used for ordering. */
  date: string;
  /** Plain text. Blank lines separate paragraphs. */
  text: string;
}

const NOTES_DIR = path.join(process.cwd(), "content/notes");

/** All notes, newest first. A note is a `.md` file with a `date` in its frontmatter and plain text below. */
export function getAllNotes(): Note[] {
  if (!fs.existsSync(NOTES_DIR)) return [];

  return fs
    .readdirSync(NOTES_DIR)
    .filter((f) => f.endsWith(".md"))
    .map((filename) => {
      const { data, content } = matter(fs.readFileSync(path.join(NOTES_DIR, filename), "utf-8"));
      return {
        id: filename.replace(/\.md$/, ""),
        date: String(data.date ?? ""),
        text: content.trim(),
      };
    })
    .filter((n) => n.text && !Number.isNaN(new Date(n.date).getTime()))
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}
