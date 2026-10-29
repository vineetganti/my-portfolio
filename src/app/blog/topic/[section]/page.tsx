import { notFound } from "next/navigation";
import { getPostsBySection } from "@/lib/blog";
import { SECTIONS, getSection } from "@/lib/sections";
import PostCard from "@/components/PostCard";
import SectionNav from "@/components/SectionNav";
import SeriesStrip from "@/components/SeriesStrip";

export function generateStaticParams() {
  return SECTIONS.map((s) => ({ section: s.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const { section: slug } = await params;
  const section = getSection(slug);
  if (!section) return { title: "Section Not Found" };
  return { title: section.title, description: section.description };
}

export default async function BlogSectionPage({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const { section: slug } = await params;
  const section = getSection(slug);
  if (!section) notFound();

  const posts = getPostsBySection(slug);

  return (
    <div className="max-w-[52rem]">
      <header className="mb-8">
        <h1 className="font-heading font-extrabold text-5xl sm:text-6xl tracking-[-0.03em] text-ink mb-3">
          {section.title}
        </h1>
        <p className="text-lg text-ink-2">{section.description}</p>
      </header>

      <div className="mb-10">
        <SectionNav active={slug} />
      </div>

      <SeriesStrip section={slug} />

      {posts.length === 0 ? (
        <p className="text-ink-muted">No posts in this section yet. Check back soon!</p>
      ) : (
        <div className="grid gap-4">
          {posts.map((post) => (
            <PostCard key={post.slug} post={post} />
          ))}
        </div>
      )}
    </div>
  );
}
