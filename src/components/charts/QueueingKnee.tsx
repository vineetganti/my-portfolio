"use client";

import { useMemo, useRef, useState } from "react";
import { ChartFrame, Slider } from "./ChartFrame";
import { MONO, SANS } from "./util";

// Same geometry as queueing-knee.svg, so the live chart reads as the picture it replaces.
const W = 720;
const H = 330;
const X0 = 80; // utilization 0%
const X1 = 680; // utilization 100%
const Y0 = 282; // 0x the service time
const Y_TOP = 60; // 25x
const MAX_MULTIPLE = 25;
const PER_MULTIPLE = (Y0 - Y_TOP) / MAX_MULTIPLE;

const x = (rho: number) => X0 + (X1 - X0) * rho;
const y = (multiple: number) => Y0 - multiple * PER_MULTIPLE;
/** M/M/1: average time in the system as a multiple of the service time, 1 ÷ (1 − ρ). */
const multipleAt = (rho: number) => 1 / (1 - rho);

const LANDMARKS = [0.5, 0.8, 0.9, 0.95];

const DESCRIPTION =
  "The average time in an M/M/1 queue, as a multiple of the service time, plotted against utilization: 2 times at 50% load, 5 at 80%, 10 at 90% and 20 at 95%. The curve is flat at first and shoots up near full load. Drag the marker or use the slider to read any utilization.";

const fmt = (n: number) => (n >= 100 ? Math.round(n).toString() : n.toFixed(1).replace(/\.0$/, ""));

