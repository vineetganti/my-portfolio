# Vineet Ganti: portfolio and blog

My personal site: a blog where I write up what I'm learning (LLM internals, agents, systems engineering) and a page of the projects I've built. Next.js 16 (App Router), Tailwind CSS 4 and MDX, with every post living as a file in this repo.

## Stack

| Area | What's used |
| --- | --- |
| Framework | Next.js 16 (App Router, Turbopack), React 19, TypeScript |
| Styling | Tailwind CSS 4 with `@tailwindcss/typography`; a "vanilla and olive" theme with light and dark modes, tokens in `src/app/globals.css` |
| Posts | MDX read from `content/blog/` with `gray-matter`, rendered by `next-mdx-remote` (RSC) with `remark-gfm`, `rehype-slug` and `rehype-highlight` |
| Extras | Auto-generated table of contents, reading time, a `<Callout>` component, styled `<details>` for recall questions, copy buttons on code blocks |
| Diagrams | Hand-built SVGs, stored next to the post they belong to |
| Hosting | Vercel |

> **Next.js 16 note:** `AGENTS.md` warns that this version has breaking changes. Check `node_modules/next/dist/docs/` before relying on older Next.js habits.

## Run it

```bash
npm install
npm run dev      # http://localhost:3000
npm run build    # production build; also type-checks
npm run lint
```

## Layout

```text
content/
  blog/            one .mdx file per post (the filename is the URL)
  projects/        one .md file per project card
docs/
  mdx-formatting-guide.md   how to write and format a post
public/
  images/<section>/<series>/<post-slug>/   diagrams and screenshots, by post
src/
  app/             routes: /, /blog, /blog/[slug], /blog/topic/[section], /blog/series/[series], /projects, /about
  components/      Header, PostCard, SectionNav, SeriesStrip, SeriesNav, Callout, TableOfContents, ...
  lib/
    blog.ts        reads posts, builds the table of contents, series and section queries
    sections.ts    the list of sections and series (edit this to add one)
    projects.ts    reads project files
next.config.ts     redirects for renamed posts
```

## How the blog is organised

Three layers, each with one job:

| Layer | Answers | Set in | Examples |
| --- | --- | --- | --- |
| **Section** | Which shelf is this on? | `section:` in frontmatter, defined in `src/lib/sections.ts` | AI & LLMs, Systems & Engineering, Build Logs, Essays & Ideas |
| **Series** | What's the reading order? | `series:` and `seriesOrder:` in frontmatter | LLM Architectures (6 posts), Agentic AI (5), MIT Distributed Systems (1 so far) |
| **Tag** | What is it about, in detail? | `tags:` in frontmatter | Strands, MCP, Rust |

- `/blog` shows every section, every series and the latest posts. `/blog/topic/<section>` and `/blog/series/<series>` list one section or series.
- A series post shows "Part N of M" in its header and previous/next links at the end.
- **A new kind of writing** (career, books, anything non-technical) can go in *Essays & Ideas* with a tag. Add a new section only once three or more posts need it: it is one entry in `src/lib/sections.ts`, with no route or component changes. A missing or unknown `section` falls back to *Essays & Ideas*.

### Writing a post

1. Create `content/blog/<slug>.mdx` (lowercase and hyphens, no spaces).
2. Add frontmatter:

   ```yaml
   ---
   title: "Building my first AI agent"
   description: "One or two sentences."
   date: "2026-10-25"
   section: "ai-llms"
   series: "agentic-ai"      # optional
   seriesOrder: 1            # optional, with series
   tags: ["Agentic AI", "LLMs"]
   ---
   ```

3. Put images in `public/images/<section>/<series>/<post-slug>/` and reference them from the site root.
4. Run `npm run build`: it compiles every post and prerenders every page.

[`docs/mdx-formatting-guide.md`](docs/mdx-formatting-guide.md) covers the rest: headings, tables, callouts, code, math, diagrams and the MDX gotchas.

If you rename a published post, add its old slug to `RENAMED_POSTS` in `next.config.ts` so old links redirect.

## Build log

Everything done so far, newest first. Dates are from the git history.

| Date | What changed |
| --- | --- |
| 2026-10-29 | **Blog sections and series.** Added `section`, `series` and `seriesOrder` frontmatter, `src/lib/sections.ts`, section chips and series cards on `/blog`, `/blog/topic/[section]` and `/blog/series/[series]` pages, "Part N of M" and previous/next links on posts. Renamed the six LLM Architectures posts (dropped the `LLM Architectures - 0N -` title prefix, replaced `mentiforce0N` slugs) and the MapReduce post, with permanent redirects from the old URLs. Moved all post images into `public/images/<section>/<series>/<post>/`. Fixed the shell post title typo and the chat-app description placeholder. Rewrote this README. |
| 2026-10-29 | **Agentic AI posts 4 and 5.** *Agents that work together* (supervisor, agent as tool, graph, swarm) and *How agents talk* (MCP and A2A, with a Groq rate-limit error read line by line). Added a Summary with a summary-map, concepts table and recall questions to posts 1–3, and a series list to every agent post. |
| 2026-10-28 | **LLM Architectures posts 05 and 06.** *vLLM Framework and Inference Engine Design*, and *Batching LLM Requests*, the foundation for the queue-scheduler project. Revised posts 01–04 with summaries, new diagrams and the "About this series" note crediting Mentiforce. |
| 2026-10-27 | Reformatted LLM Architectures posts 01–03 with diagrams. Split the agent post into three and expanded them, added diagrams and organised the images. |
| 2026-10-26 | **Design pass.** Redesigned the blog UI, added a post table of contents, upgraded Next.js to 16.4.3. The theme went olive → burnt orange on olive → vanilla and olive. Images got a white backing so transparent diagrams stay readable in dark mode. Updated the agent-tools post. |
| 2026-10-25 | New posts: *Transformer Inference Optimization Strategies* and *Building my first AI agent*. |
| 2026-10-21 | New article on the ideal chat app, with images. New favicon. |
| 2026-10-19 | New post on Transformer architecture principles. |
| 2026-10-10 to 14 | Neural network fundamentals post: basic components, inference runs, then optimisers, gradients and VRAM. Updates to the other LLM posts, the shell post and the distributed systems post. |
| 2026-10-08 | **Start.** Created from Create Next App, then the "Pixl-inspired" portfolio site: home, blog, projects and about pages. First posts (a shell in Rust, MapReduce in Go), the first project cards, footer and About links. |

### Content today

16 posts: 11 in AI & LLMs (two series), 2 in Systems & Engineering, 1 in Build Logs and 2 in Essays & Ideas. 4 project cards.

## Open items

- `ideal-chat-app` and `why-i-write` are older, hand-written pieces and haven't had the recall-format treatment the series posts got.
- `building-my-first-llm-scheduler` (dated 2024) overlaps with the LLM Architectures post on the queue-scheduler project. Decide whether to merge or retire it.
- Tags are free-form and a bit inconsistent (AI, LLMs, AI Engineering). A small fixed vocabulary would make them useful as a filter.
- The `llm-scheduler` project card still has a placeholder GitHub URL.
- There is no sitemap, RSS feed or search yet.
