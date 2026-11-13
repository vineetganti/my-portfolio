"use client";

import { createContext, useContext, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Download, Pause, Play, RotateCcw, RotateCw, X } from "lucide-react";

const RATES = [1, 1.25, 1.5, 2, 0.75];

export interface Episode {
  slug: string;
  title: string;
  src: string;
}

interface PodcastContext {
  current: Episode | null;
  playing: boolean;
  /** Starts this episode, pauses it if it is the one playing, or resumes it if it is paused. */
  toggle: (episode: Episode) => void;
}

const Ctx = createContext<PodcastContext | null>(null);

function usePodcast(): PodcastContext {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("Podcast controls must be used inside <PodcastProvider>.");
  return ctx;
}

function clock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/**
 * Owns the one <audio> element for everything under /podcasts and the player bar fixed to the
 * bottom of the screen. It lives in the podcasts layout, so moving between the list and an
 * episode keeps playing. Leaving /podcasts unmounts it, which stops the audio.
 * The <audio> stays mounted and its src is set inside the click handler, so play() runs inside
 * the tap, which phones require.
 */
export default function PodcastProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [current, setCurrent] = useState<Episode | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [rate, setRate] = useState(1);
  const [notice, setNotice] = useState("");

  // Next keeps the previous route alive but hidden (Cache Components), and display: none does not stop
  // an <audio> element, so unmounting is not the only way out of /podcasts. Layout-effect cleanup runs
  // when the route is hidden too; pause then, because the bar is hidden with the route and the listener
  // would have no controls left. This is the pattern in "Preserving UI state" in the Next.js docs.
  useLayoutEffect(() => {
    const audio = audioRef.current;
    return () => audio?.pause();
  }, []);

  const play = () => {
    setNotice("");
    audioRef.current?.play().catch(() => {
      setPlaying(false);
      setNotice("The audio could not be played. Check the volume (and the silent switch on iPhone), then try again.");
    });
  };

  const toggle = (episode: Episode) => {
    const a = audioRef.current;
    if (!a) return;
    if (current?.slug === episode.slug) {
      if (a.paused) play();
      else a.pause();
      return;
    }
    setCurrent(episode);
    setTime(0);
    setDuration(0);
    a.src = episode.src;
    a.defaultPlaybackRate = rate; // load() resets the speed to the default
    a.playbackRate = rate;
    play();
  };

  const close = () => {
    audioRef.current?.pause();
    setCurrent(null);
    setTime(0);
    setDuration(0);
    setNotice("");
  };

  const skip = (by: number) => {
    const a = audioRef.current;
    if (a) a.currentTime = Math.max(0, Math.min(a.duration || Infinity, a.currentTime + by));
  };

  const cycleRate = () => {
    const next = RATES[(RATES.indexOf(rate) + 1) % RATES.length];
    setRate(next);
    if (audioRef.current) {
      audioRef.current.defaultPlaybackRate = next;
      audioRef.current.playbackRate = next;
    }
  };

  // Browsers ignore the download attribute on other origins; Vercel Blob forces a download with ?download=1.
  const downloadHref = current ? (/^https?:\/\//.test(current.src) ? `${current.src}?download=1` : current.src) : "";

  const btn =
    "inline-flex h-10 w-10 items-center justify-center rounded-full border border-border text-ink-2 transition-colors hover:border-accent hover:text-ink";

  return (
    <Ctx.Provider value={{ current, playing, toggle }}>
      {children}

      <audio
        ref={audioRef}
        preload="none"
        aria-label={current ? `Audio recording of ${current.title}` : "Podcast audio"}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onError={() => {
          // Clearing the element's src also fires an error event, so only report one for a real episode.
          if (!audioRef.current?.getAttribute("src")) return;
          setPlaying(false);
          setNotice("The recording could not be loaded.");
        }}
      />

      {current && (
        <div
          role="region"
          aria-label="Podcast player"
          className="fixed left-1/2 z-40 w-[min(44rem,calc(100%-2rem))] -translate-x-1/2 rounded-2xl border border-border bg-card p-3 shadow-lg"
          style={{ bottom: "max(1rem, env(safe-area-inset-bottom))" }}
        >
          <div className="flex items-center gap-2 sm:gap-3">
            <button type="button" className={btn} aria-label="Back 15 seconds" onClick={() => skip(-15)}>
              <RotateCcw size={16} />
            </button>
            <button
              type="button"
              className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-accent text-cream transition-colors hover:bg-accent-hover"
              aria-label={playing ? "Pause" : "Play"}
              onClick={() => (playing ? audioRef.current?.pause() : play())}
            >
              {playing ? <Pause size={20} /> : <Play size={20} />}
            </button>
            <button type="button" className={btn} aria-label="Forward 30 seconds" onClick={() => skip(30)}>
              <RotateCw size={16} />
            </button>

            <div className="min-w-0 flex-1 px-1">
              <p className="truncate text-sm font-bold text-ink">{current.title}</p>
              <p className="truncate text-xs text-ink-muted" aria-live="polite">
                {playing ? "Playing" : "Paused"} · {clock(time)} / {clock(duration)}
              </p>
            </div>

            <button
              type="button"
              className="h-10 rounded-full border border-border px-3 text-sm font-bold text-ink-2 transition-colors hover:border-accent hover:text-ink"
              aria-label={`Speed ${rate} times. Change speed`}
              onClick={cycleRate}
            >
              {rate}×
            </button>
            <a href={downloadHref} download className={`${btn} hidden sm:inline-flex`} aria-label="Download the recording">
              <Download size={16} />
            </a>
            <button type="button" className={btn} aria-label="Close the player" onClick={close}>
              <X size={16} />
            </button>
          </div>

          {notice && (
            <p role="status" className="mt-3 rounded-lg bg-accent-tint px-3 py-2 text-sm text-ink-strong">
              {notice}
            </p>
          )}

          <input
            type="range"
            min={0}
            max={duration || 0}
            step={1}
            value={Math.min(time, duration || 0)}
            onChange={(e) => {
              if (audioRef.current) audioRef.current.currentTime = Number(e.target.value);
            }}
            aria-label="Seek"
            className="mt-3 block h-1 w-full cursor-pointer accent-[var(--tool)]"
          />
        </div>
      )}
    </Ctx.Provider>
  );
}

