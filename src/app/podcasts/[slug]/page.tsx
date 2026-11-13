import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Download, FileText } from "lucide-react";
import { formatLength, getEpisodeOutline, getNeighbours, getPodcast, getPodcasts } from "@/lib/podcasts";
import { NowPlaying, PlayButton } from "@/components/PodcastProvider";

export function generateStaticParams() {
  return getPodcasts().map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const podcast = getPodcast(slug);
  if (!podcast) return { title: "Episode Not Found" };
  return { title: `${podcast.title} (podcast)`, description: podcast.description };
}

export default async function PodcastEpisodePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const podcast = getPodcast(slug);
  if (!podcast) notFound();

  const length = formatLength(podcast.seconds);
  const outline = getEpisodeOutline(slug);
  const { prev, next } = getNeighbours(podcast);
  const episode = { slug: podcast.slug, title: podcast.title, src: podcast.src };
  const downloadHref = /^https?:\/\//.test(podcast.src) ? `${podcast.src}?download=1` : podcast.src;

  return (
    <div className="max-w-[48rem]">
      <Link
        href="/podcasts"
        className="mb-8 inline-flex items-center gap-1.5 text-sm font-semibold text-ink-muted transition-colors hover:text-accent"
      >
        <ArrowLeft size={15} />
        All episodes
      </Link>

      <header className="mb-10 border-b border-border pb-8">
        <p className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-bold uppercase tracking-wide text-ink-2">
          {podcast.seriesTitle && (
            <span>
              {podcast.seriesTitle}
              {podcast.seriesOrder !== undefined && ` · Part ${podcast.seriesOrder}`}
            </span>
          )}
          {length && (
            <>
              {podcast.seriesTitle && <span className="text-ink-light">/</span>}
              <span>{length}</span>
            </>
          )}
          <NowPlaying slug={podcast.slug} />
        </p>
        <h1 className="font-heading text-4xl font-extrabold leading-[1.02] tracking-[-0.03em] text-ink sm:text-5xl">
          {podcast.title}
        </h1>
        {podcast.description && <p className="mt-5 text-lg leading-relaxed text-ink-2 sm:text-xl">{podcast.description}</p>}

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <PlayButton episode={episode} variant="large" length={length} />
          <Link
            href={`/blog/${podcast.slug}`}
            className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-5 py-3 font-bold text-ink-2 transition-colors hover:border-accent hover:text-ink"
          >
            <FileText size={18} />
            Read the post
          </Link>
          <a
            href={downloadHref}
            download
            className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-5 py-3 font-bold text-ink-2 transition-colors hover:border-accent hover:text-ink"
          >
            <Download size={18} />
            Download
          </a>
        </div>
      </header>

      {outline.length > 0 && (
        <section aria-labelledby="in-this-episode" className="mb-10">
          <h2 id="in-this-episode" className="mb-1 font-heading text-2xl font-extrabold tracking-tight text-ink">
            In this episode
          </h2>
          <p className="mb-4 text-ink-muted">The sections of the post it is based on. The hosts do not follow them in order.</p>
          <ol className="list-decimal space-y-1.5 pl-6 text-ink-2 marker:text-ink-muted">
            {outline.map((h) => (
              <li key={h.id}>
                <Link href={`/blog/${podcast.slug}#${h.id}`} className="underline-offset-4 transition-colors hover:text-accent hover:underline">
                  {h.text}
                </Link>
              </li>
            ))}
          </ol>
        </section>
      )}

      <p className="mb-10 rounded-2xl border border-border bg-card-2 px-5 py-4 text-ink-2">
        This is an AI-generated conversation. It paraphrases the post and skips parts of it, so it can be wrong in
        small ways. The post has the exact code, numbers and diagrams.
      </p>

      {(prev || next) && (
        <nav aria-label="Episodes in this series" className="grid gap-3 sm:grid-cols-2">
          {prev ? (
            <Link
              href={`/podcasts/${prev.slug}`}
              className="rounded-2xl border border-border bg-card p-4 transition-colors hover:border-accent"
            >
              <span className="mb-1 inline-flex items-center gap-1.5 text-sm font-semibold text-ink-muted">
                <ArrowLeft size={14} /> Previous
              </span>
              <span className="block font-bold text-ink">{prev.title}</span>
            </Link>
          ) : (
            <span />
          )}
          {next && (
            <Link
              href={`/podcasts/${next.slug}`}
              className="rounded-2xl border border-border bg-card p-4 text-right transition-colors hover:border-accent"
            >
              <span className="mb-1 inline-flex items-center gap-1.5 text-sm font-semibold text-ink-muted">
                Next <ArrowRight size={14} />
              </span>
              <span className="block font-bold text-ink">{next.title}</span>
            </Link>
          )}
        </nav>
      )}
    </div>
  );
}
