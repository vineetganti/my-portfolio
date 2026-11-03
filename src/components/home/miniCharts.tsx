"use client";

/**
 * Compact versions of the live charts from the blog, drawn natively for the narrow home-page card
 * (a 340-unit viewBox, so text stays readable at about 330px wide). They use the same maths as the
 * full charts in components/charts and the same palette hexes, which globals.css swaps for the
 * theme tokens inside `.diagram`.
 */

import { useMemo, useState } from "react";
import { ChartFrame, Slider } from "@/components/charts/ChartFrame";
import { SANS, decimalsFor, niceStep, seeded } from "@/components/charts/util";

const W = 340;

const svgProps = (h: number) =>
  ({ viewBox: `0 0 ${W} ${h}`, width: W, height: h, fontFamily: SANS, "aria-hidden": true, focusable: false }) as const;

/* ---------- Memory by precision (post 02) ---------- */

const PRECISIONS = [
  { name: "FP32", bytes: 4, fill: "#dfedcc", stroke: "#4b7d33" },
  { name: "FP16", bytes: 2, fill: "#dfedcc", stroke: "#4b7d33" },
  { name: "INT8", bytes: 1, fill: "#fdf0d4", stroke: "#9a5400" },
  { name: "INT4", bytes: 0.5, fill: "#fdf0d4", stroke: "#9a5400" },
];
const GPU_GB = 24;
const BAR_X = 50;
const BAR_MAX_W = 180;
const fmtGb = (gb: number) => (gb >= 100 ? gb.toFixed(0) : gb.toFixed(1).replace(/\.0$/, ""));

export function DtypeMini() {
  const [billions, setBillions] = useState(7);
  const sizes = PRECISIONS.map((p) => ({ ...p, gb: billions * p.bytes }));
  const scale = BAR_MAX_W / Math.max(sizes[0].gb, GPU_GB);
  const fitting = sizes.filter((s) => s.gb <= GPU_GB).map((s) => s.name);
  const gpuX = BAR_X + GPU_GB * scale;

  return (
    <ChartFrame
      alt="Weight memory of a model at four precisions against a 24 GB GPU. A 7 billion parameter model needs 28 GB in FP32, 14 GB in FP16, 7 GB in INT8 and 3.5 GB in INT4, so only the FP32 version does not fit. Use the slider to change the parameter count."
      readout={
        <>
          A <strong>{billions}B</strong> model needs <strong>{fmtGb(sizes[0].gb)} GB</strong> in FP32 and{" "}
          <strong>{fmtGb(sizes[3].gb)} GB</strong> in INT4.{" "}
          {fitting.length === 0
            ? "None fit a 24 GB GPU."
            : fitting.length === sizes.length
              ? "All fit a 24 GB GPU."
              : `On a 24 GB GPU, ${fitting.join(", ")} fit.`}
        </>
      }
      controls={
        <Slider
          label="Parameters"
          value={billions}
          min={1}
          max={70}
          step={1}
          onChange={setBillions}
          display={`${billions}B`}
          valueText={`${billions} billion parameters`}
        />
      }
    >
      <svg {...svgProps(196)}>
        <rect width={W} height="196" fill="#fffdf8" />
        <line x1={gpuX} y1="8" x2={gpuX} y2="166" stroke="#b0273f" strokeWidth="1.5" strokeDasharray="5 4" />
        <text x={Math.min(Math.max(gpuX, 40), 300)} y="184" fontSize="12" fontWeight="700" fill="#b0273f" textAnchor="middle">
          {GPU_GB} GB GPU
        </text>
        {sizes.map((s, i) => {
          const top = 12 + i * 38;
          const fits = s.gb <= GPU_GB;
          const width = Math.max(2, s.gb * scale);
          return (
            <g key={s.name}>
              <text x="6" y={top + 21} fontSize="12.5" fontWeight="700" fill="#2f281e">
                {s.name}
              </text>
              <rect x={BAR_X} y={top} width={width} height="30" rx="4" fill={s.fill} stroke={fits ? s.stroke : "#b0273f"} strokeWidth="1.5" />
              <text
                x={BAR_X + width + 7}
                y={top + 20}
                fontSize="12.5"
                fontWeight="700"
                fill={fits ? "#2f281e" : "#b0273f"}
                stroke="#fffdf8"
                strokeWidth="4"
                paintOrder="stroke"
              >
                {fmtGb(s.gb)} GB{fits ? "" : " · too big"}
              </text>
            </g>
          );
        })}
      </svg>
    </ChartFrame>
  );
}