/** The Play / Pause control for one episode. `icon` is the round button in the list, `large` the one on an episode page. */
export function PlayButton({
  episode,
  variant,
  length,
}: {
  episode: Episode;
  variant: "icon" | "large";
  /** Spoken length such as "41 min", shown in the large button. */
  length?: string;
}) {
  const { current, playing, toggle } = usePodcast();
  const isCurrent = current?.slug === episode.slug;
  const isPlaying = isCurrent && playing;
  const Icon = isPlaying ? Pause : Play;

  if (variant === "icon") {
    return (
      <button
        type="button"
        onClick={() => toggle(episode)}
        aria-label={`${isPlaying ? "Pause" : "Play"} ${episode.title}`}
        className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-accent text-cream transition-colors hover:bg-accent-hover"
      >
        <Icon size={20} />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => toggle(episode)}
      className="inline-flex items-center gap-3 rounded-full bg-accent px-6 py-3 font-bold text-cream transition-colors hover:bg-accent-hover"
    >
      <Icon size={20} />
      {isPlaying ? "Pause" : isCurrent ? "Resume" : "Play episode"}
      {length && !isCurrent && <span className="font-semibold opacity-80">· {length}</span>}
    </button>
  );
}

/** A small "Now playing" tag that shows only on the episode that is loaded in the player. */
export function NowPlaying({ slug }: { slug: string }) {
  const { current, playing } = usePodcast();
  if (current?.slug !== slug) return null;
  return (
    <span className="inline-flex items-center rounded-full bg-accent-tint px-2.5 py-0.5 text-xs font-extrabold uppercase tracking-wide text-ink-strong">
      {playing ? "Now playing" : "Paused"}
    </span>
  );
}