export default function QueueingKnee({ alt = DESCRIPTION, compact = false }: { alt?: string; compact?: boolean }) {
  const [rho, setRho] = useState(0.9);
  // Compact is for a narrow card: drop the title and long captions, crop to the plot and enlarge the labels.
  const fs = (size: number) => (compact ? size * 1.9 : size);
  const viewBox = compact ? `0 48 ${W} 270` : `0 0 ${W} ${H}`;
  const svgRef = useRef<SVGSVGElement>(null);

  // The curve stops at the top of the chart, where it reaches 25x.
  const curve = useMemo(() => {
    const points: string[] = [];
    for (let r = 0; r <= 0.96 + 1e-9; r += 0.002) points.push(`${x(r).toFixed(1)},${y(multipleAt(r)).toFixed(1)}`);
    return points.join(" ");
  }, []);

  const multiple = multipleAt(rho);
  const offChart = multiple > MAX_MULTIPLE;
  const markerY = Math.max(Y_TOP, y(multiple));

  const setFromPointer = (e: React.PointerEvent<SVGRectElement>) => {
    const box = svgRef.current?.getBoundingClientRect();
    if (!box) return;
    const r = (((e.clientX - box.left) / box.width) * W - X0) / (X1 - X0);
    setRho(Math.round(Math.min(0.99, Math.max(0, r)) * 100) / 100);
  };

  return (
    <ChartFrame
      alt={alt}
      readout={
        compact ? (
          <>
            At <strong>{Math.round(rho * 100)}%</strong> load, a request waits <strong>{fmt(multiple)}×</strong> its
            service time.
          </>
        ) : (
          <>
            At <strong>ρ = {Math.round(rho * 100)}%</strong> a request spends <strong>{fmt(multiple)}×</strong> its
            service time in the system
            {rho >= 0.9 ? ": a small rise in load now costs a lot of waiting." : "."}
          </>
        )
      }
      controls={
        <Slider
          label="Utilization ρ"
          value={rho}
          min={0}
          max={0.99}
          step={0.01}
          onChange={setRho}
          display={`${Math.round(rho * 100)}%`}
          valueText={`${Math.round(rho * 100)} percent, ${fmt(multiple)} times the service time`}
        />
      }
    >
      <svg ref={svgRef} viewBox={viewBox} width={W} height={compact ? 270 : H} fontFamily={SANS} aria-hidden="true" focusable="false">
        <rect width={W} height={H} fill="#fffdf8" />
        {!compact && (
          <>
            <text x="20" y="26" fontSize="14" fontWeight="700" fill="#2f281e">
              Time in the system shoots up as utilization approaches 100%
            </text>
            <text x="700" y="46" fontSize="11.5" fill="#5e5241" textAnchor="end" fontStyle="italic" fontFamily={MONO}>
              M/M/1 queue: W ÷ service time = 1 ÷ (1 − ρ)
            </text>
          </>
        )}

        <rect x={x(0.8)} y={Y_TOP} width={X1 - x(0.8)} height={Y0 - Y_TOP} fill="#fbd8d1" opacity="0.6" />
        <text x={(x(0.8) + X1) / 2} y={compact ? 84 : 76} fontSize={fs(11.5)} fontWeight="700" fill="#b0273f" textAnchor="middle">
          the knee
        </text>

        <line x1={X0} y1={Y0} x2={X1} y2={Y0} stroke="#5e5241" strokeWidth="1.2" />
        {[0, 5, 10, 15, 20, 25].map((m) => (
          <g key={m}>
            {m > 0 && <line x1={X0} y1={y(m)} x2={X1} y2={y(m)} stroke="#dccfb1" strokeWidth="0.8" />}
            <text x={X0 - 8} y={y(m) + (compact ? 7 : 4)} fontSize={fs(10.5)} fill="#7a6d57" textAnchor="end">
              {m}×
            </text>
          </g>
        ))}
        {(compact ? [0, 0.5, 1] : [0, 0.2, 0.4, 0.6, 0.8, 1]).map((r) => (
          <text key={r} x={x(r)} y={compact ? 305 : 300} fontSize={fs(10.5)} fill="#7a6d57" textAnchor="middle">
            {Math.round(r * 100)}%
          </text>
        ))}
        {!compact && (
          <text x="380" y="320" fontSize="11.5" fill="#5e5241" textAnchor="middle">
            utilization ρ = arrival rate ÷ service rate
          </text>
        )}

        <polyline points={curve} fill="none" stroke="#5e5241" strokeWidth="2.4" />

        {/* The four values quoted in the post, kept as small reference marks. */}
        {LANDMARKS.map((r) => (
          <g key={r}>
            <circle cx={x(r)} cy={y(multipleAt(r))} r="3.5" fill="#fdf0d4" stroke="#9a5400" strokeWidth="1.2" />
            {!compact && (
              <text x={x(r) - 9} y={y(multipleAt(r)) - 7} fontSize="11" fill="#5e5241" textAnchor="end">
                {Math.round(r * 100)}% → {Math.round(multipleAt(r))}×
              </text>
            )}
          </g>
        ))}

        {/* The live marker, with guide lines down to the axes. */}
        <line x1={x(rho)} y1={markerY} x2={x(rho)} y2={Y0} stroke="#9a5400" strokeWidth="1.2" strokeDasharray="3 4" />
        <line x1={X0} y1={markerY} x2={x(rho)} y2={markerY} stroke="#9a5400" strokeWidth="1.2" strokeDasharray="3 4" />
        <circle cx={x(rho)} cy={markerY} r={compact ? 11 : 7} fill="#fdf0d4" stroke="#9a5400" strokeWidth="2.2" />
        {offChart && (
          // Left of the shaded knee, with a background-coloured halo so the guide line doesn't cut through it.
          <text
            x={x(0.8) - 8}
            y={markerY + (compact ? 7 : 4)}
            fontSize={fs(11.5)}
            fontWeight="700"
            fill="#b0273f"
            stroke="#fffdf8"
            strokeWidth="4"
            paintOrder="stroke"
            textAnchor="end"
          >
            off the chart: {fmt(multiple)}×
          </text>
        )}

        {/* Dragging anywhere on the plot moves the marker; the slider below does the same. */}
        <rect
          x={X0}
          y={Y_TOP}
          width={X1 - X0}
          height={Y0 - Y_TOP}
          fill="transparent"
          style={{ cursor: "ew-resize", touchAction: "pan-y" }}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            setFromPointer(e);
          }}
          onPointerMove={(e) => {
            if (e.buttons === 1) setFromPointer(e);
          }}
        />
      </svg>
    </ChartFrame>
  );
}
