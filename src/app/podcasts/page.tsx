import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getPodcasts, groupPodcasts } from "@/lib/podcasts";
import PodcastRow from "@/components/PodcastRow";

export const metadata = {
  title: "Podcasts",
  description: "AI-generated two-voice audio overviews of the posts.",
};

export default function PodcastsPage() {
  const podcasts = getPodcasts();
  const groups = groupPodcasts(podcasts);

  return (
    <div className="max-w-[52rem]">
      <Link
        href="/blog"
        className="mb-8 inline-flex items-center gap-1.5 text-sm font-semibold text-ink-muted transition-colors hover:text-accent"
      >
        <ArrowLeft size={15} />
        All posts
      </Link>

      <header className="mb-10">
        <p className="mb-2 font-bold text-ink-muted">
          {podcasts.length} {podcasts.length === 1 ? "episode" : "episodes"}
        </p>
        <h1 className="mb-3 font-heading text-5xl font-extrabold tracking-[-0.03em] text-ink sm:text-6xl">Podcasts</h1>
        <p className="text-lg leading-relaxed text-ink-2">
          Two AI voices talk through a post, made with NotebookLM. They are a way to hear the ideas while you walk or
          cook, not a replacement: the conversation paraphrases and skips parts, so the post stays the source of
          truth for code, numbers and diagrams. Every post can also be read aloud by your browser from its own page.
        </p>
      </header>

      {groups.length === 0 ? (
        <p className="text-ink-muted">No episodes yet.</p>
      ) : (
        <div className="space-y-10">
          {groups.map((group) => (
            <section key={group.key} aria-labelledby={`series-${group.key}`}>
              <h2 id={`series-${group.key}`} className="mb-4 text-sm font-bold uppercase tracking-wide text-ink-2">
                {group.title}
                <span className="ml-2 font-semibold normal-case tracking-normal text-ink-muted">
                  {group.episodes.length} {group.episodes.length === 1 ? "episode" : "episodes"}
                </span>
              </h2>
              <ul className="grid gap-3">
                {group.episodes.map((podcast) => (
                  <PodcastRow key={podcast.slug} podcast={podcast} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