/* ---------- Time per decode step (post 04) ---------- */

const WEIGHT_BYTES = 14e9;
const BANDWIDTH = 2e12;
const KV_BYTES_PER_TOKEN = 2 * 32 * 4096 * 2;
const MAX_CONTEXT = 32768;
const WEIGHT_MS = (WEIGHT_BYTES / BANDWIDTH) * 1000;
const kvMs = (batch: number, tokens: number) => ((batch * tokens * KV_BYTES_PER_TOKEN) / BANDWIDTH) * 1000;
const fmtK = (t: number) => (t >= 1000 ? `${(t / 1000).toFixed(t >= 10000 ? 0 : 1).replace(/\.0$/, "")}k` : `${Math.round(t)}`);
const fmtMs = (ms: number) => (ms >= 100 ? ms.toFixed(0) : ms.toFixed(1));

export function DecodeMini() {
  const [context, setContext] = useState(16384);
  const [batch, setBatch] = useState(4);

  const X0 = 38;
  const X1 = 328;
  const Y0 = 150;
  const Y_TOP = 30;
  const kvAtMax = kvMs(batch, MAX_CONTEXT);
  const step = niceStep((WEIGHT_MS + kvAtMax) * 1.08, 3);
  const yMax = step * Math.ceil(((WEIGHT_MS + kvAtMax) * 1.08) / step);
  const x = (t: number) => X0 + (t / MAX_CONTEXT) * (X1 - X0);
  const y = (ms: number) => Y0 - (ms / yMax) * (Y0 - Y_TOP);
  const kvNow = kvMs(batch, context);
  const stepMs = WEIGHT_MS + kvNow;
  const crossover = ((WEIGHT_MS / 1000) * BANDWIDTH) / (batch * KV_BYTES_PER_TOKEN);
  const yTicks: number[] = [];
  for (let v = 0; v <= yMax + 1e-9; v += step) yTicks.push(v);

  return (
    <ChartFrame
      alt="Idealised time per decode step for a 7 billion parameter model. Reading the weights costs a constant 7 milliseconds, and reading the KV cache adds time that grows with the context length and with the batch size. Use the sliders to change both."
      readout={
        <>
          At <strong>{fmtK(context)}</strong> tokens and a batch of <strong>{batch}</strong>, one step takes{" "}
          <strong>{fmtMs(stepMs)} ms</strong>: {fmtMs(WEIGHT_MS)} for weights and {fmtMs(kvNow)} for the KV cache, which
          costs more than the weights past <strong>{fmtK(crossover)}</strong> tokens.
        </>
      }
      controls={
        <>
          <Slider
            label="Context"
            value={context}
            min={0}
            max={MAX_CONTEXT}
            step={256}
            onChange={setContext}
            display={`${fmtK(context)}`}
            valueText={`${context} tokens`}
          />
          <Slider
            label="Batch"
            value={batch}
            min={1}
            max={16}
            step={1}
            onChange={setBatch}
            display={`${batch}`}
            valueText={`${batch} sequences in the batch`}
          />
        </>
      }
    >
      <svg {...svgProps(196)}>
        <rect width={W} height="196" fill="#fffdf8" />
        <rect x={X0} y="9" width="10" height="10" fill="#dfedcc" stroke="#4b7d33" strokeWidth="1" />
        <text x={X0 + 15} y="18" fontSize="11.5" fill="#5e5241">
          weights
        </text>
        <rect x={X0 + 82} y="9" width="10" height="10" fill="#fdf0d4" stroke="#9a5400" strokeWidth="1" />
        <text x={X0 + 97} y="18" fontSize="11.5" fill="#5e5241">
          KV cache
        </text>
        <text x={X1} y="18" fontSize="11" fill="#7a6d57" textAnchor="end">
          ms per step
        </text>

        <rect x={X0} y={y(WEIGHT_MS)} width={X1 - X0} height={Y0 - y(WEIGHT_MS)} fill="#dfedcc" />
        <path d={`M${X0} ${y(WEIGHT_MS)} L${X1} ${y(WEIGHT_MS)} L${X1} ${y(WEIGHT_MS + kvAtMax)} Z`} fill="#fdf0d4" />
        <line x1={X0} y1={y(WEIGHT_MS)} x2={X1} y2={y(WEIGHT_MS)} stroke="#5e5241" strokeWidth="1.2" />
        <line x1={X0} y1={y(WEIGHT_MS)} x2={X1} y2={y(WEIGHT_MS + kvAtMax)} stroke="#9a5400" strokeWidth="2.2" />
        <line x1={X0} y1={Y0} x2={X1} y2={Y0} stroke="#5e5241" strokeWidth="1.4" />
        <line x1={X0} y1={Y0} x2={X0} y2={Y_TOP} stroke="#5e5241" strokeWidth="1.4" />

        {yTicks.map((v) => (
          <text key={v} x={X0 - 6} y={y(v) + 4} fontSize="11" fill="#5e5241" textAnchor="end">
            {v.toFixed(decimalsFor(step))}
          </text>
        ))}
        {[0, 16384, 32768].map((t) => (
          <text key={t} x={x(t)} y={Y0 + 15} fontSize="11" fill="#5e5241" textAnchor={t === 0 ? "start" : t === MAX_CONTEXT ? "end" : "middle"}>
            {t === 0 ? "0" : `${t / 1024}k`}
          </text>
        ))}
        <text x={(X0 + X1) / 2} y="186" fontSize="11.5" fill="#5e5241" textAnchor="middle">
          tokens already in the KV cache
        </text>

        {crossover < MAX_CONTEXT && (
          <line x1={x(crossover)} y1={y(WEIGHT_MS)} x2={x(crossover)} y2={Y0} stroke="#9a5400" strokeWidth="1.2" strokeDasharray="4 3" />
        )}
        <line x1={x(context)} y1={y(stepMs)} x2={x(context)} y2={Y0} stroke="#2f281e" strokeWidth="1.1" strokeDasharray="3 3" />
        <circle cx={x(context)} cy={y(stepMs)} r="6" fill="#fdf0d4" stroke="#9a5400" strokeWidth="2" />
      </svg>
    </ChartFrame>
  );
}

