/** A small seeded random generator (mulberry32), so a chart shows the same "random" data on every render. */
export function seeded(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A round tick spacing (1, 2, 5 times a power of ten) that gives at most `maxTicks` ticks up to `max`. */
export function niceStep(max: number, maxTicks = 5): number {
  const raw = max / maxTicks;
  const pow = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 5, 10]) if (m * pow >= raw) return m * pow;
  return 10 * pow;
}

/** Number of decimals a tick label needs so that steps of `step` stay distinguishable. */
export const decimalsFor = (step: number) => Math.max(0, -Math.floor(Math.log10(step) + 1e-9));

export const SANS = "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
export const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
