import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { getSeriesPosition, type BlogPost } from "@/lib/blog";
import { getSeriesInfo } from "@/lib/sections";

/** Previous and next links at the end of a post that belongs to a series. */
export default function SeriesNav({ post }: { post: BlogPost }) {
  const position = getSeriesPosition(post);
  if (!post.series || !position) return null;
  const { prev, next, position: n, total } = position;
  const info = getSeriesInfo(post.series);

  return (
    <nav aria-label={`${info.title} series`} className="mt-14 border-t border-border pt-8">
      <p className="text-sm font-semibold text-ink-muted mb-4">
        <Link href={`/blog/series/${info.slug}`} className="hover:text-accent transition-colors">
          {info.title}
        </Link>
        {total > 1 && ` · Part ${n} of ${total}`}
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        {prev ? (
          <Link
            href={`/blog/${prev.slug}`}
            className="group rounded-2xl border border-border bg-card p-5 transition-colors hover:border-accent"
          >
            <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-muted mb-1">
              <ArrowLeft size={14} /> Previous
            </span>
            <span className="block font-heading font-extrabold text-lg leading-snug text-ink group-hover:text-accent transition-colors">
              {prev.title}
            </span>
          </Link>
        ) : (
          <span />
        )}
        {next && (
          <Link
            href={`/blog/${next.slug}`}
            className="group rounded-2xl border border-border bg-card p-5 text-right transition-colors hover:border-accent sm:col-start-2"
          >
            <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-muted mb-1">
              Next <ArrowRight size={14} />
            </span>
            <span className="block font-heading font-extrabold text-lg leading-snug text-ink group-hover:text-accent transition-colors">
              {next.title}
            </span>
          </Link>
        )}
      </div>
    </nav>
  );
}
