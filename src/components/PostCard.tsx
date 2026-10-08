import Link from "next/link";
import { format } from "date-fns";
import type { BlogPost } from "@/lib/blog";

export default function PostCard({ post }: { post: BlogPost }) {
  return (
    <article className="group py-6 border-b border-border last:border-b-0">
      <Link href={`/blog/${post.slug}`} className="block">
        <div className="flex items-center gap-3 mb-2">
          <time className="font-mono text-xs text-ink-muted uppercase tracking-wide">
            {format(new Date(post.date), "MMM dd, yyyy")}
          </time>
          <span className="font-mono text-xs text-ink-light">·</span>
          <span className="font-mono text-xs text-ink-muted">
            {post.readingTime}
          </span>
        </div>

        <h2 className="font-heading text-2xl text-ink group-hover:text-accent transition-colors mb-2">
          {post.title}
        </h2>

        <p className="font-body text-ink-muted leading-relaxed mb-3">
          {post.description}
        </p>

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
      </Link>
    </article>
  );
}
