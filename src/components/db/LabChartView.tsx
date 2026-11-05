"use client";

import { useMemo, useRef, useState } from "react";
import { ChartFrame, Slider } from "@/components/charts/ChartFrame";
import { MONO, SANS, decimalsFor, niceStep } from "@/components/charts/util";
import type { ChartSeries, LabChartData } from "@/components/db/types";

const W = 720;
const H = 340;
const X0 = 76;
const X1 = 610;
const Y0 = 282;
const Y1 = 56;

// The site's palette is small and two of its hues sit close together for red-green colour
// blindness, so a series is told apart by its line pattern, marker shape and direct label as well.
const SERIES = [
  { color: "#9a5400", dash: undefined, shape: "circle" },
  { color: "#4b7d33", dash: "7 4", shape: "square" },
  { color: "#b0273f", dash: "2 4", shape: "diamond" },
  { color: "#2f281e", dash: "10 3 2 3", shape: "triangle" },
] as const;

function Marker({ shape, x, y, color, big }: { shape: string; x: number; y: number; color: string; big?: boolean }) {
  const r = big ? 7 : 4.5;
  const common = { fill: big ? "#fdf0d4" : color, stroke: big ? color : "#fffdf8", strokeWidth: big ? 2.2 : 1.5 };
  if (shape === "square") return <rect x={x - r} y={y - r} width={r * 2} height={r * 2} {...common} />;
  if (shape === "diamond") return <polygon points={`${x},${y - r - 1} ${x + r + 1},${y} ${x},${y + r + 1} ${x - r - 1},${y}`} {...common} />;
  if (shape === "triangle") return <polygon points={`${x},${y - r - 1} ${x + r + 1},${y + r} ${x - r - 1},${y + r}`} {...common} />;
  return <circle cx={x} cy={y} r={r} {...common} />;
}

const compact = (n: number) => {
  if (n >= 1e6) return `${+(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${+(n / 1e3).toFixed(1)}k`;
  return `${+n.toPrecision(3)}`;
};

function logTicks(min: number, max: number): number[] {
  const out: number[] = [];
  for (let p = Math.floor(Math.log10(min)); p <= Math.ceil(Math.log10(max)); p++) out.push(10 ** p);
  return out;
}

/** Math.log10 can differ in its last digits between server and browser, which breaks hydration. */
const px = (v: number) => Math.round(v * 100) / 100;

function scale(values: number[], log: boolean | undefined, from: number, to: number) {
  const max = Math.max(...values);
  const positive = values.filter((v) => v > 0);
  if (log) {
    const ticks = logTicks(Math.min(...positive), max);
    const lo = Math.log10(ticks[0]);
    const hi = Math.log10(ticks[ticks.length - 1]);
    return { ticks, at: (v: number) => px(from + ((Math.log10(Math.max(v, ticks[0])) - lo) / (hi - lo || 1)) * (to - from)) };
  }
  const step = niceStep(max || 1);
  const top = Math.ceil(max / step) * step || 1;
  const ticks: number[] = [];
  for (let i = 0; i <= top / step + 1e-9; i++) ticks.push(+(i * step).toFixed(decimalsFor(step)));
  return { ticks, at: (v: number) => px(from + (v / top) * (to - from)) };
}

const pointAt = (s: ChartSeries, x: number) => s.points.find((p) => p[0] === x);

/**
 * Plots numbers measured on a real database. There is one y-axis, the values are the recorded
 * ones, and the slider or a drag across the plot reads off any measured point exactly.
 */
