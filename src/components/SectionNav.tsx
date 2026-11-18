import Link from "next/link";
import { getAllPosts } from "@/lib/blog";
import { SECTIONS } from "@/lib/sections";

const chip =
  "inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-sm font-semibold transition-colors";

/** The row of section links shown above the post list. `active` is a section slug, or undefined for "All". */
export default function SectionNav({ active }: { active?: string }) {
  const posts = getAllPosts();

  const items = [
    { href: "/blog", label: "All", count: posts.length, key: undefined as string | undefined },
    ...SECTIONS.map((s) => ({
      href: `/blog/topic/${s.slug}`,
      label: s.title,
      count: posts.filter((p) => p.section === s.slug).length,
      key: s.slug as string | undefined,
    })),
  ].filter((item) => item.key === undefined || item.count > 0);

  return (
    <nav aria-label="Blog sections" className="flex flex-wrap gap-2">
      {items.map((item) => {
        const isActive = item.key === active;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive ? "page" : undefined}
            className={`${chip} ${
              isActive
                ? "border-accent bg-accent-tint text-ink-strong"
                : "border-border bg-card text-ink-2 hover:border-accent hover:text-ink"
            }`}
          >
            {item.label}
            <span className="text-xs font-bold text-ink-muted">{item.count}</span>
          </Link>
        );
      })}
    </nav>
  );
}
