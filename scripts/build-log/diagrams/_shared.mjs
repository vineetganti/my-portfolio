// Shared drawing helpers for the "Building this site" diagrams.
import { MUTED } from "../../db-lab/canvas.mjs";

/**
 * A summary map: a title, then one column per idea, each a box with a heading and a few short lines,
 * and an optional closing sentence under the columns.
 */
export function summaryMap(c, title, columns, closing) {
  const n = columns.length;
  const gap = 10;
  const w = Math.floor((680 - gap * (n - 1)) / n);
  const tallest = Math.max(...columns.map((col) => col.lines.length));
  const h = 48 + tallest * 19;
  c.size(720, 70 + h + (closing ? 50 : 16)).title(title);
  const tones = ["amber", "green", "cream", "raised", "neutral"];
  columns.forEach((col, i) => {
    c.box(20 + i * (w + gap), 50, w, h, col.name, { tone: col.tone ?? tones[i % tones.length], lines: col.lines, size: 12.5, small: 10.5 });
  });
  if (closing) c.para(20, 70 + h + 10, closing, { width: 680, size: 12, fill: MUTED, weight: 700 });
}
