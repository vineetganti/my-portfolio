import fs from "fs";
import path from "path";
import matter from "gray-matter";
import readingTime from "reading-time";
import GithubSlugger from "github-slugger";
import { unified } from "unified";
import remarkParse from "remark-parse";
import { toString } from "mdast-util-to-string";
import { visit } from "unist-util-visit";
import type { Heading as MdastHeading } from "mdast";
import { DEFAULT_SECTION, getSection } from "@/lib/sections";
import { WORDS_PER_MINUTE } from "@/lib/speech";

export interface BlogPost {
  slug: string;
  title: string;
  description: string;
  date: string;
  tags: string[];
  /** Slug of a section from `lib/sections.ts`; unknown values fall back to the default. */
  section: string;
  /** Slug of the series this post belongs to, if any. */
  series?: string;
  /** Position in the series, used for ordering. */
  seriesOrder?: number;
  readingTime: string;
  /** Minutes to listen to the prose read aloud (code, tables and diagrams are skipped). */
  listenMinutes: number;
  /** Set `toc: false` in frontmatter to hide the table of contents */
  toc: boolean;
  content: string;
}

export interface TocHeading {
  id: string;
  text: string;
  /** 0 for top-level entries, 1 for sub-entries */
  level: 0 | 1;
}

const BLOG_DIR = path.join(process.cwd(), "content/blog");

/**
 * Builds the table of contents for a post. Ids are generated with the same
 * slugger rehype-slug uses, walking every heading in order so duplicate
 * suffixes (-1, -2) line up with the anchors in the rendered page. The
 * shallowest heading level present (h2 or h3) becomes the top level.
 */
export function getHeadings(content: string): TocHeading[] {
  const tree = unified().use(remarkParse).parse(content);
  const slugger = new GithubSlugger();
  const all: { depth: number; id: string; text: string }[] = [];

  visit(tree, "heading", (node: MdastHeading) => {
    const text = toString(node).trim();
    all.push({ depth: node.depth, id: slugger.slug(text), text });
  });

  const candidates = all.filter((h) => h.depth >= 2 && h.depth <= 4 && h.text);
  if (candidates.length === 0) return [];

  const top = Math.min(...candidates.map((h) => h.depth));
  return candidates
    .filter((h) => h.depth <= top + 1)
    .map((h) => ({ id: h.id, text: h.text, level: h.depth === top ? 0 : 1 }));
}

/** Approximate listening time: the prose only, as the audio player reads it. */
function estimateListenMinutes(markdown: string): number {
  const prose = markdown
    .replace(/<details>[\s\S]*?<\/details>/g, " ")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^\s*\|.*$/gm, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/<[^>]+>/g, " ");
  const words = prose.split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / WORDS_PER_MINUTE));
}

function parsePost(slug: string, fileContent: string): BlogPost {
  const { data, content } = matter(fileContent);
  const stats = readingTime(content);
  const order = Number(data.seriesOrder);

  return {
    slug,
    title: data.title || slug,
    description: data.description || "",
    date: data.date || new Date().toISOString(),
    tags: data.tags || [],
    section: getSection(data.section) ? data.section : DEFAULT_SECTION,
    series: data.series || undefined,
    seriesOrder: Number.isFinite(order) ? order : undefined,
    readingTime: stats.text,
    listenMinutes: estimateListenMinutes(content),
    toc: data.toc !== false,
    content,
  };
}

export function getAllPosts(): BlogPost[] {
  if (!fs.existsSync(BLOG_DIR)) return [];

  const files = fs.readdirSync(BLOG_DIR).filter((f) => f.endsWith(".mdx"));

  const posts = files.map((filename) =>
    parsePost(
      filename.replace(/\.mdx$/, ""),
      fs.readFileSync(path.join(BLOG_DIR, filename), "utf-8")
    )
  );

  return posts.sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );
}

export function getPostBySlug(slug: string): BlogPost | undefined {
  const filePath = path.join(BLOG_DIR, `${slug}.mdx`);
  if (!fs.existsSync(filePath)) return undefined;
  return parsePost(slug, fs.readFileSync(filePath, "utf-8"));
}

/** Posts in one section, newest first. */
export function getPostsBySection(section: string): BlogPost[] {
  return getAllPosts().filter((p) => p.section === section);
}

/** Posts in one series, in reading order. */
export function getPostsBySeries(series: string): BlogPost[] {
  return getAllPosts()
    .filter((p) => p.series === series)
    .sort((a, b) => (a.seriesOrder ?? 0) - (b.seriesOrder ?? 0));
}

/** Slugs of every series that has at least one post. */
export function getSeriesSlugs(): string[] {
  return [...new Set(getAllPosts().flatMap((p) => (p.series ? [p.series] : [])))];
}

export interface SeriesPosition {
  /** 1-based position of the post within its series. */
  position: number;
  total: number;
  prev?: BlogPost;
  next?: BlogPost;
}

export function getSeriesPosition(post: BlogPost): SeriesPosition | null {
  if (!post.series) return null;
  const posts = getPostsBySeries(post.series);
  const i = posts.findIndex((p) => p.slug === post.slug);
  if (i === -1) return null;
  return { position: i + 1, total: posts.length, prev: posts[i - 1], next: posts[i + 1] };
}