/* ---------- Waiting for a naive batch to fill (post 06) ---------- */

const NAIVE_MAX_N = 8;
/** Gaps between arrivals in units of 1/λ: the same ones the full chart draws, then a seeded exponential draw. */
const NAIVE_GAPS = (() => {
  const rand = seeded(11);
  const gaps = [0.9, 1.4, 0.8];
  while (gaps.length < NAIVE_MAX_N - 1) gaps.push(-Math.log(1 - rand()));
  return gaps;
})();
const rateFor = (s: number) => Number((10 ** s).toPrecision(2));

function fmtSeconds(s: number, decimals?: number): string {
  if (decimals !== undefined) return `${s.toFixed(decimals)} s`;
  if (s === 0) return "0 s";
  if (s >= 10) return `${s.toFixed(0)} s`;
  if (s >= 1) return `${s.toFixed(1)} s`;
  if (s >= 0.1) return `${s.toFixed(2)} s`;
  return `${s.toFixed(3)} s`;
}

export function NaiveMini() {
  const [rateLog, setRateLog] = useState(0);
  const [n, setN] = useState(4);
  const rate = rateFor(rateLog);

  const X0 = 38;
  const X1 = 216;
  const ROWS_TOP = 12;
  const ROWS_HEIGHT = 104;
  const AXIS_Y = 126;

  const { arrivals, waits, fillTime, expected } = useMemo(() => {
    const times = [0];
    for (let k = 1; k < n; k++) times.push(times[k - 1] + NAIVE_GAPS[k - 1] / rate);
    const start = times[n - 1];
    return { arrivals: times, waits: times.map((t) => start - t), fillTime: start, expected: (n - 1) / (2 * rate) };
  }, [n, rate]);

  const axisMax = fillTime * 1.22;
  const step = niceStep(axisMax, 3);
  const decimals = decimalsFor(step);
  const x = (t: number) => X0 + (t / axisMax) * (X1 - X0);
  const rowH = ROWS_HEIGHT / n;
  const rowY = (k: number) => ROWS_TOP + rowH * (k + 0.5);
  const fontSize = Math.min(12, rowH - 2.5);
  const ticks: number[] = [];
  for (let t = 0; t <= axisMax + 1e-9; t += step) ticks.push(t);

  return (
    <ChartFrame
      alt="A timeline of the requests that arrive while a naive batch fills. At a batch size of four and one request per second the first request waits about three seconds, an average of 1.5 seconds. At 20 requests per second the average wait is 0.075 seconds. Use the sliders to change the arrival rate and the batch size."
      readout={
        <>
          A batch of <strong>{n}</strong> at <strong>{rate} req/s</strong> fills after <strong>{fmtSeconds(fillTime)}</strong>.
          Ten times the traffic, a tenth of the wait.
        </>
      }
      controls={
        <>
          <Slider
            label="Rate λ"
            value={rateLog}
            min={-0.3}
            max={1.7}
            step={0.05}
            onChange={setRateLog}
            display={`${rate}/s`}
            valueText={`${rate} requests per second`}
          />
          <Slider
            label="Batch N"
            value={n}
            min={2}
            max={NAIVE_MAX_N}
            step={1}
            onChange={setN}
            display={`${n}`}
            valueText={`${n} requests per batch`}
          />
        </>
      }
    >
      <svg {...svgProps(182)}>
        <rect width={W} height="182" fill="#fffdf8" />
        {arrivals.map((t, k) => (
          <g key={k}>
            <text x={X0 - 10} y={rowY(k) + fontSize / 3} fontSize={fontSize} fontWeight="700" fill="#2f281e" textAnchor="end">
              R{k + 1}
            </text>
            {waits[k] > 0 && (
              <line x1={x(t) + 5} y1={rowY(k)} x2={x(fillTime)} y2={rowY(k)} stroke="#b0273f" strokeWidth="1.4" strokeDasharray="4 3" />
            )}
            <circle cx={x(t)} cy={rowY(k)} r={Math.min(4.5, rowH / 3)} fill="#fdf0d4" stroke="#9a5400" strokeWidth="1.2" />
            <text x={x(fillTime) + 9} y={rowY(k) + fontSize / 3} fontSize={fontSize} fill={waits[k] > 0 ? "#b0273f" : "#5e5241"}>
              waits {fmtSeconds(waits[k])}
            </text>
          </g>
        ))}
        <line x1={x(fillTime)} y1={ROWS_TOP - 4} x2={x(fillTime)} y2={ROWS_TOP + ROWS_HEIGHT + 4} stroke="#9a5400" strokeWidth="1.4" strokeDasharray="5 3" />
        <line x1={X0} y1={AXIS_Y} x2={X1} y2={AXIS_Y} stroke="#5e5241" strokeWidth="1.1" />
        {ticks.map((t) => (
          <text key={t} x={x(t)} y={AXIS_Y + 15} fontSize="11" fill="#7a6d57" textAnchor="middle">
            {fmtSeconds(t, decimals)}
          </text>
        ))}
        <text x="170" y="172" fontSize="12.5" fill="#2f281e" textAnchor="middle">
          average wait{" "}
          <tspan fontWeight="700" fill="#b0273f">
            {fmtSeconds(expected)}
          </tspan>{" "}
          = (N − 1) ÷ 2λ
        </text>
      </svg>
    </ChartFrame>
  );
}

