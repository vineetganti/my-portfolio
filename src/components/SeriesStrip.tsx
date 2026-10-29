import Link from "next/link";
import { getPostsBySeries, getSeriesSlugs } from "@/lib/blog";
import { getSeriesInfo } from "@/lib/sections";

/** Cards for each reading list ("series"), shown on the blog index. */
export default function SeriesStrip({ section }: { section?: string }) {
  const series = getSeriesSlugs()
    .map((slug) => ({ info: getSeriesInfo(slug), posts: getPostsBySeries(slug) }))
    .filter((s) => !section || s.posts.some((p) => p.section === section));

  if (series.length === 0) return null;

  return (
    <section aria-labelledby="series-heading" className="mb-10">
      <h2
        id="series-heading"
        className="font-heading font-extrabold text-2xl tracking-tight text-ink mb-4"
      >
        Series
      </h2>
      <div className="grid gap-4 sm:grid-cols-2">
        {series.map(({ info, posts }) => (
          <Link
            key={info.slug}
            href={`/blog/series/${info.slug}`}
            className="block rounded-2xl border border-border bg-card p-5 transition-colors hover:border-accent"
          >
            <p className="text-sm font-semibold text-ink-muted mb-1">
              {posts.length} {posts.length === 1 ? "post" : "posts"}
            </p>
            <h3 className="font-heading font-extrabold text-xl tracking-tight text-ink mb-1">
              {info.title}
            </h3>
            {info.description && (
              <p className="text-[0.95rem] text-ink-2 leading-relaxed">{info.description}</p>
            )}
          </Link>
        ))}
      </div>
    </section>
  );
}
