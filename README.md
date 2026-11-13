# Vineet Ganti: portfolio and blog

My personal site: a blog where I write up what I'm learning (LLM internals, agents, systems engineering) and a page of the projects I've built. Next.js 16 (App Router), Tailwind CSS 4 and MDX, with every post living as a file in this repo.

## Stack

| Area | What's used |
| --- | --- |
| Framework | Next.js 16 (App Router, Turbopack), React 19, TypeScript |
| Styling | Tailwind CSS 4 with `@tailwindcss/typography`; a "vanilla and olive" theme with light and dark modes, tokens in `src/app/globals.css` |
| Posts | MDX read from `content/blog/` with `gray-matter`, rendered by `next-mdx-remote` (RSC) with `remark-gfm`, `rehype-slug` and `rehype-highlight` |
| Extras | Auto-generated table of contents, reading time, an audio player that reads posts aloud, a `<Callout>` component, styled `<details>` for recall questions, copy buttons on code blocks |
| Diagrams | Hand-built SVGs, stored next to the post they belong to |
| Live SQL | PGlite (PostgreSQL in WebAssembly) in the Database Engineering posts, loaded from `public/pglite/` when a reader presses Run |
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
  flashcards/      one .json file per home page deck
  db-lab/          recorded database runs for the Database Engineering posts
docs/
  mdx-formatting-guide.md   how to write and format a post
public/
  images/<section>/<series>/<post-slug>/   diagrams and screenshots, by post
src/
  app/             routes: /, /blog, /blog/[slug], /blog/topic/[section], /blog/series/[series], /podcasts, /podcasts/[slug], /projects, /about
  components/      Header, PostCard, SectionNav, SeriesStrip, SeriesNav, AudioPlayer, PodcastProvider, PodcastRow, Callout, TableOfContents, ...
  lib/
    blog.ts        reads posts, builds the table of contents, series and section queries
    sections.ts    the list of sections and series (edit this to add one)
    speech.ts      turns the rendered post into chunks for the audio player
    podcasts.ts    lists the posts that have a recording, with their lengths, grouped by series
    projects.ts    reads project files
    secondBrain.ts       fetches and verifies the Second brain snapshot (server only)
    secondBrainCore.mjs  signature check and validation, shared by the site, the upload script and the tests
next.config.ts     redirects for renamed posts, and /reads to /second-brain
second-brain/      the Python pipeline behind the Second brain page (its own README); PRIVATE DATA LIVES IN second-brain/data/, IGNORED
scripts/
  check-public-safety.mjs     fails if a database, token, key or personal path is tracked (CI runs it on every push)
  upload-second-brain.mjs     verifies, then uploads the signed snapshot to Vercel Blob
  second-brain.test.mjs       tests, with a fixture signed by the Python code (npm run test:second-brain)
