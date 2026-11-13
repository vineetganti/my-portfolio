import { getSecondBrain } from "@/lib/secondBrain";

const SITE = "https://www.vineetganti.com";

const escape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * RSS 2.0 feed of the Good reads shelf, newest first. Built here from the data that passed the signature check and
 * validation (not copied from a file), so a feed reader only ever receives whitelisted, escaped text and https links.
 */
export async function GET() {
  const snapshot = await getSecondBrain();
  if (snapshot.state === "off") return new Response("Not found", { status: 404 });
  if (snapshot.state !== "ok" || !snapshot.goodReads) {
    return new Response("Temporarily unavailable", { status: 503, headers: { "Retry-After": "900" } });
  }

  const items = snapshot.goodReads.items
    .map(
      (i) => `    <item>
      <title>${escape(i.title)}</title>
      <link>${escape(i.url)}</link>
      <guid isPermaLink="false">${escape(i.id)}</guid>
      <pubDate>${new Date(i.published).toUTCString()}</pubDate>
${i.tags.map((t) => `      <category>${escape(t)}</category>\n`).join("")}      <description>${escape(`${i.summary}\n\nAI-written note on why it matters: ${i.why}\n\nSource: ${i.source}`)}</description>
    </item>`,
    )
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Vineet Ganti: Second brain (Good reads)</title>
    <link>${SITE}/second-brain</link>
    <description>Posts worth keeping, picked by me. Summaries are written by an AI model; follow each link for the original.</description>
${items}
  </channel>
</rss>
`;

  return new Response(xml, { headers: { "Content-Type": "application/rss+xml; charset=utf-8" } });
}