/* ---------- Poisson arrivals (post 06) ---------- */

const DURATION = 20;
const exponential = (rand: () => number, rate: number) => -Math.log(1 - rand()) / rate;
const sec = (s: number) => (s >= 10 ? s.toFixed(0) : s.toFixed(s >= 1 ? 1 : 2));

export function PoissonMini() {
  const [rate, setRate] = useState(1.5);
  const [seed, setSeed] = useState(7);

  const X0 = 12;
  const X1 = 328;
  const AXIS_Y = 88;
  const tx = (t: number) => X0 + (t / DURATION) * (X1 - X0);

  const { arrivals, lull } = useMemo(() => {
    const rand = seeded(seed);
    const times: number[] = [];
    for (let t = exponential(rand, rate); t < DURATION; t += exponential(rand, rate)) times.push(t);
    let longest = { from: 0, to: 0, gap: 0 };
    for (let i = 1; i < times.length; i++) {
      const gap = times[i] - times[i - 1];
      if (gap > longest.gap) longest = { from: times[i - 1], to: times[i], gap };
    }
    return { arrivals: times, lull: longest };
  }, [rate, seed]);

  return (
    <ChartFrame
      alt="Twenty seconds of requests arriving at random at an average rate you can change. Arrivals bunch into bursts and leave long gaps, even though the average rate is constant. Use the slider for the rate and the button for a new random draw."
      readout={
        <>
          <strong>{arrivals.length}</strong> arrivals in {DURATION} s at <strong>{rate} req/s</strong> (the average is{" "}
          {Math.round(rate * DURATION)}). The longest lull was <strong>{sec(lull.gap)} s</strong>.
        </>
      }
      controls={
        <>
          <Slider
            label="Rate λ"
            value={rate}
            min={0.5}
            max={5}
            step={0.1}
            onChange={(v) => setRate(Math.round(v * 10) / 10)}
            display={`${rate}/s`}
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
      <svg {...svgProps(122)}>
        <rect width={W} height="122" fill="#fffdf8" />
        <text x={X0} y="18" fontSize="12.5" fontWeight="700" fill="#2f281e">
          {arrivals.length} arrivals, never evenly spaced
        </text>
        <line x1={X0} y1={AXIS_Y} x2={X1} y2={AXIS_Y} stroke="#5e5241" strokeWidth="1.3" />
        {[0, 5, 10, 15, 20].map((t) => (
          <g key={t}>
            <line x1={tx(t)} y1={AXIS_Y} x2={tx(t)} y2={AXIS_Y + 5} stroke="#5e5241" strokeWidth="1" />
            <text x={tx(t)} y={AXIS_Y + 19} fontSize="11" fill="#7a6d57" textAnchor={t === 0 ? "start" : t === DURATION ? "end" : "middle"}>
              {t === DURATION ? "20 s" : t}
            </text>
          </g>
        ))}
        {arrivals.map((t, i) => (
          <g key={i}>
            <line x1={tx(t)} y1="58" x2={tx(t)} y2={AXIS_Y} stroke="#9a5400" strokeWidth="2" />
            <circle cx={tx(t)} cy="56" r="3.5" fill="#fdf0d4" stroke="#9a5400" strokeWidth="1.2" />
          </g>
        ))}
        {lull.gap > 0 && (
          <g>
            <line x1={tx(lull.from)} y1="42" x2={tx(lull.to)} y2="42" stroke="#b0273f" strokeWidth="1.3" />
            <line x1={tx(lull.from)} y1="38" x2={tx(lull.from)} y2="46" stroke="#b0273f" strokeWidth="1.3" />
            <line x1={tx(lull.to)} y1="38" x2={tx(lull.to)} y2="46" stroke="#b0273f" strokeWidth="1.3" />
            <text
              x={Math.min(Math.max((tx(lull.from) + tx(lull.to)) / 2, 50), 290)}
              y="36"
              fontSize="11.5"
              fontWeight="700"
              fill="#b0273f"
              textAnchor="middle"
              stroke="#fffdf8"
              strokeWidth="4"
              paintOrder="stroke"
            >
              {sec(lull.gap)} s lull
            </text>
          </g>
        )}
      </svg>
    </ChartFrame>
  );
}