```

## Second brain (beta)

`/second-brain` shows a shelf of good reads and a short daily list. The owner picks what is on it; an AI writes the summaries. The Python pipeline in `second-brain/` signs a small snapshot with a private key that stays on the owner's machine; the page verifies it before showing anything and has no write path. Details, the file contract, the beta exit criteria and the rollback steps are in [second-brain/docs/second-brain-contract.md](second-brain/docs/second-brain-contract.md).

| Environment variable | Purpose |
| --- | --- |
| `SECOND_BRAIN_BASE_URL` | where the signed files are hosted (printed by the upload script) |
| `SECOND_BRAIN_PUBLIC_KEY` | the Ed25519 public key, base64 (public by design) |
| `SECOND_BRAIN_ENABLED` | `false` hides the page and the nav link (needs a redeploy; `nb publish --pause` is the fast switch) |

> This repository is public. `second-brain/data/`, `.env*`, tokens and keys are gitignored, and `npm run check:safety` fails if any private file is tracked.

## How the blog is organised

Three layers, each with one job:

| Layer | Answers | Set in | Examples |
| --- | --- | --- | --- |
| **Section** | Which shelf is this on? | `section:` in frontmatter, defined in `src/lib/sections.ts` | AI & LLMs, Systems & Engineering, Data Engineering, Build Logs, Essays & Ideas |
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

### Listening to a post

Every post has a **Listen to this post** button under its title. It uses the browser's built-in text-to-speech (the Web Speech API), so it costs nothing and needs no audio files, and new posts get it automatically.

- It reads prose and headings, reads each diagram from its alt text (so write alt text as a real description of the picture), highlights the paragraph being read, and says "Code example skipped", "Table skipped" and so on in place of code, tables and the collapsed recall questions. Put anything essential in the prose or the alt text, not only in code or tables. Diagram reading can be switched off in the player's settings.
- Controls: play/pause, previous/next paragraph, speed (0.75× to 2×), a voice picker, a diagram toggle and a time-left estimate. Speed, voice and the diagram setting are remembered in the browser.
- **Phones:** playback avoids the known mobile pitfalls (no cancel and speak in the same instant, the current utterance is kept alive, the engine is resumed before speaking) and has a watchdog that moves on if an end event never arrives, or explains if speech never starts. It has been tested in an emulated phone with a stubbed speech engine, not on a physical iPhone or Android phone. The iPhone silent switch can still mute speech.
- Voice quality depends on the browser and device: Edge and Chrome offer "Natural" or "Online" voices that sound far better than the defaults. Browsers without speech support simply don't show the button.
- A post can't be downloaded as audio with this approach. If that's wanted later, generate an MP3 per post and let the player prefer it when present.

### Recorded audio (podcasts)

Some posts have an AI podcast version (an m4a made with NotebookLM). It does not replace the browser voice: every post keeps **Listen to this post**, and a post with a recording also links to its episode. Episodes are on their own pages, `/podcasts` (the list, grouped by series, linked from a Podcasts chip on `/blog`) and `/podcasts/<slug>`, which share one player (`PodcastProvider`) that pauses when you leave. The files are large, so they are not in git: they live in Vercel Blob, and `content/audio.json` lists which posts have one, with `content/audio-durations.json` holding each length (measured with `ffprobe`). `AUDIO_BASE_URL` (set in Vercel and `.env.local`) is the storage address; without it the site falls back to `public/audio/`. Upload with `node --env-file=.env.local scripts/upload-audio.mjs`, which also refreshes the lengths. See the writing guide for the steps.

### Data Engineering SQL posts

The six `de-sql-*` posts are generated: their questions, sample data and answers live in `scripts/sql-bank/posts/*.py`, and `python scripts/sql-bank/build.py` (needs `pip install duckdb`) runs every answer on its sample data in DuckDB and writes the MDX plus `content/sql-traces/<slug>.json`, which the `<DataTrace>` step-throughs read. Edit the spec and rebuild rather than editing the generated MDX.

### Database Engineering posts

The 14 `db-*` posts are written by hand, but what they show is recorded. `scripts/db-lab/` starts PostgreSQL, MySQL, MongoDB, Redis and Memcached in Docker, runs each demo on real concurrent connections and writes `content/db-lab/*.json`, which the components in `src/components/db/` read. It also draws the diagrams. Every post has live boxes running real PostgreSQL in the reader's browser, through PGlite. Re-recording can change a number the prose quotes, so re-check the text afterwards. The writing guide lists the components and commands.

### Building this site posts

The nine-part *Building this site* series (`site-*` and `second-brain-pipeline`) explains the site one feature at a time and replaced the single `how-this-site-is-built` post, which now redirects to `/blog/series/building-this-site`. Its diagrams are drawn by `node scripts/build-log/draw.mjs` (specs in `scripts/build-log/diagrams/`, same canvas and palette as the database diagrams), and `node scripts/build-log/series-callouts.mjs` rewrites the series list in every part. The site's dated update log now lives at the end of part 1, `content/blog/site-architecture.mdx`.

### Flash cards

The home page decks are in `content/flashcards/`, 50 cards each, and `DECKS` in `src/lib/flashcards.ts` lists them. Decks that share a `group` fold into one entry on the chooser, which is how the four Database Engineering decks appear. The build fails on a malformed card.

## Build log

Everything done so far, newest first. Dates are from the git history.

| Date | What changed |
| --- | --- |
| 2026-11-13 | **Podcasts on their own pages.** The AI podcasts moved to `/podcasts` and `/podcasts/<slug>` with one shared player, so every post keeps the browser voice (they had replaced it on the 14 posts with a recording) and links to its episode. A new Podcasts chip on `/blog` leads to the list. Episode lengths are measured with `ffprobe` into `content/audio-durations.json`. Testing leaving a page found that Next keeps the old page hidden, so audio kept playing with its controls hidden; the podcast player now pauses when hidden, and the browser voice resets its state. |
| 2026-11-13 | **Building this site series.** The single build-log post became nine parts, one per feature: architecture, sections and series, audio, nuggets and feeds, diagrams, generated content, live Postgres, the Second brain page, and the Second brain pipeline built with Claude Code. Checks and measurements were re-run for it, which found the PGlite download fix still holding at 5.74 MB, the SQL bank reproducing exactly, and three issues listed under Open items. The project card now links to the series. |
| 2026-11-05 | **Database Engineering series.** Fourteen posts following Hussein Nasser's *Fundamentals of Database Engineering*, with its Q&A folded in and corrections to the course where a real run or the docs disagreed. Demos were re-run on real PostgreSQL, MySQL, MongoDB, Redis and Memcached in Docker by `scripts/db-lab/` and shown through `src/components/db/`: multi-session step-throughs, measured charts, simulators, and live PostgreSQL in the browser with PGlite. Four new 50-card decks fold into one entry on the home page chooser. |
| 2026-11-03 | **Data Engineering SQL series.** A new *Data Engineering* section and a six-post practice bank (92 questions) generated by `scripts/sql-bank/build.py`, which runs every answer on its sample data in DuckDB. Answers sit in dropdowns with an interactive `<DataTrace>` step-through (`src/components/sql/`) built from the real query results, plus pattern diagrams. |
| 2026-10-29 | **Build-log post.** *Building this site* explains the sections, series and audio-player changes with code, then tours the whole codebase. It is the link on the Portfolio Website project card. |
| 2026-10-29 | **Audio player: phones and diagrams.** Fixed playback on mobile Safari and Chrome (four causes, plus a watchdog and visible error messages) and made the player read each diagram from its alt text, with a setting to turn that off. |
| 2026-10-29 | **Audio player.** A *Listen to this post* button on every post that reads it aloud with the browser's text-to-speech: prose only, with skip notes for code, tables and diagrams, paragraph highlighting, previous/next, speed, voice choice and time left. |
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

48 posts: 14 in AI & LLMs (two series), 20 in Data Engineering (two series), 10 in Build Logs (one series), 2 in Systems & Engineering and 2 in Essays & Ideas. 6 project cards.

## Open items

- `ideal-chat-app` and `why-i-write` are older, hand-written pieces and haven't had the recall-format treatment the series posts got.
- `building-my-first-llm-scheduler` (dated 2024) overlaps with the LLM Architectures post on the queue-scheduler project. Decide whether to merge or retire it.
- Tags are free-form and a bit inconsistent (AI, LLMs, AI Engineering). A small fixed vocabulary would make them useful as a filter.
- The `llm-scheduler` project card still has a placeholder GitHub URL.
- There is no sitemap, search or RSS feed for blog posts yet (the nuggets and the Second brain have feeds).
- The header doesn't fit a phone: at 390 px wide it is 483 px, so About and the theme toggle are off-screen and every page scrolls sideways.
- The browser voice can send a sentence longer than its 180-character target (327 measured), because the limit only applies when joining sentences.
- Nugget dates have a time but no time zone, so the RSS `pubDate` depends on the build machine's time zone.
- The podcast recordings use 390.6 MB of Vercel Blob's 1 GB Hobby allowance.
- The player's phone fixes are untested on a physical device. Try it on a real iPhone and Android phone and report what happens.
