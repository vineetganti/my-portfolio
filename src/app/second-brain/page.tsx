import fs from "fs";
import path from "path";
import { format } from "date-fns";
import { notFound } from "next/navigation";
import { getSecondBrain, type SecondBrainFeed, type SecondBrainItem } from "@/lib/secondBrain";
import { isSafeHttpsUrl } from "@/lib/secondBrainCore.mjs";

export const metadata = {
  title: "Second brain (beta)",
  description: "What I am reading: a shelf of good reads and a short daily list, picked by me and summarised by an AI.",
  // Beta: reachable by link, not yet offered to search engines. Remove when the beta ends.
  robots: { index: false, follow: true },
};

const REPORT_LINK = "mailto:vineetganti@gmail.com?subject=Second%20brain%20beta%3A%20";

interface HandPicked {
  title: string;
  url: string;
  source: string;
  topic?: string;
  note?: string;
}

/** Links I added by hand in content/reads.json. They live in git, so only I can change them. */
function getHandPicked(): HandPicked[] {
  try {
    const all = JSON.parse(fs.readFileSync(path.join(process.cwd(), "content", "reads.json"), "utf8")) as HandPicked[];
    return all.filter((r) => r && typeof r.title === "string" && isSafeHttpsUrl(r.url));
  } catch {
    return [];
  }
}

const LINK_CLASS = "font-bold text-ink hover:text-accent transition-colors";

function ItemCard({ item }: { item: SecondBrainItem }) {
  return (
    <li id={item.id} className="rounded-xl border border-border bg-card p-4 scroll-mt-24">
      <a href={item.url} target="_blank" rel="noopener noreferrer nofollow" className={LINK_CLASS}>
        {item.title} &nearr;
      </a>
      <p className="mt-1 text-sm text-ink-muted">
        {item.source} · <time dateTime={item.published}>{format(new Date(item.published), "MMM d, yyyy")}</time>
        {item.tags.length > 0 && ` · ${item.tags.join(", ")}`}
      </p>
      <p className="mt-2 text-ink-2 leading-relaxed">{item.summary}</p>
      {item.why && (
        <p className="mt-2 text-sm text-ink-muted leading-relaxed">
          <span className="font-semibold">Why it matters:</span> {item.why}
        </p>
      )}
      <p className="mt-2 text-xs text-ink-muted">{item.aiLabel}</p>
    </li>
  );
}

function Section({ id, title, intro, feed, empty }: { id: string; title: string; intro: string; feed: SecondBrainFeed | null; empty: string }) {
  return (
    <section id={id} className="mt-12 scroll-mt-24">
      <h2 className="font-heading font-extrabold text-2xl sm:text-3xl tracking-[-0.02em] text-ink">{title}</h2>
      <p className="mt-2 text-ink-2">{intro}</p>
      {feed && feed.items.length > 0 ? (
        <ul className="mt-5 grid gap-3 max-w-[48rem]">
          {feed.items.map((item) => (
            <ItemCard key={item.id} item={item} />
          ))}
        </ul>
      ) : (
        <p className="mt-5 text-ink-muted">{empty}</p>
      )}
    </section>
  );
}

export default async function SecondBrainPage() {
  const snapshot = await getSecondBrain();
  if (snapshot.state === "off") notFound();
  const handPicked = getHandPicked();

  return (
    <div className="max-w-content mx-auto">
      <header>
        <h1 className="font-heading font-extrabold text-4xl sm:text-5xl tracking-[-0.03em] text-ink">
          Second brain{" "}
          <span className="align-middle rounded-full bg-accent-tint px-2.5 py-1 text-xs font-extrabold uppercase tracking-wide text-ink-strong">
            Beta
          </span>
        </h1>
        <p className="mt-4 text-lg text-ink-2 leading-relaxed">
          What I am reading and learning from. <a href="#good-reads" className="underline underline-offset-4 hover:text-accent">Good reads</a> is
          the shelf of posts worth keeping; <a href="#daily" className="underline underline-offset-4 hover:text-accent">Daily</a> is a short list
          from the latest. I choose what goes in. The summaries and the &ldquo;why it matters&rdquo; lines are written by an AI model from the
          article text, so follow the link for the original.
        </p>
        <p className="mt-3 text-sm text-ink-muted">
          This is a beta: something may be wrong or missing.{" "}
          <a href={REPORT_LINK} className="underline underline-offset-4 hover:text-accent">
            Report a problem
          </a>
          {snapshot.state === "ok" && (
            <>
              {" · "}Updated <time dateTime={snapshot.updatedAt}>{format(new Date(snapshot.updatedAt), "MMM d, yyyy")}</time>
              {" · "}
              <a href="/second-brain/feed.xml" className="underline underline-offset-4 hover:text-accent">
                RSS
              </a>
            </>
          )}
        </p>
      </header>

      {snapshot.state === "not-configured" && (
        <p className="mt-10 rounded-xl border border-border bg-card p-4 text-ink-2">This page is not set up yet. Check back soon.</p>
      )}
      {snapshot.state === "paused" && (
        <p className="mt-10 rounded-xl border border-border bg-card p-4 text-ink-2">
          Paused for now.{snapshot.note ? ` ${snapshot.note}` : ""}
        </p>
      )}
      {snapshot.state === "unavailable" && (
        <p className="mt-10 rounded-xl border border-border bg-card p-4 text-ink-2">
          Temporarily unavailable. I only show lists that pass a signature check, and the latest one could not be checked. Try again soon.
        </p>
      )}

      {snapshot.state === "ok" && (
        <>
          {snapshot.staleDays > 0 && (
            <p className="mt-6 rounded-xl border border-border bg-card p-4 text-sm text-ink-2">
              These lists have not been refreshed for {snapshot.staleDays} days.
            </p>
          )}
          <Section
            id="good-reads"
            title="Good reads"
            intro="Posts I would send a colleague, newest first."
            feed={snapshot.goodReads}
            empty="Nothing here yet."
          />
          {handPicked.length > 0 && (
            <ul className="mt-5 grid gap-3 max-w-[48rem]" aria-label="Hand-picked reads">
              {handPicked.map((r) => (
                <li key={r.url} className="rounded-xl border border-border bg-card p-4">
                  <a href={r.url} target="_blank" rel="noopener noreferrer nofollow" className={LINK_CLASS}>
                    {r.title} &nearr;
                  </a>
                  <p className="mt-1 text-sm text-ink-muted">
                    {r.source}
                    {r.topic && ` · ${r.topic}`} · hand-picked
                  </p>
                  {r.note && <p className="mt-1 text-sm text-ink-2">{r.note}</p>}
                </li>
              ))}
            </ul>
          )}
          <Section
            id="daily"
            title="Daily"
            intro="A short list from recent days. Older entries drop off; the good ones move to the shelf above."
            feed={snapshot.daily}
            empty="Nothing in the daily list right now."
          />
        </>
      )}
    </div>
  );
}
