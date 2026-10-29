/**
 * The blog's shelves (sections) and reading lists (series).
 *
 * A post sets `section` (required in practice) and optionally `series` plus
 * `seriesOrder` in its frontmatter. To add a new area of writing, add one entry
 * here: no routes or components need to change. Add a section only once three or
 * more posts need it; until then a post can live in the catch-all "essays".
 */
export interface Section {
  slug: string;
  title: string;
  description: string;
}

export interface Series {
  slug: string;
  title: string;
  description: string;
}

export const SECTIONS: Section[] = [
  {
    slug: "ai-llms",
    title: "AI & LLMs",
    description:
      "How language models work, run and get used: architectures, inference engines and agents.",
  },
  {
    slug: "systems",
    title: "Systems & Engineering",
    description:
      "Learning core engineering by building things from first principles: shells, distributed systems and more.",
  },
  {
    slug: "build-logs",
    title: "Build Logs",
    description:
      "Projects written up as they are built: the plan, the decisions and what went wrong.",
  },
  {
    slug: "essays",
    title: "Essays & Ideas",
    description:
      "Opinions, design thinking and notes on learning and writing that don't fit a technical series.",
  },
];

/** Where a post lands when its `section` is missing or misspelled. */
export const DEFAULT_SECTION = "essays";

export const SERIES: Series[] = [
  {
    slug: "llm-architectures",
    title: "LLM Architectures",
    description:
      "Learning LLM internals from Python to vLLM, following Mentiforce's roadmap and ending in a queue-scheduler project.",
  },
  {
    slug: "agentic-ai",
    title: "Agentic AI",
    description:
      "Building agents with Strands and Groq: tools, memory, multi-agent patterns and the protocols agents talk through.",
  },
  {
    slug: "mit-distributed-systems",
    title: "MIT Distributed Systems",
    description:
      "Notes and working examples from MIT's distributed systems course.",
  },
];

export function getSection(slug: string): Section | undefined {
  return SECTIONS.find((s) => s.slug === slug);
}

export function getSeries(slug: string): Series | undefined {
  return SERIES.find((s) => s.slug === slug);
}

/** Series metadata, falling back to a title made from the slug if it isn't listed. */
export function getSeriesInfo(slug: string): Series {
  return (
    getSeries(slug) ?? {
      slug,
      title: slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      description: "",
    }
  );
}
