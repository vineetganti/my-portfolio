"use client";

import { useMemo, useState } from "react";
import { ChartFrame, Slider } from "./ChartFrame";
import { SANS, decimalsFor, niceStep, seeded } from "./util";

const W = 720;
const H = 392;

// Top panel: the arrivals on a 20-second timeline.
const DURATION = 20;
const TL_X0 = 40;
const TL_X1 = 690;
const TL_AXIS_Y = 92;
const BURST_WINDOW = 1.5;

// Bottom panel: a histogram of the gaps between 2,000 arrivals.
const GAPS = 2000;
const BIN = 0.2;
const BINS = 15; // 0 to 3 seconds
const H_X0 = 70;
const H_X1 = 680;
const H_BASE_Y = 342;
const H_TOP_Y = 196;

const DESCRIPTION =
  "A simulation of Poisson arrivals. Top: 20 seconds of arrivals at an average rate you can change, with natural bursts and gaps. Bottom: a histogram of the gaps between 2,000 simulated arrivals follows the exponential curve, whose mean is one over the rate. Use the slider for the rate and the button for a new random draw.";

const exponential = (rand: () => number, rate: number) => -Math.log(1 - rand()) / rate;
const sec = (s: number) => (s >= 10 ? s.toFixed(0) : s.toFixed(s >= 1 ? 1 : 2));

