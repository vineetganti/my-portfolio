import fs from "node:fs";
import path from "node:path";
import { getAllPosts, getHeadings, type BlogPost, type TocHeading } from "@/lib/blog";
import { getSeriesInfo } from "@/lib/sections";

export interface Podcast {
  slug: string;
  title: string;
  description: string;
  /** URL of the recording (object storage in production, public/audio in development). */
  src: string;
  /** Length in seconds, from content/audio-durations.json; undefined if it has not been measured. */
  seconds?: number;
  series?: string;
  seriesTitle?: string;
  seriesOrder?: number;
}

export interface PodcastGroup {
  key: string;
  title: string;
  episodes: Podcast[];
}

const DURATIONS = path.join(process.cwd(), "content/audio-durations.json");

function readDurations(): Record<string, number> {
  try {
    return JSON.parse(fs.readFileSync(DURATIONS, "utf-8"));
  } catch {
    return {};
  }
}

function toPodcast(post: BlogPost, durations: Record<string, number>): Podcast | null {
  if (!post.audioSrc) return null;
  const seconds = durations[post.slug];
  return {
    slug: post.slug,
    title: post.title,
    description: post.description,
    src: post.audioSrc,
    seconds: Number.isFinite(seconds) ? seconds : undefined,
    series: post.series,
    seriesTitle: post.series ? getSeriesInfo(post.series).title : undefined,
    seriesOrder: post.seriesOrder,
  };
}

/** Every post that has a recording, newest post first. */
export function getPodcasts(): Podcast[] {
  const durations = readDurations();
  return getAllPosts().flatMap((post) => {
    const podcast = toPodcast(post, durations);
    return podcast ? [podcast] : [];
  });
}

export function getPodcast(slug: string): Podcast | undefined {
  return getPodcasts().find((p) => p.slug === slug);
}

/** Length of one episode, as it is spoken: "41 min", or "1 h 3 min". */
export function formatLength(seconds?: number): string {
  if (seconds === undefined) return "";
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** Episodes grouped by series (in series order), with episodes that have no series last under "More". */
export function groupPodcasts(podcasts: Podcast[]): PodcastGroup[] {
  const bySeries = new Map<string, Podcast[]>();
  const more: Podcast[] = [];
  for (const p of podcasts) {
    if (!p.series) {
      more.push(p);
      continue;
    }
    bySeries.set(p.series, [...(bySeries.get(p.series) ?? []), p]);
  }
  const groups: PodcastGroup[] = [...bySeries.entries()].map(([key, episodes]) => ({
    key,
    title: episodes[0].seriesTitle ?? key,
    episodes: [...episodes].sort((a, b) => (a.seriesOrder ?? 0) - (b.seriesOrder ?? 0)),
  }));
  groups.sort((a, b) => a.title.localeCompare(b.title));
  if (more.length > 0) groups.push({ key: "more", title: "More", episodes: more });
  return groups;
}

/** The episode before and after this one in its series, when it has recordings there. */
export function getNeighbours(podcast: Podcast): { prev?: Podcast; next?: Podcast } {
  if (!podcast.series) return {};
  const inSeries = groupPodcasts(getPodcasts()).find((g) => g.key === podcast.series)?.episodes ?? [];
  const i = inSeries.findIndex((p) => p.slug === podcast.slug);
  if (i === -1) return {};
  return { prev: inSeries[i - 1], next: inSeries[i + 1] };
}

/** The headings of the post, shown as "In this episode". */
export function getEpisodeOutline(slug: string): TocHeading[] {
  const post = getAllPosts().find((p) => p.slug === slug);
  return post ? getHeadings(post.content).filter((h) => h.level === 0) : [];
}
