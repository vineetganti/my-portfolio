import { getAllNotes } from "@/lib/notes";

const SITE = "https://www.vineetganti.com";

const escape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** RSS 2.0 feed of the notes, newest first. */
export function GET() {
  const items = getAllNotes()
    .map((n) => {
      const firstLine = n.text.split("\n")[0];
      const title = firstLine.length > 80 ? `${firstLine.slice(0, 77)}...` : firstLine;
      return `    <item>
      <title>${escape(title)}</title>
      <link>${SITE}/notes#${n.id}</link>
      <guid isPermaLink="false">${n.id}</guid>
      <pubDate>${new Date(n.date).toUTCString()}</pubDate>
      <description>${escape(n.text)}</description>
    </item>`;
    })
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Vineet Ganti: Notes</title>
    <link>${SITE}/notes</link>
    <description>Short text notes, newest first.</description>
${items}
  </channel>
</rss>
`;

  return new Response(xml, { headers: { "Content-Type": "application/rss+xml; charset=utf-8" } });
}