export default function PoissonArrivals({ alt = DESCRIPTION }: { alt?: string }) {
  const [rate, setRate] = useState(1.5);
  const [seed, setSeed] = useState(7);

  const sim = useMemo(() => {
    // Arrivals: add exponential gaps up to 20 seconds.
    const rand = seeded(seed);
    const arrivals: number[] = [];
    for (let t = exponential(rand, rate); t < DURATION; t += exponential(rand, rate)) arrivals.push(t);

    // The longest gap between two neighbouring arrivals.
    let lull = { from: 0, to: 0, gap: 0 };
    for (let i = 1; i < arrivals.length; i++) {
      const gap = arrivals[i] - arrivals[i - 1];
      if (gap > lull.gap) lull = { from: arrivals[i - 1], to: arrivals[i], gap };
    }

    // The busiest 1.5-second window that starts at an arrival.
    let burst = { start: 0, count: 0 };
    for (let i = 0, j = 0; i < arrivals.length; i++) {
      while (arrivals[j] < arrivals[i] - BURST_WINDOW) j++;
      // count arrivals in [arrivals[i] - window, arrivals[i]]
      const count = i - j + 1;
      if (count > burst.count) burst = { start: arrivals[i] - BURST_WINDOW, count };
    }

    // Gaps: a separate draw of 2,000, binned every 0.2 s.
    const other = seeded(seed + 1000);
    const counts = new Array<number>(BINS).fill(0);
    let sum = 0;
    for (let i = 0; i < GAPS; i++) {
      const g = exponential(other, rate);
      sum += g;
      const b = Math.floor(g / BIN);
      if (b < BINS) counts[b]++;
    }
    return { arrivals, lull, burst, counts, meanGap: sum / GAPS };
  }, [rate, seed]);

  const tx = (t: number) => TL_X0 + (t / DURATION) * (TL_X1 - TL_X0);
  const hx = (g: number) => H_X0 + (g / (BINS * BIN)) * (H_X1 - H_X0);

  // The curve λ·e^(−λx), scaled to "gaps per bin": 2,000 × 0.2 × λ at x = 0.
  const curveTop = GAPS * BIN * rate;
  const peak = Math.max(curveTop, ...sim.counts) * 1.02;
  const yStep = niceStep(peak, 3);
  const yMax = yStep * Math.ceil(peak / yStep);
  const hy = (count: number) => H_BASE_Y - (count / yMax) * (H_BASE_Y - H_TOP_Y);
  const yTicks: number[] = [];
  for (let v = 0; v <= yMax + 1e-9; v += yStep) yTicks.push(v);
  const curve: string[] = [];
  for (let g = 0; g <= BINS * BIN + 1e-9; g += 0.05) curve.push(`${hx(g).toFixed(1)},${hy(curveTop * Math.exp(-rate * g)).toFixed(1)}`);

  const n = sim.arrivals.length;
  const showLull = sim.lull.gap > 0;
  const lullMid = (tx(sim.lull.from) + tx(sim.lull.to)) / 2;
  const burstMid = (tx(sim.burst.start) + tx(sim.burst.start + BURST_WINDOW)) / 2;

  return (
    <ChartFrame
      alt={alt}
      readout={
        <>
          In {DURATION} seconds at <strong>{rate} requests per second</strong> this draw has <strong>{n}</strong> arrivals
          (the average is {Math.round(rate * DURATION)}). The longest lull was <strong>{sec(sim.lull.gap)} s</strong>, and the
          busiest {BURST_WINDOW} seconds had <strong>{sim.burst.count}</strong>. Gaps average{" "}
          <strong>{sec(sim.meanGap)} s</strong>, close to 1 ÷ λ = {sec(1 / rate)} s.
        </>
      }
      controls={
        <>
          <Slider
            label="Arrival rate λ"
            value={rate}
            min={0.5}
            max={5}
            step={0.1}
            onChange={(v) => setRate(Math.round(v * 10) / 10)}
            display={`${rate} req/s`}
            valueText={`${rate} requests per second`}
          />
          <div className="chart-actions">
            <button type="button" className="chart-button" onClick={() => setSeed((s) => s + 1)}>
              New random draw
            </button>
          </div>
        </>
      }
    >
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} fontFamily={SANS} aria-hidden="true" focusable="false">
        <rect width={W} height={H} fill="#fffdf8" />

        <rect x="10" y="10" width="700" height="132" rx="14" fill="#faf3e3" stroke="#5e5241" strokeWidth="1.5" />
        <text x="24" y="34" fontSize="13" fontWeight="700" fill="#2f281e">
          {DURATION} seconds at λ = {rate} requests per second: {n} arrivals
        </text>
        <line x1={TL_X0} y1={TL_AXIS_Y} x2={TL_X1} y2={TL_AXIS_Y} stroke="#5e5241" strokeWidth="1.3" />
        {Array.from({ length: 11 }, (_, i) => i * 2).map((t) => (
          <g key={t}>
            <line x1={tx(t)} y1={TL_AXIS_Y} x2={tx(t)} y2={TL_AXIS_Y + 6} stroke="#5e5241" strokeWidth="1" />
            <text x={tx(t)} y="114" fontSize="10.5" fill="#7a6d57" textAnchor="middle">
              {t === 0 ? "0 s" : t === DURATION ? "20 s" : t}
            </text>
          </g>
        ))}
        {sim.arrivals.map((t, i) => (
          <g key={i}>
            <line x1={tx(t)} y1="66" x2={tx(t)} y2={TL_AXIS_Y} stroke="#9a5400" strokeWidth="2" />
            <circle cx={tx(t)} cy="64" r="3.5" fill="#fdf0d4" stroke="#9a5400" strokeWidth="1.2" />
          </g>
        ))}
        {showLull && (
          <g>
            <line x1={tx(sim.lull.from)} y1="54" x2={tx(sim.lull.to)} y2="54" stroke="#b0273f" strokeWidth="1.3" />
            <line x1={tx(sim.lull.from)} y1="54" x2={tx(sim.lull.from)} y2="60" stroke="#b0273f" strokeWidth="1.3" />
            <line x1={tx(sim.lull.to)} y1="54" x2={tx(sim.lull.to)} y2="60" stroke="#b0273f" strokeWidth="1.3" />
            <text x={lullMid} y="48" fontSize="11" fontWeight="700" fill="#b0273f" textAnchor="middle">
              a {sec(sim.lull.gap)} s lull
            </text>
          </g>
        )}
        {sim.burst.count > 1 && (
          <g>
            <line x1={tx(sim.burst.start)} y1="54" x2={tx(sim.burst.start + BURST_WINDOW)} y2="54" stroke="#9a5400" strokeWidth="1.3" />
            <line x1={tx(sim.burst.start)} y1="54" x2={tx(sim.burst.start)} y2="60" stroke="#9a5400" strokeWidth="1.3" />
            <line x1={tx(sim.burst.start + BURST_WINDOW)} y1="54" x2={tx(sim.burst.start + BURST_WINDOW)} y2="60" stroke="#9a5400" strokeWidth="1.3" />
            <text x={Math.min(Math.max(burstMid, 90), 650)} y="48" fontSize="11" fontWeight="700" fill="#9a5400" textAnchor="middle">
              a burst: {sim.burst.count} in {BURST_WINDOW} s
            </text>
          </g>
        )}

        <rect x="10" y="156" width="700" height="226" rx="14" fill="#faf3e3" stroke="#5e5241" strokeWidth="1.5" />
        <text x="24" y="180" fontSize="13" fontWeight="700" fill="#2f281e">
          gaps between {GAPS.toLocaleString("en-US")} simulated arrivals, with the exponential curve λ·e^(−λx)
        </text>
        {yTicks.map((v) => (
          <g key={v}>
            {v > 0 && <line x1={H_X0} y1={hy(v)} x2={H_X1} y2={hy(v)} stroke="#dccfb1" strokeWidth="0.8" />}
            <text x="62" y={hy(v) + 4} fontSize="10.5" fill="#7a6d57" textAnchor="end">
              {v.toFixed(decimalsFor(yStep))}
            </text>
          </g>
        ))}
        <line x1={H_X0} y1={H_BASE_Y} x2={H_X1} y2={H_BASE_Y} stroke="#5e5241" strokeWidth="1.3" />
        {sim.counts.map((c, i) => (
          <rect
            key={i}
            x={hx(i * BIN) + 2.7}
            y={hy(c)}
            width={(H_X1 - H_X0) / BINS - 4}
            height={H_BASE_Y - hy(c)}
            rx="2"
            fill="#dfedcc"
            stroke="#4b7d33"
            strokeWidth="1"
          />
        ))}
        <polyline points={curve.join(" ")} fill="none" stroke="#9a5400" strokeWidth="2.2" />
        {[0, 1, 2, 3].map((g) => (
          <text key={g} x={hx(g)} y="358" fontSize="10.5" fill="#7a6d57" textAnchor="middle">
            {g} s
          </text>
        ))}
        <line x1={hx(sim.meanGap)} y1="202" x2={hx(sim.meanGap)} y2={H_BASE_Y} stroke="#b0273f" strokeWidth="1.4" strokeDasharray="4 3" />
        <text x={hx(sim.meanGap) + 6} y="214" fontSize="11.5" fontWeight="700" fill="#b0273f">
          mean gap {sec(sim.meanGap)} s (1/λ = {sec(1 / rate)} s)
        </text>
      </svg>
    </ChartFrame>
  );
}
