import { notFound } from "next/navigation";
import Link from "next/link";
import { format } from "date-fns";
import { getAllPosts, getPostBySlug } from "@/lib/blog";
import MdxContent from "@/components/MdxContent";
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

  return (
    <article>
      <Link
        href="/blog"
        className="inline-flex items-center gap-1.5 font-mono text-xs text-ink-muted hover:text-accent transition-colors uppercase tracking-wider mb-8"
      >
        <ArrowLeft size={14} />
        Back to blog
      </Link>

      <header className="mb-10 border-b border-border pb-8">
        <h1 className="font-heading text-4xl sm:text-5xl text-ink mb-4">
          {post.title}
        </h1>
        <div className="flex items-center gap-3 mb-4">
          <time className="font-mono text-xs text-ink-muted uppercase tracking-wide">
            {format(new Date(post.date), "MMMM dd, yyyy")}
          </time>
          <span className="font-mono text-xs text-ink-light">·</span>
          <span className="font-mono text-xs text-ink-muted">
            {post.readingTime}
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          {post.tags.map((tag) => (
            <span
              key={tag}
              className="font-mono text-xs px-2 py-0.5 bg-cream border border-border rounded text-ink-muted"
            >
              {tag}
            </span>
          ))}
        </div>
      </header>

      <MdxContent source={post.content} />
    </article>
  );
}
