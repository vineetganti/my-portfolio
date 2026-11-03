/**
 * The live charts the home page rotates through, one per day. The order is the rotation order:
 * the chart of the day is `HERO_CHARTS[day number % length]`, so consecutive days never repeat.
 * To add one, append an entry here and a matching view in components/home/HeroChart.tsx.
 */
export const HERO_CHARTS = [
  {
    id: "queueing-knee",
    title: "Why queues hit a wall",
    href: "/blog/batching-llm-requests",
    post: "Batching LLM requests",
  },
  {
    id: "dtype-memory",
    title: "Will the model fit on the GPU?",
    href: "/blog/neural-network-fundamentals",
    post: "Neural network fundamentals",
  },
  {
    id: "naive-fill",
    title: "Waiting for a batch to fill",
    href: "/blog/batching-llm-requests",
    post: "Batching LLM requests",
  },
  {
    id: "decode-latency",
    title: "Long contexts slow decoding",
    href: "/blog/transformer-inference-optimization",
    post: "Transformer inference optimization",
  },
  {
    id: "poisson",
    title: "Random traffic up close",
    href: "/blog/batching-llm-requests",
    post: "Batching LLM requests",
  },
] as const;

export type HeroChartId = (typeof HERO_CHARTS)[number]["id"];

const MS_PER_DAY = 86_400_000;

/** Whole days since 1970 for the viewer's local calendar date, so the chart changes at their midnight. */
export function localDayNumber(now = new Date()): number {
  return Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / MS_PER_DAY);
}

export function chartForDay(day: number) {
  return HERO_CHARTS[day % HERO_CHARTS.length];
}
