import Link from "next/link";
import { getAllPosts } from "@/lib/blog";
import { getAllProjects } from "@/lib/projects";
import { getAllNotes } from "@/lib/notes";
import NoteList from "@/components/NoteList";
import PostCard from "@/components/PostCard";
import ProjectCard from "@/components/ProjectCard";

export default function HomePage() {
  const posts = getAllPosts().slice(0, 3);
  const notes = getAllNotes();
  const featuredProjects = getAllProjects().filter((p) => p.featured);

  return (
    <div>
      {/* Hero */}
      <section className="pt-8 pb-14 sm:pt-14">
        <p className="font-bold text-ink-muted mb-5">Hello, I&apos;m</p>
        <h1 className="font-heading font-extrabold text-5xl sm:text-7xl lg:text-[5.5rem] tracking-[-0.035em] leading-[0.98] text-ink">
          Vineet Ganti
        </h1>
        <p className="mt-6 max-w-content text-lg sm:text-xl text-ink-2 leading-relaxed">
          I write about technology, ideas, and things I&apos;m learning. Welcome
          to my corner of the internet.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Link
            href="/blog"
            className="rounded-lg bg-accent px-5 py-2.5 font-semibold text-card hover:bg-accent-hover transition-colors"
          >
            Read the blog
          </Link>
          <Link
            href="/about"
            className="rounded-lg border border-border bg-card px-5 py-2.5 font-semibold text-ink-2 hover:border-ink-2 hover:text-ink transition-colors"
          >
            About me
          </Link>
        </div>
      </section>

      {/* Nuggets: an isolated, scrollable, text-only feed */}
      {notes.length > 0 && (
        <section className="py-14 border-t border-border">
          <div className="flex items-baseline justify-between gap-4 mb-8">
            <h2 className="font-heading font-extrabold text-3xl sm:text-4xl tracking-tight text-ink">
              Nuggets
            </h2>
            <Link
              href="/notes"
              className="text-sm font-semibold text-ink-muted hover:text-accent transition-colors"
            >
              All nuggets &rarr;
            </Link>
          </div>
          <div
            tabIndex={0}
            role="region"
            aria-label="Nuggets feed, scrollable"
            className="max-h-[26rem] overflow-y-auto overscroll-contain rounded-2xl border border-border bg-card p-5 sm:p-6"
          >
            <NoteList notes={notes} />
          </div>
        </section>
      )}

      {/* Featured Projects */}
      {featuredProjects.length > 0 && (
        <section className="py-14 border-t border-border">
          <div className="flex items-baseline justify-between gap-4 mb-8">
            <h2 className="font-heading font-extrabold text-3xl sm:text-4xl tracking-tight text-ink">
              Projects
            </h2>
            <Link
              href="/projects"
              className="text-sm font-semibold text-ink-muted hover:text-accent transition-colors"
            >
              View all &rarr;
            </Link>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {featuredProjects.map((project) => (
              <ProjectCard key={project.slug} project={project} />
            ))}
          </div>
        </section>
      )}

      {/* Recent Posts */}
      {posts.length > 0 && (
        <section className="py-14 border-t border-border">
          <div className="flex items-baseline justify-between gap-4 mb-8">
            <h2 className="font-heading font-extrabold text-3xl sm:text-4xl tracking-tight text-ink">
              Recent Writing
            </h2>
            <Link
              href="/blog"
              className="text-sm font-semibold text-ink-muted hover:text-accent transition-colors"
            >
              All posts &rarr;
            </Link>
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            {posts.map((post) => (
              <PostCard key={post.slug} post={post} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
