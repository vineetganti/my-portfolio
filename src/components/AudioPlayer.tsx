"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Headphones, Pause, Play, Settings2, SkipBack, SkipForward, Square } from "lucide-react";
import {
  WORDS_PER_MINUTE,
  collectChunks,
  nextBlockStart,
  previousBlockStart,
  type SpeechChunk,
} from "@/lib/speech";

const CONTENT_ID = "post-content";
const ACTIVE_CLASS = "tts-active";
const RATES = [0.75, 1, 1.25, 1.5, 1.75, 2];
const PREF_KEY = "post-audio-prefs";
/** Wait this long after cancelling before speaking again; phones can drop speech queued at the same instant. */
const RESTART_DELAY_MS = 80;
/** If speech hasn't begun after this long, tell the reader instead of sitting silent. */
const START_TIMEOUT_MS = 4500;
/** How often to check that speech is still making progress. */
const WATCHDOG_MS = 500;

// ---- browser support and voices, kept out of React state ------------------

const subscribeNothing = () => () => {};
const supportsSpeech = () =>
  "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined";

let voiceCache: SpeechSynthesisVoice[] = [];

function readVoices(): SpeechSynthesisVoice[] {
  const english = window.speechSynthesis
    .getVoices()
    .filter((v) => v.lang.toLowerCase().startsWith("en"));
  // Neural / online voices (Edge, Chrome) sound far better, so list them first.
  const rank = (v: SpeechSynthesisVoice) => (/natural|neural|online/i.test(v.name) ? 0 : 1);
  return english.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

function subscribeVoices(onChange: () => void) {
  const synth = window.speechSynthesis;
  const handler = () => {
    voiceCache = readVoices();
    onChange();
  };
  synth.addEventListener("voiceschanged", handler);
  return () => synth.removeEventListener("voiceschanged", handler);
}

function getVoices() {
  if (voiceCache.length === 0) {
    const found = readVoices();
    if (found.length > 0) voiceCache = found;
  }
  return voiceCache;
}

const noVoices: SpeechSynthesisVoice[] = [];

interface Prefs {
  rate: number;
  voice: string;
  /** Read image descriptions aloud. */
  diagrams: boolean;
}

function loadPrefs(): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(PREF_KEY) ?? "{}");
    return {
      rate: RATES.includes(raw.rate) ? raw.rate : 1,
      voice: typeof raw.voice === "string" ? raw.voice : "",
      diagrams: raw.diagrams !== false,
    };
  } catch {
    return { rate: 1, voice: "", diagrams: true };
  }
}

function savePrefs(prefs: Prefs) {
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify(prefs));
  } catch {
    // Storage can be blocked; the player works without remembering settings.
  }
}

// ---- highlighting ---------------------------------------------------------

function highlight(el: Element | null, previous: Element | null) {
  previous?.classList.remove(ACTIVE_CLASS);
  if (!el) return;
  el.classList.add(ACTIVE_CLASS);
  const { top, bottom } = el.getBoundingClientRect();
  // Keep the spoken block clear of the sticky header (top) and the player bar (bottom).
  if (top < 140 || bottom > window.innerHeight - 150) {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
  }
}

const formatMinutes = (words: number, rate: number) => {
  const m = Math.ceil(words / (WORDS_PER_MINUTE * rate));
  return m <= 1 ? "under a minute" : `${m} min`;
};

// ---- the component --------------------------------------------------------

