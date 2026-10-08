import { getAllPosts } from "@/lib/blog";
import PostCard from "@/components/PostCard";

export const metadata = {
  title: "Blog",
  description: "Thoughts on technology, learning, and building things.",
};

export default function BlogPage() {
  const posts = getAllPosts();

  return (
    <div>
      <header className="mb-10">
        <h1 className="font-heading text-4xl text-ink mb-2">Blog</h1>
        <p className="font-body text-ink-muted">
          Thoughts on technology, learning, and building things.
        </p>
      </header>

      {posts.length === 0 ? (
        <p className="font-mono text-sm text-ink-muted">
          No posts yet. Check back soon!
        </p>
      ) : (
        <div>
          {posts.map((post) => (
            <PostCard key={post.slug} post={post} />
          ))}
        </div>
      )}
    </div>
  );
}
