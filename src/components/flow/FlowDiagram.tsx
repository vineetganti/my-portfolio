"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createFlow, type Flow } from "./createFlow";
import { MARKER_TYPES, type FlowStep } from "./markers";

/** Longest slice of time one frame may add, so a tab that was asleep does not jump ahead. */
const MAX_FRAME_MS = 100;

const REDUCED = "(prefers-reduced-motion: reduce)";
const subscribeReduced = (notify: () => void) => {
  const query = window.matchMedia(REDUCED);
  query.addEventListener("change", notify);
  return () => query.removeEventListener("change", notify);
};
const reducedNow = () => window.matchMedia(REDUCED).matches;

/**
 * (Spans, not divs: a markdown image sits inside a <p>, and a div there breaks hydration.)
 *
 * An inlined SVG diagram with a looping "message flow" animation: one message at a time travels
 * along the diagram's arrows, in the order of `steps`. The SVG itself is not changed.
 *
 * - One clock (`elapsed`) drives everything, so pause and resume are exact.
 * - It pauses by itself while off screen and resumes when it comes back, unless the reader paused it.
 * - With reduced motion it starts paused, showing the first step lit and still.
 */
export default function FlowDiagram({ svg, steps, alt }: { svg: string; steps: FlowStep[]; alt: string }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const reduced = useSyncExternalStore(subscribeReduced, reducedNow, () => false);
  // null until the reader presses the button; then their choice wins over the reduced-motion default.
  const [choice, setChoice] = useState<boolean | null>(null);
  const playing = choice ?? !reduced;

  const playingRef = useRef(playing);
  const update = useRef<() => void>(() => {});
  const flowRef = useRef<Flow | null>(null);
  const elapsedRef = useRef(0);

  // Pause and play: record the choice and let the animation loop react to it. Paused before it ever
  // played (reduced motion): show the first step lit and still, so the diagram is not left plain.
  useEffect(() => {
    playingRef.current = playing;
    update.current();
    if (!playing && elapsedRef.current === 0) flowRef.current?.renderStatic();
  }, [playing]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const flow = createFlow(root, steps);
    if (!flow) return;
    flowRef.current = flow;
    root.dataset.flowReady = "true";

    let visible = true;
    let frame = 0;
    let last: number | null = null;

    const tick = (now: number) => {
      elapsedRef.current += last === null ? 0 : Math.min(now - last, MAX_FRAME_MS);
      last = now;
      flow.renderAt(elapsedRef.current);
      frame = requestAnimationFrame(tick);
    };
    update.current = () => {
      const run = playingRef.current && visible;
      if (run && !frame) {
        last = null; // resume from the same elapsed time, adding nothing for the time spent paused
        frame = requestAnimationFrame(tick);
      } else if (!run && frame) {
        cancelAnimationFrame(frame);
        frame = 0; // the last drawn frame stays on screen
      }
    };

    if (!playingRef.current && elapsedRef.current === 0) flow.renderStatic();

    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      update.current();
    });
    observer.observe(root);
    update.current();

    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      update.current = () => {};
      flowRef.current = null;
      flow.destroy();
      delete root.dataset.flowReady;
    };
  }, [steps]);

  const used = [...new Set(steps.map((s) => s.type))];

  return (
    <span ref={rootRef} className="diagram diagram-flow" role="group" aria-label={alt}>
      <span className="flow-svg" dangerouslySetInnerHTML={{ __html: svg }} />

      <button
        type="button"
        className="flow-toggle"
        aria-label="Pause animation"
        aria-pressed={!playing}
        data-tip={playing ? "Pause animation" : "Play animation"}
        onClick={() => setChoice(!playing)}
      >
        <svg viewBox="0 0 10 10" width="9" height="9" aria-hidden="true" focusable="false">
          {playing ? (
            <path d="M1.5 1h2.5v8H1.5zM6 1h2.5v8H6z" fill="currentColor" />
          ) : (
            <path d="M2 1l7 4-7 4z" fill="currentColor" />
          )}
        </svg>
        <span>{playing ? "Pause" : "Play"}</span>
      </button>

      <span className="flow-legend">
        {used.map((type) => (
          <span key={type} className="flow-legend-item">
            <svg
              viewBox="-8 -7 16 14"
              width="16"
              height="14"
              aria-hidden="true"
              focusable="false"
              dangerouslySetInnerHTML={{ __html: MARKER_TYPES[type].markup }}
            />
            {MARKER_TYPES[type].label}
          </span>
        ))}
      </span>
    </span>
  );
}