export default function LabChartView({ chart }: { chart: LabChartData }) {
  const xs = useMemo(() => [...new Set(chart.series.flatMap((s) => s.points.map((p) => p[0])))].sort((a, b) => a - b), [chart]);
  const [index, setIndex] = useState(xs.length - 1);
  const svg = useRef<SVGSVGElement>(null);

  const xScale = scale(xs, chart.x.log, X0, X1);
  const yScale = scale(chart.series.flatMap((s) => s.points.map((p) => p[1])), chart.y.log, Y0, Y1);
  const unit = chart.y.unit ?? "";
  const formatX = (v: number) => (chart.x.format === "pct" ? `${+v.toPrecision(3)}%` : compact(v));
  const formatY = (v: number) => `${v === chart.y.zeroAt ? 0 : v >= 100 ? Math.round(v).toLocaleString("en-US") : +v.toPrecision(3)}${unit ? ` ${unit}` : ""}`;

  const x = xs[index];
  const xTicks = chart.x.log ? xScale.ticks : xs.length <= 8 ? xs : xScale.ticks;

  const pick = (e: React.PointerEvent<SVGRectElement>) => {
    const box = svg.current?.getBoundingClientRect();
    if (!box) return;
    const px = ((e.clientX - box.left) / box.width) * W;
    let best = 0;
    xs.forEach((v, i) => {
      if (Math.abs(xScale.at(v) - px) < Math.abs(xScale.at(xs[best]) - px)) best = i;
    });
    setIndex(best);
  };

  return (
    <ChartFrame
      alt={chart.alt}
      readout={
        <>
          At <strong>{formatX(x)}</strong> {chart.x.label.replace(/^% /, "")}:{" "}
          {chart.series.map((s, i) => {
            const p = pointAt(s, x);
            return p ? (
              <span key={s.name}>
                {i > 0 ? " · " : ""}
                {chart.series.length > 1 ? `${s.name} ` : ""}
                <strong>{formatY(p[1])}</strong>
                {p[2] ? ` (${p[2]})` : ""}
              </span>
            ) : null;
          })}
          <span className="chart-source"> ✅ measured on {chart.engine}</span>
        </>
      }
      controls={
        <Slider
          label={chart.x.label}
          value={index}
          min={0}
          max={xs.length - 1}
          step={1}
          onChange={setIndex}
          display={formatX(x)}
        />
      }
    >
      <svg ref={svg} viewBox={`0 0 ${W} ${H}`} width={W} height={H} fontFamily={SANS} aria-hidden="true" focusable="false">
        <rect width={W} height={H} fill="#fffdf8" />
        <text x="20" y="26" fontSize="14" fontWeight="700" fill="#2f281e">
          {chart.title}
        </text>
        {chart.y.log && (
          <text x="20" y="44" fontSize="11" fill="#7a6d57" fontFamily={MONO}>
            log scale: each gridline is 10 times the one below
          </text>
        )}

        {yScale.ticks.map((t) => (
          <g key={t}>
            <line x1={X0} y1={yScale.at(t)} x2={X1} y2={yScale.at(t)} stroke="#dccfb1" strokeWidth="0.8" />
            <text x={X0 - 8} y={yScale.at(t) + 4} fontSize="10.5" fill="#7a6d57" textAnchor="end">
              {compact(t)}
            </text>
          </g>
        ))}
        <line x1={X0} y1={Y0} x2={X1} y2={Y0} stroke="#5e5241" strokeWidth="1.2" />
        {xTicks.map((t) => (
          <text key={t} x={xScale.at(t)} y={Y0 + 18} fontSize="10.5" fill="#7a6d57" textAnchor="middle">
            {formatX(t)}
          </text>
        ))}
        <text x={(X0 + X1) / 2} y={Y0 + 40} fontSize="11.5" fill="#5e5241" textAnchor="middle">
          {chart.x.label}
        </text>
        <text x={16} y={(Y0 + Y1) / 2} fontSize="11.5" fill="#5e5241" textAnchor="middle" transform={`rotate(-90 16 ${(Y0 + Y1) / 2})`}>
          {chart.y.label}
        </text>

        <line x1={xScale.at(x)} y1={Y1} x2={xScale.at(x)} y2={Y0} stroke="#7a6d57" strokeWidth="1" strokeDasharray="3 4" />

        {chart.series.map((s, i) => {
          const style = SERIES[i % SERIES.length];
          const line = s.points.map((p) => `${xScale.at(p[0]).toFixed(1)},${yScale.at(p[1]).toFixed(1)}`).join(" ");
          const end = s.points[s.points.length - 1];
          const here = pointAt(s, x);
          return (
            <g key={s.name}>
              <polyline points={line} fill="none" stroke={style.color} strokeWidth="2" strokeDasharray={style.dash} />
              {s.points.map((p) => (
                <Marker key={p[0]} shape={style.shape} x={xScale.at(p[0])} y={yScale.at(p[1])} color={style.color} />
              ))}
              {here && <Marker shape={style.shape} x={xScale.at(here[0])} y={yScale.at(here[1])} color={style.color} big />}
              {chart.series.length > 1 && (
                <text x={xScale.at(end[0]) + 10} y={yScale.at(end[1]) + 4} fontSize="11.5" fontWeight="700" fill="#2f281e">
                  {s.name}
                </text>
              )}
            </g>
          );
        })}

        <rect
          x={X0}
          y={Y1}
          width={X1 - X0}
          height={Y0 - Y1}
          fill="transparent"
          style={{ cursor: "ew-resize", touchAction: "pan-y" }}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            pick(e);
          }}
          onPointerMove={(e) => {
            if (e.buttons === 1) pick(e);
          }}
        />
      </svg>
    </ChartFrame>
  );
}
