import Link from "next/link";
import { formatLength, type Podcast } from "@/lib/podcasts";
import { NowPlaying, PlayButton } from "@/components/PodcastProvider";

/** One episode in the list on /podcasts. */
export default function PodcastRow({ podcast }: { podcast: Podcast }) {
  const length = formatLength(podcast.seconds);
  const episode = { slug: podcast.slug, title: podcast.title, src: podcast.src };

  return (
    <li className="flex items-center gap-4 rounded-2xl border border-border bg-card p-4 sm:p-5">
      <PlayButton episode={episode} variant="icon" />

      <div className="min-w-0 flex-1">
        <p className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold text-ink-muted">
          {podcast.seriesOrder !== undefined && <span>Part {podcast.seriesOrder}</span>}
          {podcast.seriesOrder !== undefined && length && <span className="text-ink-light">·</span>}
          {length && <span>{length}</span>}
          <NowPlaying slug={podcast.slug} />
        </p>
        <h3 className="font-heading text-lg font-extrabold leading-snug tracking-tight text-ink sm:text-xl">
          <Link href={`/podcasts/${podcast.slug}`} className="transition-colors hover:text-accent">
            {podcast.title}
          </Link>
        </h3>
        <Link
          href={`/blog/${podcast.slug}`}
          className="mt-1 inline-block text-sm font-semibold text-ink-2 underline underline-offset-4 transition-colors hover:text-accent"
        >
          Read the post
        </Link>
      </div>
    </li>
  );
}
