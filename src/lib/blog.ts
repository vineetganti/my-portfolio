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

export interface BlogPost {
  slug: string;
  title: string;
  description: string;
  date: string;
  tags: string[];
  readingTime: string;
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

export function getAllPosts(): BlogPost[] {
  if (!fs.existsSync(BLOG_DIR)) return [];

  const files = fs.readdirSync(BLOG_DIR).filter((f) => f.endsWith(".mdx"));

  const posts = files.map((filename) => {
    const slug = filename.replace(/\.mdx$/, "");
    const filePath = path.join(BLOG_DIR, filename);
    const fileContent = fs.readFileSync(filePath, "utf-8");
    const { data, content } = matter(fileContent);
    const stats = readingTime(content);

    return {
      slug,
      title: data.title || slug,
      description: data.description || "",
      date: data.date || new Date().toISOString(),
      tags: data.tags || [],
      readingTime: stats.text,
      toc: data.toc !== false,
      content,
    };
  });

  return posts.sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );
}

export function getPostBySlug(slug: string): BlogPost | undefined {
  const filePath = path.join(BLOG_DIR, `${slug}.mdx`);
  if (!fs.existsSync(filePath)) return undefined;

  const fileContent = fs.readFileSync(filePath, "utf-8");
  const { data, content } = matter(fileContent);
  const stats = readingTime(content);

  return {
    slug,
    title: data.title || slug,
    description: data.description || "",
    date: data.date || new Date().toISOString(),
    tags: data.tags || [],
    readingTime: stats.text,
    toc: data.toc !== false,
    content,
  };
}
