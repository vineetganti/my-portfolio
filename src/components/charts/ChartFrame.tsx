import type { ReactNode } from "react";

/**
 * The card around a live chart. It carries the `diagram` class, so it gets the same border,
 * padding and theme recolouring as the static SVG diagrams (draw with the palette hexes those
 * SVGs use, for example #5e5241 for muted ink, and `.diagram [fill=…]` swaps in the theme token).
 *
 * The listen-to-this-post reader (src/lib/speech.ts) treats `.diagram` as an image and reads
 * its `aria-label`, so keep paragraphs, list items, headings and tables out of the chart:
 * use div, span, label and output only.
 */
export function ChartFrame({
  alt,
  children,
  controls,
  readout,
}: {
  /** What the chart shows, written like image alt text. */
  alt: string;
  children: ReactNode;
  controls?: ReactNode;
  /** A line of text under the chart, normally what the current slider values mean. */
  readout?: ReactNode;
}) {
  return (
    <div className="diagram diagram-live" role="group" aria-label={alt}>
      {children}
      {readout && <div className="chart-readout">{readout}</div>}
      {controls && <div className="chart-controls">{controls}</div>}
    </div>
  );
}

/** A labelled range input with its current value shown beside it. */
export function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  display,
  valueText,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  /** The value as shown on screen, for example "90%". */
  display: string;
  /** The value as a screen reader should say it, if different from `display`. */
  valueText?: string;
}) {
  return (
    <label className="chart-slider">
      <span>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-valuetext={valueText ?? display}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <output aria-live="off">{display}</output>
    </label>
  );
}
