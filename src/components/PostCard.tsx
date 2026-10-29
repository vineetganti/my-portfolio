import Link from "next/link";
import { format } from "date-fns";
import type { BlogPost } from "@/lib/blog";
import { getSection, getSeriesInfo } from "@/lib/sections";

export default function PostCard({ post }: { post: BlogPost }) {
  const section = getSection(post.section);

  return (
    <article className="group">
      <Link
        href={`/blog/${post.slug}`}
        className="block h-full rounded-2xl border border-border bg-card p-6 transition-colors hover:border-accent"
      >
        <p className="text-sm font-semibold text-ink-muted mb-2">
          <time dateTime={post.date}>{format(new Date(post.date), "MMM d, yyyy")}</time>
          <span className="mx-2 text-ink-light">·</span>
          {post.readingTime}
          {section && (
            <>
              <span className="mx-2 text-ink-light">·</span>
              {section.title}
            </>
          )}
        </p>

        {post.series && (
          <p className="text-sm font-bold text-ink-2 mb-1">
            {getSeriesInfo(post.series).title}
            {post.seriesOrder !== undefined && ` · Part ${post.seriesOrder}`}
          </p>
        )}

        <h2 className="font-heading font-extrabold text-2xl tracking-tight leading-tight text-ink group-hover:text-accent transition-colors mb-2">
          {post.title}
        </h2>

        {post.description && (
          <p className="text-ink-2 leading-relaxed mb-4">{post.description}</p>
        )}

        {post.tags.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {post.tags.map((tag) => (
              <span
                key={tag}
                className="rounded-full border border-border bg-card-2 px-3 py-0.5 text-[0.8rem] text-ink-muted"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </Link>
    </article>
  );
}
