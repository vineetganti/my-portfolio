import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getPostsBySeries, getSeriesSlugs } from "@/lib/blog";
import { getSeriesInfo } from "@/lib/sections";
import PostCard from "@/components/PostCard";

export function generateStaticParams() {
  return getSeriesSlugs().map((series) => ({ series }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ series: string }>;
}) {
  const { series: slug } = await params;
  if (getPostsBySeries(slug).length === 0) return { title: "Series Not Found" };
  const info = getSeriesInfo(slug);
  return { title: `${info.title} (series)`, description: info.description };
}

export default async function BlogSeriesPage({
  params,
}: {
  params: Promise<{ series: string }>;
}) {
  const { series: slug } = await params;
  const posts = getPostsBySeries(slug);
  if (posts.length === 0) notFound();

  const info = getSeriesInfo(slug);

  return (
    <div className="max-w-[52rem]">
      <Link
        href="/blog"
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-muted hover:text-accent transition-colors mb-8"
      >
        <ArrowLeft size={15} />
        All posts
      </Link>

      <header className="mb-10">
        <p className="font-bold text-ink-muted mb-2">
          Series · {posts.length} {posts.length === 1 ? "post" : "posts"}, in reading order
        </p>
        <h1 className="font-heading font-extrabold text-5xl sm:text-6xl tracking-[-0.03em] text-ink mb-3">
          {info.title}
        </h1>
        {info.description && <p className="text-lg text-ink-2">{info.description}</p>}
      </header>

      <div className="grid gap-4">
        {posts.map((post) => (
          <PostCard key={post.slug} post={post} />
        ))}
      </div>
    </div>
  );
}
