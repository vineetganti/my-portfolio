/**
 * The animation clock. Everything on screen is a pure function of one number, `elapsed`
 * (milliseconds of playing time), so pausing means "stop adding to it" and resuming carries on
 * from exactly the same frame.
 *
 * One step, in milliseconds:
 *
 *   0 ........ 220 ................ 1320 ..... 1640 ... 1900
 *   edge+label  marker travels       arrives:   edge and label
 *   fade in     (ease in-out)        node pulse fade back
 */
export const STEP_MS = 1900;
export const LOOP_PAUSE_MS = 800;
const LEAD_MS = 220;
const TRAVEL_MS = 1100;
const PULSE_MS = 320;
const FADE_OUT_MS = 320;

export interface Frame {
  /** Which step is active. */
  step: number;
  /** How lit the step's edge and label are, 0 (resting) to 1 (full). */
  glow: number;
  /** How far the marker has travelled along the edge, 0 to 1, already eased. */
  progress: number;
  /** 0 hides the marker. */
  markerOpacity: number;
  /** How strongly the destination box is highlighted, 0 to 1. */
  pulse: number;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

/** Length of one full loop, including the pause before it starts again. */
export const cycleMs = (steps: number) => steps * STEP_MS + LOOP_PAUSE_MS;

/** The frame at `elapsed`, or null during the pause between loops, when nothing is lit. */
export function frameAt(elapsed: number, steps: number): Frame | null {
  if (steps === 0) return null;
  const t = elapsed % cycleMs(steps);
  if (t >= steps * STEP_MS) return null;
  const step = Math.floor(t / STEP_MS);
  const local = t - step * STEP_MS;

  const arrive = LEAD_MS + TRAVEL_MS;
  const fadeStart = STEP_MS - FADE_OUT_MS;
  const glow = local < LEAD_MS ? local / LEAD_MS : local < fadeStart ? 1 : 1 - (local - fadeStart) / FADE_OUT_MS;
  const progress = easeInOut(clamp01((local - LEAD_MS) / TRAVEL_MS));
  const markerOpacity = clamp01((local - 100) / 120) * (1 - clamp01((local - arrive) / 160));
  const pulse = local >= arrive && local < arrive + PULSE_MS ? Math.sin((Math.PI * (local - arrive)) / PULSE_MS) : 0;
  return { step, glow: clamp01(glow), progress, markerOpacity, pulse };
}

/** What a reader sees when motion is reduced: the first step, lit and still. */
export const STATIC_FRAME: Frame = { step: 0, glow: 1, progress: 1, markerOpacity: 0, pulse: 0.6 };
