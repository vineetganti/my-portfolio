import { notFound } from "next/navigation";
import Link from "next/link";
import { format } from "date-fns";
import { getAllPosts, getHeadings, getPostBySlug, getSeriesPosition } from "@/lib/blog";
import { getSection, getSeriesInfo } from "@/lib/sections";
import AudioPlayer from "@/components/AudioPlayer";
import MdxContent from "@/components/MdxContent";
import RecordedAudio from "@/components/RecordedAudio";
import SeriesNav from "@/components/SeriesNav";
import TableOfContents from "@/components/TableOfContents";
import { ArrowLeft } from "lucide-react";

export function generateStaticParams() {
  return getAllPosts().map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const post = getPostBySlug(slug);
  if (!post) return { title: "Post Not Found" };
  return {
    title: post.title,
    description: post.description,
  };
}

export default async function BlogPostPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const post = getPostBySlug(slug);
  if (!post) notFound();

  const headings = post.toc ? getHeadings(post.content) : [];
  const hasToc = headings.length > 1;
  const section = getSection(post.section);
  const position = getSeriesPosition(post);

  return (
    <div
      id="top"
      className={
        hasToc
          ? "lg:grid lg:grid-cols-[17rem_minmax(0,1fr)] lg:gap-12 xl:gap-16"
          : "max-w-content mx-auto"
      }
    >
      {hasToc && <TableOfContents headings={headings} title={post.title} />}

      <article className="min-w-0 max-w-[48rem]">
        <Link
          href="/blog"
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-muted hover:text-accent transition-colors mb-8"
        >
          <ArrowLeft size={15} />
          All posts
        </Link>

        <header className="mb-10 border-b border-border pb-8">
          {(section || post.series) && (
            <p className="text-sm font-bold uppercase tracking-wide text-ink-2 mb-3">
              {section && (
                <Link href={`/blog/topic/${section.slug}`} className="hover:text-accent transition-colors">
                  {section.title}
                </Link>
              )}
              {section && post.series && <span className="mx-2 text-ink-light">/</span>}
              {post.series && (
                <Link href={`/blog/series/${post.series}`} className="hover:text-accent transition-colors">
                  {getSeriesInfo(post.series).title}
                  {position && position.total > 1 && ` · Part ${position.position} of ${position.total}`}
                </Link>
              )}
            </p>
          )}
          <p className="font-bold text-ink-muted mb-4">
            <time dateTime={post.date}>
              {format(new Date(post.date), "MMMM d, yyyy")}
            </time>
            <span className="mx-2 text-ink-light">·</span>
            {post.readingTime}
          </p>
          <h1 className="font-heading font-extrabold text-4xl sm:text-5xl lg:text-6xl tracking-[-0.03em] leading-[1.02] text-ink">
            {post.title}
          </h1>
          {post.description && (
            <p className="mt-5 text-lg sm:text-xl text-ink-2 leading-relaxed">
              {post.description}
            </p>
          )}
          {post.tags.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-6">
              {post.tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center rounded-full border border-border bg-card px-3.5 py-1 text-sm text-ink-2"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
          {post.audioSrc ? (
            <RecordedAudio src={post.audioSrc} title={post.title} />
          ) : (
            <AudioPlayer minutes={post.listenMinutes} />
          )}
        </header>

        <div id="post-content">
          <MdxContent source={post.content} />
        </div>

        <SeriesNav post={post} />
      </article>
    </div>
  );
}
