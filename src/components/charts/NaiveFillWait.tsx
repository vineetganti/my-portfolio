"use client";

import { useMemo, useState } from "react";
import { ChartFrame, Slider } from "./ChartFrame";
import { MONO, SANS, decimalsFor, niceStep, seeded } from "./util";

const W = 720;
const H = 214;
const X0 = 90; // time 0
const X1 = 560; // right end of the time axis
const ROWS_TOP = 58;
const ROWS_HEIGHT = 108;
const AXIS_Y = 172;
const MAX_N = 8;

const DESCRIPTION =
  "A timeline of the requests that arrive while a naive batch fills. With a batch size of four and 1 request per second the first request waits about 3 seconds, an average of 1.5 seconds per request. At 20 requests per second the batch fills in about 0.15 seconds, an average of 0.075 seconds. Use the sliders to change the arrival rate and the batch size.";

/**
 * Gaps between arrivals, in units of 1/λ. The first three are the ones drawn in the original
 * picture (arrivals at 0, 0.9, 2.3 and 3.1 s at 1 request per second); the rest come from a
 * seeded exponential draw, so the chart is the same on every visit.
 */
const GAPS = (() => {
  const rand = seeded(11);
  const gaps = [0.9, 1.4, 0.8];
  while (gaps.length < MAX_N - 1) gaps.push(-Math.log(1 - rand()));
  return gaps;
})();

/** The slider moves in powers of ten: 0.5 to 50 requests per second. */
const rateFor = (s: number) => Number((10 ** s).toPrecision(2));
const fmtRate = (r: number) => `${r} req/s`;

function fmtSeconds(s: number, decimals?: number): string {
  if (decimals !== undefined) return `${s.toFixed(decimals)} s`;
  if (s === 0) return "0 s";
  if (s >= 10) return `${s.toFixed(0)} s`;
  if (s >= 1) return `${s.toFixed(1)} s`;
  if (s >= 0.1) return `${s.toFixed(2)} s`;
  return `${s.toFixed(3)} s`;
}

export default function NaiveFillWait({ alt = DESCRIPTION }: { alt?: string }) {
  const [rateLog, setRateLog] = useState(0); // 10^0 = 1 request per second
  const [n, setN] = useState(4);
  const rate = rateFor(rateLog);

  const { arrivals, waits, fillTime, expected, drawn } = useMemo(() => {
    const times = [0];
    for (let k = 1; k < n; k++) times.push(times[k - 1] + GAPS[k - 1] / rate);
    const start = times[n - 1];
    const w = times.map((t) => start - t);
    return {
      arrivals: times,
      waits: w,
      fillTime: start,
      expected: (n - 1) / (2 * rate), // E[wait] = (N − 1) ÷ 2λ
      drawn: w.reduce((a, b) => a + b, 0) / n,
    };
  }, [n, rate]);

  const axisMax = fillTime * 1.22;
  const step = niceStep(axisMax, 4);
  const decimals = decimalsFor(step);
  const x = (t: number) => X0 + (t / axisMax) * (X1 - X0);
  const rowH = ROWS_HEIGHT / n;
  const rowY = (k: number) => ROWS_TOP + rowH * (k + 0.5);
  const fontSize = Math.min(11, rowH - 2.5);
  const ticks: number[] = [];
  for (let t = 0; t <= axisMax + 1e-9; t += step) ticks.push(t);

  return (
    <ChartFrame
      alt={alt}
      readout={
        <>
          With <strong>{n}</strong> requests per batch at <strong>{fmtRate(rate)}</strong>, the batch fills after{" "}
          <strong>{fmtSeconds(fillTime)}</strong>. Requests wait <strong>{fmtSeconds(expected)}</strong> on average
          ((N − 1) ÷ 2λ); in this random draw they waited {fmtSeconds(drawn)}. Ten times the traffic, a tenth of the
          wait.
        </>
      }
      controls={
        <>
          <Slider
            label="Arrival rate λ"
            value={rateLog}
            min={-0.3}
            max={1.7}
            step={0.05}
            onChange={setRateLog}
            display={fmtRate(rate)}
            valueText={`${rate} requests per second`}
          />
          <Slider
            label="Batch size N"
            value={n}
            min={2}
            max={MAX_N}
            step={1}
            onChange={setN}
            display={`${n}`}
            valueText={`${n} requests per batch`}
          />
        </>
      }
    >
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} fontFamily={SANS} aria-hidden="true" focusable="false">
        <rect width={W} height={H} fill="#fffdf8" />
        <text x="20" y="26" fontSize="14" fontWeight="700" fill="#2f281e">
          Waiting for a batch of N = {n} to fill
        </text>
        <text x="700" y="26" fontSize="12" fontWeight="700" fill="#5e5241" textAnchor="end" fontFamily={MONO}>
          E[wait] = (N − 1) ÷ 2λ
        </text>
        <rect x="10" y="40" width="700" height="150" rx="14" fill="#faf3e3" stroke="#5e5241" strokeWidth="1.5" />
        <text x="24" y="58" fontSize="13" fontWeight="700" fill="#2f281e">
          {rate === 1 ? "1 request per second" : `${rate} requests per second`}
        </text>

        {arrivals.map((t, k) => (
          <g key={k}>
            <text x={X0 - 12} y={rowY(k) + fontSize / 3} fontSize={fontSize} fontWeight="700" fill="#2f281e" textAnchor="end">
              R{k + 1}
            </text>
            {waits[k] > 0 && (
              <line x1={x(t) + 5} y1={rowY(k)} x2={x(fillTime)} y2={rowY(k)} stroke="#b0273f" strokeWidth="1.5" strokeDasharray="4 3" />
            )}
            <circle cx={x(t)} cy={rowY(k)} r={Math.min(4, rowH / 3)} fill="#fdf0d4" stroke="#9a5400" strokeWidth="1.2" />
            <text
              x={x(fillTime) + 12}
              y={rowY(k) + fontSize / 3}
              fontSize={fontSize}
              fill={waits[k] > 0 ? "#b0273f" : "#5e5241"}
            >
              waits {fmtSeconds(waits[k])}
            </text>
          </g>
        ))}
        <line x1={x(fillTime)} y1={ROWS_TOP - 4} x2={x(fillTime)} y2={ROWS_TOP + ROWS_HEIGHT + 4} stroke="#9a5400" strokeWidth="1.4" strokeDasharray="5 3" />

        <line x1={X0} y1={AXIS_Y} x2={X1} y2={AXIS_Y} stroke="#5e5241" strokeWidth="1.1" />
        {ticks.map((t) => (
          <text key={t} x={x(t)} y={AXIS_Y + 14} fontSize="10.5" fill="#7a6d57" textAnchor="middle">
            {fmtSeconds(t, decimals)}
          </text>
        ))}

        <text x="640" y="92" fontSize="12" fill="#2f281e" textAnchor="middle">
          average wait
        </text>
        <text x="640" y="114" fontSize="15" fontWeight="700" fill="#b0273f" textAnchor="middle">
          {fmtSeconds(expected)}
        </text>
        <text x="640" y="132" fontSize="10.5" fill="#5e5241" textAnchor="middle">
          this draw: {fmtSeconds(drawn)}
        </text>

        <text x="360" y="206" fontSize="12.5" fill="#5e5241" textAnchor="middle" fontStyle="italic">
          The batch starts at arrival number {n} (dashed line). One random draw of arrival gaps, scaled by 1 ÷ λ.
        </text>
      </svg>
    </ChartFrame>
  );
}
