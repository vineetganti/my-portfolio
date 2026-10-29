import { getAllPosts } from "@/lib/blog";
import PostCard from "@/components/PostCard";
import SectionNav from "@/components/SectionNav";
import SeriesStrip from "@/components/SeriesStrip";

export const metadata = {
  title: "Blog",
  description: "Thoughts on technology, learning, and building things.",
};

export default function BlogPage() {
  const posts = getAllPosts();

  return (
    <div className="max-w-[52rem]">
      <header className="mb-8">
        <h1 className="font-heading font-extrabold text-5xl sm:text-6xl tracking-[-0.03em] text-ink mb-3">
          Blog
        </h1>
        <p className="text-lg text-ink-2">
          Thoughts on technology, learning, and building things.
        </p>
      </header>

      <div className="mb-10">
        <SectionNav />
      </div>

      <SeriesStrip />

      {posts.length === 0 ? (
        <p className="text-ink-muted">No posts yet. Check back soon!</p>
      ) : (
        <div className="grid gap-4">
          <h2 className="font-heading font-extrabold text-2xl tracking-tight text-ink">
            Latest posts
          </h2>
          {posts.map((post) => (
            <PostCard key={post.slug} post={post} />
          ))}
        </div>
      )}
    </div>
  );
}
