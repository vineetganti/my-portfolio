import Link from "next/link";
import { getAllPosts } from "@/lib/blog";
import { getAllProjects } from "@/lib/projects";
import PostCard from "@/components/PostCard";
import ProjectCard from "@/components/ProjectCard";

export default function HomePage() {
  const posts = getAllPosts().slice(0, 3);
  const featuredProjects = getAllProjects().filter((p) => p.featured);

  return (
    <div>
      {/* Hero */}
      <section className="py-12 border-b border-border">
        <p className="font-mono text-sm text-accent uppercase tracking-widest mb-4">
          Hello, I&apos;m
        </p>
        <h1 className="font-heading text-5xl sm:text-6xl text-ink mb-4">
          Vineet Ganti
        </h1>
        <p className="font-body text-lg text-ink-muted leading-relaxed max-w-lg mb-8">
          I write about technology, ideas, and things I&apos;m learning. Welcome
          to my corner of the internet.
        </p>
        <div className="flex items-center gap-4">
          <Link
            href="/blog"
            className="font-mono text-sm px-5 py-2.5 bg-accent text-cream rounded hover:bg-accent-hover transition-colors"
          >
            Read the blog
          </Link>
          <Link
            href="/about"
            className="font-mono text-sm px-5 py-2.5 border border-border text-ink-muted rounded hover:border-ink hover:text-ink transition-colors"
          >
            About me
          </Link>
        </div>
      </section>

      {/* Featured Projects */}
      {featuredProjects.length > 0 && (
        <section className="py-12 border-b border-border">
          <div className="flex items-center justify-between mb-8">
            <h2 className="font-heading text-3xl text-ink">Projects</h2>
            <Link
              href="/projects"
              className="font-mono text-xs text-ink-muted hover:text-accent transition-colors uppercase tracking-wider"
            >
              View all &rarr;
            </Link>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {featuredProjects.map((project) => (
              <ProjectCard key={project.slug} project={project} />
            ))}
          </div>
        </section>
      )}

      {/* Recent Posts */}
      {posts.length > 0 && (
        <section className="py-12">
          <div className="flex items-center justify-between mb-8">
            <h2 className="font-heading text-3xl text-ink">Recent Writing</h2>
            <Link
              href="/blog"
              className="font-mono text-xs text-ink-muted hover:text-accent transition-colors uppercase tracking-wider"
            >
              All posts &rarr;
            </Link>
          </div>
          <div>
            {posts.map((post) => (
              <PostCard key={post.slug} post={post} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