export default function AudioPlayer({ minutes }: { minutes: number }) {
  const supported = useSyncExternalStore(subscribeNothing, supportsSpeech, () => false);
  const voices = useSyncExternalStore(subscribeVoices, getVoices, () => noVoices);

  const [active, setActive] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [index, setIndex] = useState(0);
  const [notice, setNotice] = useState("");
  const [track, setTrack] = useState<{ chunks: SpeechChunk[]; wordsLeft: number[] }>({
    chunks: [],
    wordsLeft: [],
  });
  const [prefs, setPrefs] = useState<Prefs>(() =>
    typeof window === "undefined" ? { rate: 1, voice: "", diagrams: true } : loadPrefs()
  );

  // Latest values for use inside speech callbacks, which outlive a render.
  const chunksRef = useRef<SpeechChunk[]>([]);
  const prefsRef = useRef(prefs);
  const voicesRef = useRef(voices);
  const indexRef = useRef(0);
  const genRef = useRef(0);
  const litRef = useRef<Element | null>(null);
  // Chrome can garbage-collect an utterance mid-speech and then never fire its end event,
  // so the current one is kept alive here.
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const statusRef = useRef({ gen: 0, spokenAt: 0, startedAt: 0 });
  useEffect(() => {
    prefsRef.current = prefs;
    voicesRef.current = voices;
  });

  const clearHighlight = useCallback(() => {
    litRef.current?.classList.remove(ACTIVE_CLASS);
    litRef.current = null;
  }, []);

  const stop = useCallback(() => {
    genRef.current++;
    window.speechSynthesis.cancel();
    clearHighlight();
    indexRef.current = 0;
    setIndex(0);
    setPlaying(false);
    setActive(false);
    setShowSettings(false);
    setNotice("");
  }, [clearHighlight]);

  const speakRef = useRef<(i: number) => void>(() => {});
  const speak = (i: number) => {
    const chunks = chunksRef.current;
    const synth = window.speechSynthesis;
    if (i >= chunks.length) {
      stop();
      return;
    }
    const gen = ++genRef.current;
    // Only cancel when something is actually queued: cancelling an idle engine and speaking in the
    // same instant makes iOS Safari and Android Chrome drop the new speech.
    const wasBusy = synth.speaking || synth.pending;
    if (wasBusy) synth.cancel();
    synth.resume(); // clears a stuck "paused" state, which mobile Chrome can leave behind
    indexRef.current = i;
    setIndex(i);
    setPlaying(true);
    highlight(chunks[i].el, litRef.current);
    litRef.current = chunks[i].el;

    const utterance = new SpeechSynthesisUtterance(chunks[i].text);
    const voice = voicesRef.current.find((v) => v.name === prefsRef.current.voice);
    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang;
    } else {
      utterance.lang = "en-US";
    }
    utterance.rate = prefsRef.current.rate;
    statusRef.current = { gen, spokenAt: Date.now(), startedAt: 0 };
    utterance.onstart = () => {
      if (genRef.current === gen) {
        statusRef.current.startedAt = Date.now();
        setNotice("");
      }
    };
    utterance.onend = () => {
      if (genRef.current === gen) speakRef.current(i + 1);
    };
    utterance.onerror = (e) => {
      // Pausing or skipping cancels the utterance on purpose; anything else is a real failure.
      if (genRef.current === gen && e.error !== "interrupted" && e.error !== "canceled") {
        genRef.current++;
        setPlaying(false);
        setNotice(
          e.error === "not-allowed"
            ? "Your browser blocked the audio. Tap play to try again."
            : `Speech failed (${e.error}). Tap play to try again.`
        );
      }
    };
    utteranceRef.current = utterance;
    // Straight away when idle (so the first tap's permission still applies), after a beat when restarting.
    if (wasBusy) {
      setTimeout(() => {
        if (genRef.current === gen) synth.speak(utterance);
      }, RESTART_DELAY_MS);
    } else {
      synth.speak(utterance);
    }
  };
  useEffect(() => {
    speakRef.current = speak;
  });

  const buildTrack = (diagrams: boolean): SpeechChunk[] | null => {
    const root = document.getElementById(CONTENT_ID);
    if (!root) return null;
    const chunks = collectChunks(root, { describeImages: diagrams });
    if (chunks.length === 0) return null;
    const wordsLeft: number[] = new Array(chunks.length + 1).fill(0);
    for (let i = chunks.length - 1; i >= 0; i--) wordsLeft[i] = wordsLeft[i + 1] + chunks[i].words;
    chunksRef.current = chunks;
    setTrack({ chunks, wordsLeft });
    return chunks;
  };

  const start = () => {
    if (!buildTrack(prefs.diagrams)) return;
    setNotice("");
    setActive(true);
    speakRef.current(0);
  };

  /** Re-reads the page with the new diagram setting and carries on from the same place. */
  const changeDiagrams = (diagrams: boolean) => {
    const here = chunksRef.current[indexRef.current]?.el;
    const next = { ...prefs, diagrams };
    prefsRef.current = next;
    setPrefs(next);
    savePrefs(next);
    const chunks = buildTrack(diagrams);
    if (!chunks) return;
    let i = chunks.findIndex(
      (c) => c.el === here || (here && here.compareDocumentPosition(c.el) & Node.DOCUMENT_POSITION_FOLLOWING)
    );
    if (i === -1) i = chunks.length - 1;
    if (playing) {
      speakRef.current(i);
    } else {
      indexRef.current = i;
      setIndex(i);
      highlight(chunks[i].el, litRef.current);
      litRef.current = chunks[i].el;
    }
  };

  const pause = () => {
    genRef.current++; // ignore the cancelled utterance's end event
    window.speechSynthesis.cancel();
    setPlaying(false);
  };

  const seek = (i: number) => {
    if (i < 0 || i >= chunksRef.current.length) return;
    if (playing) {
      speakRef.current(i);
    } else {
      indexRef.current = i;
      setIndex(i);
      highlight(chunksRef.current[i].el, litRef.current);
      litRef.current = chunksRef.current[i].el;
    }
  };

  const updatePrefs = (next: Prefs) => {
    prefsRef.current = next; // the restarted chunk below must already see it
    setPrefs(next);
    savePrefs(next);
    if (playing) speakRef.current(indexRef.current);
  };

  // Phones sometimes never report that speech finished, or never start it. Check that it is progressing.
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      const synth = window.speechSynthesis;
      const st = statusRef.current;
      if (st.gen !== genRef.current) return;
      const now = Date.now();
      if (!st.startedAt) {
        if (now - st.spokenAt > START_TIMEOUT_MS && !synth.speaking) {
          genRef.current++;
          setPlaying(false);
          setNotice(
            "Nothing was spoken. Check the volume (and the silent switch on iPhone), then tap play again."
          );
        }
      } else if (!synth.speaking && !synth.pending && now - st.startedAt > 600) {
        speakRef.current(indexRef.current + 1); // the end event never came, so move on
      }
    }, WATCHDOG_MS);
    return () => clearInterval(id);
  }, [playing]);

  // Stop speaking when leaving the post or closing the tab.
  useEffect(() => {
    const generation = genRef;
    const lit = litRef;
    const cancel = () => window.speechSynthesis?.cancel();
    window.addEventListener("pagehide", cancel);
    return () => {
      window.removeEventListener("pagehide", cancel);
      generation.current++;
      cancel();
      lit.current?.classList.remove(ACTIVE_CLASS);
    };
  }, []);

  if (!supported) return null;

  const total = track.chunks.length;
  const wordsLeft = track.wordsLeft[index] ?? 0;
  const btn =
    "inline-flex h-10 w-10 items-center justify-center rounded-full border border-border text-ink-2 transition-colors hover:border-accent hover:text-ink disabled:opacity-40 disabled:hover:border-border";

  return (
    <>
      <button
        type="button"
        onClick={active ? stop : start}
        className="mt-6 inline-flex items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3 text-left transition-colors hover:border-accent"
      >
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-accent-tint text-ink-strong">
          {active ? <Square size={15} /> : <Headphones size={18} />}
        </span>
        <span>
          <span className="block font-bold text-ink">
            {active ? "Stop listening" : "Listen to this post"}
          </span>
          <span className="block text-sm text-ink-muted">
            {active
              ? "Controls are at the bottom of the screen"
              : `About ${minutes} min · reads the text and diagram descriptions, skips code and tables`}
          </span>
        </span>
      </button>

      {active && (
        <div
          role="region"
          aria-label="Audio player"
          className="fixed left-1/2 z-40 w-[min(44rem,calc(100%-2rem))] -translate-x-1/2 rounded-2xl border border-border bg-card p-3 shadow-lg"
          style={{ bottom: "max(1rem, env(safe-area-inset-bottom))" }}
        >
          <div className="flex items-center gap-2 sm:gap-3">
            <button
              type="button"
              className={btn}
              aria-label="Previous paragraph"
              onClick={() => seek(previousBlockStart(track.chunks, index))}
            >
              <SkipBack size={16} />
            </button>
            <button
              type="button"
              className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-accent text-cream transition-colors hover:bg-accent-hover"
              aria-label={playing ? "Pause" : "Play"}
              onClick={() => (playing ? pause() : speakRef.current(indexRef.current))}
            >
              {playing ? <Pause size={20} /> : <Play size={20} />}
            </button>
            <button
              type="button"
              className={btn}
              aria-label="Next paragraph"
              disabled={nextBlockStart(track.chunks, index) === -1}
              onClick={() => seek(nextBlockStart(track.chunks, index))}
            >
              <SkipForward size={16} />
            </button>

            <div className="min-w-0 flex-1 px-1">
              <p className="truncate text-sm font-bold text-ink" aria-live="polite">
                {playing ? "Playing" : "Paused"}
              </p>
              <p className="truncate text-xs text-ink-muted">
                {formatMinutes(wordsLeft, prefs.rate)} left
                <span className="hidden sm:inline">
                  {" "}
                  · part {index + 1} of {total}
                </span>
              </p>
            </div>

            <button
              type="button"
              className="h-10 rounded-full border border-border px-3 text-sm font-bold text-ink-2 transition-colors hover:border-accent hover:text-ink"
              aria-label={`Speed ${prefs.rate} times. Change speed`}
              onClick={() =>
                updatePrefs({
                  ...prefs,
                  rate: RATES[(RATES.indexOf(prefs.rate) + 1) % RATES.length],
                })
              }
            >
              {prefs.rate}×
            </button>
            <button
              type="button"
              className={btn}
              aria-label="Voice settings"
              aria-expanded={showSettings}
              onClick={() => setShowSettings((s) => !s)}
            >
              <Settings2 size={16} />
            </button>
          </div>

          {notice && (
            <p role="status" className="mt-3 rounded-lg bg-accent-tint px-3 py-2 text-sm text-ink-strong">
              {notice}
            </p>
          )}

          <div className="mt-3 h-1 overflow-hidden rounded-full bg-border" aria-hidden="true">
            <div
              className="h-full bg-tool transition-[width]"
              style={{ width: `${total ? (index / total) * 100 : 0}%` }}
            />
          </div>

          {showSettings && (
            <div className="mt-3 border-t border-border pt-3">
              <label className="flex items-center gap-2 text-sm font-bold text-ink-2" htmlFor="audio-diagrams">
                <input
                  id="audio-diagrams"
                  type="checkbox"
                  checked={prefs.diagrams}
                  onChange={(e) => changeDiagrams(e.target.checked)}
                  className="h-4 w-4"
                />
                Describe diagrams (reads each image&apos;s description)
              </label>
              <label className="mt-3 block text-sm font-bold text-ink-2" htmlFor="audio-voice">
                Voice
              </label>
              <select
                id="audio-voice"
                value={prefs.voice}
                onChange={(e) => updatePrefs({ ...prefs, voice: e.target.value })}
                className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-ink"
              >
                <option value="">Browser default</option>
                {voices.map((v) => (
                  <option key={v.name} value={v.name}>
                    {v.name} ({v.lang})
                  </option>
                ))}
              </select>
              <p className="mt-2 text-xs text-ink-muted">
                Voices come from your browser and device. Names with &quot;Natural&quot; or
                &quot;Online&quot; usually sound best.
              </p>
            </div>
          )}
        </div>
      )}
    </>
  );
}
