import PodcastProvider from "@/components/PodcastProvider";

/** One player for the whole /podcasts area: it stays mounted while you move between the list and an episode. */
export default function PodcastsLayout({ children }: { children: React.ReactNode }) {
  return <PodcastProvider>{children}</PodcastProvider>;
}
