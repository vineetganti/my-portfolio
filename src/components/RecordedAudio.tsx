"use client";

import { useRef, useState } from "react";
import { Download, Pause, Play, Podcast, RotateCcw, RotateCw, X } from "lucide-react";

const RATES = [1, 1.25, 1.5, 2, 0.75];

function clock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const s = Math.floor(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * A recorded (podcast-style) narration of the post. Same look as the text-to-speech
 * player: a button in the post header opens a player bar fixed to the bottom of the screen.
 * The <audio> element stays mounted so play() runs inside the tap, which phones require.
 */
export default function RecordedAudio({ src, title }: { src: string; title: string }) {
  // Browsers ignore the download attribute on other origins; Vercel Blob forces a download with ?download=1.
  const downloadHref = /^https?:\/\//.test(src) ? `${src}?download=1` : src;
  const audioRef = useRef<HTMLAudioElement>(null);
  const [open, setOpen] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [rate, setRate] = useState(1);
  const [notice, setNotice] = useState("");

  const play = () => {
    setNotice("");
    audioRef.current?.play().catch(() => {
      setPlaying(false);
      setNotice("The audio could not be played. Check the volume (and the silent switch on iPhone), then try again.");
    });
  };

  const openPlayer = () => {
    setOpen(true);
    play();
  };

  const closePlayer = () => {
    audioRef.current?.pause();
    setOpen(false);
  };

  const skip = (by: number) => {
    const a = audioRef.current;
    if (a) a.currentTime = Math.max(0, Math.min(a.duration || Infinity, a.currentTime + by));
  };

  const cycleRate = () => {
    const next = RATES[(RATES.indexOf(rate) + 1) % RATES.length];
    setRate(next);
    if (audioRef.current) audioRef.current.playbackRate = next;
  };

  const btn =
    "inline-flex h-10 w-10 items-center justify-center rounded-full border border-border text-ink-2 transition-colors hover:border-accent hover:text-ink";

  return (
    <>
      <button
        type="button"
        onClick={open ? closePlayer : openPlayer}
        className="mt-6 inline-flex items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3 text-left transition-colors hover:border-accent"
      >
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-accent-tint text-ink-strong">
          {open ? <X size={16} /> : <Podcast size={18} />}
        </span>
        <span>
          <span className="block font-bold text-ink">
            {open ? "Close player" : "Listen to AI podcast version"}
          </span>
          <span className="block text-sm text-ink-muted">
            {open ? "Controls are at the bottom of the screen" : "A two-voice audio overview of this post"}
          </span>
        </span>
      </button>

      <audio
        ref={audioRef}
        src={src}
        preload="none"
        aria-label={`Audio recording of ${title}`}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onError={() => {
          setPlaying(false);
          setNotice("The recording could not be loaded.");
        }}
      />

      {open && (
        <div
          role="region"
          aria-label="Audio player"
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
              <p className="truncate text-sm font-bold text-ink" aria-live="polite">
                {playing ? "Playing" : "Paused"}
              </p>
              <p className="truncate text-xs text-ink-muted">
                {clock(time)} / {clock(duration)}
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
            <a href={downloadHref} download className={btn} aria-label="Download the recording">
              <Download size={16} />
            </a>
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
    </>
  );
}
