"use client";

import { useState } from "react";
import { MONO, SANS } from "@/components/charts/util";
import { ResultTable } from "@/components/db/ResultTable";

interface Item {
  lp: number;
  off: number;
  len: number;
  /** 0 unused, 1 normal, 2 redirect (`off` then holds the line pointer it redirects to), 3 dead. */
  flags: number;
  xmin: string | null;
  xmax: string | null;
  ctid: string | null;
}

interface PageStep {
  label: string;
  caption: string;
  lower: number;
  upper: number;
  special: number;
  pagesize: number;
  items: Item[];
  rows: (string | number)[][];
}

export interface PageData {
  engine: string;
  steps: PageStep[];
}

const W = 720;
const BAR_Y = 92;
const BAR_H = 56;
const X0 = 16;
const X1 = W - 16;
const HEADER_W = 58;
const POINTER_W = 34;
const TUPLE_MIN = 56;

/** Row versions take their width from their real size, kept wide enough to label. */
const tupleWidth = (len: number) => TUPLE_MIN + len * 1.1;

const isDead = (item: Item) => item.flags === 1 && item.xmax !== "0";

/**
 * One real 8 KB Postgres page, read with pageinspect after each step. Bytes aren't drawn to scale,
 * or the rows would be slivers: the free space in the middle is shortened and labelled instead.
 */
export default function PageExplorerView({ data }: { data: PageData }) {
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const step = data.steps[index];

  const tuples = step.items.filter((i) => i.flags === 1).sort((a, b) => b.off - a.off);
  const tupleX = new Map<number, number>();
  let right = X1;
  for (const t of tuples) {
    right -= tupleWidth(t.len);
    tupleX.set(t.lp, right);
  }
  const pointerX = (lp: number) => X0 + HEADER_W + (lp - 1) * POINTER_W;
  const freeStart = pointerX(step.items.length + 1);
  const freeBytes = step.upper - step.lower;
  const selected = picked === null ? undefined : step.items.find((i) => i.lp === picked);

  const go = (i: number) => {
    setIndex(i);
    setPicked(null);
  };

  return (
    <div
      className="diagram diagram-live data-trace page-explorer"
      role="group"
      aria-label="A real Postgres page read with pageinspect after each step. Rows fill the page from the end and line pointers from the front. An update adds a new row version and leaves the old one, a delete only marks the row, and vacuum removes dead versions and repacks the live rows."
    >
      <div className="dt-steps" role="tablist" aria-label="Steps">
        {data.steps.map((s, i) => (
          <button key={s.label} type="button" role="tab" aria-selected={i === index} className="dt-step" onClick={() => go(i)}>
            <span className="dt-step-n">{i + 1}</span>
            {s.label}
          </button>
        ))}
      </div>
      <div className="dt-caption">{step.caption}</div>

      <svg viewBox={`0 0 ${W} 190`} width={W} height={190} fontFamily={SANS} role="presentation">
        <rect width={W} height={190} fill="#fffdf8" />
        <text x={X0} y={18} fontSize="12" fontWeight="700" fill="#2f281e">
          Page 0 of table t: {step.pagesize} bytes
        </text>
        <text x={X1} y={18} fontSize="11" fill="#5e5241" textAnchor="end" fontFamily={MONO}>
          lower {step.lower} · upper {step.upper}
        </text>

        <rect x={X0} y={BAR_Y} width={X1 - X0} height={BAR_H} rx="6" fill="#faf3e3" stroke="#5e5241" strokeWidth="1.5" />
        <rect x={X0} y={BAR_Y} width={HEADER_W} height={BAR_H} rx="6" fill="#f3eadb" stroke="#7a6d57" strokeWidth="1.2" />
        <text x={X0 + HEADER_W / 2} y={BAR_Y + 24} fontSize="11" fontWeight="700" fill="#2f281e" textAnchor="middle">
          header
        </text>
        <text x={X0 + HEADER_W / 2} y={BAR_Y + 40} fontSize="10" fill="#5e5241" textAnchor="middle">
          24 B
        </text>

        {step.items.map((item) => {
          const x = pointerX(item.lp);
          const on = picked === item.lp;
          return (
            <g key={item.lp} onClick={() => setPicked(on ? null : item.lp)} style={{ cursor: "pointer" }}>
              <rect
                x={x}
                y={BAR_Y}
                width={POINTER_W}
                height={BAR_H}
                fill={item.flags === 0 ? "#f3eadb" : "#fde3ad"}
                stroke={on ? "#2f281e" : "#9a5400"}
                strokeWidth={on ? 2.2 : 1.2}
              />
              <text x={x + POINTER_W / 2} y={BAR_Y + 25} fontSize="12" fontWeight="700" fill="#2f281e" textAnchor="middle">
                {item.lp}
              </text>
              <text x={x + POINTER_W / 2} y={BAR_Y + 41} fontSize="9" fill="#5e5241" textAnchor="middle">
                {item.flags === 0 ? "free" : item.flags === 2 ? "→ " + item.off : "4 B"}
              </text>
            </g>
          );
        })}

        <text x={(freeStart + (tuples.length ? (tupleX.get(tuples[tuples.length - 1].lp) ?? X1) : X1)) / 2} y={BAR_Y + 26} fontSize="12" fontWeight="700" fill="#5e5241" textAnchor="middle">
          free space
        </text>
        <text x={(freeStart + (tuples.length ? (tupleX.get(tuples[tuples.length - 1].lp) ?? X1) : X1)) / 2} y={BAR_Y + 42} fontSize="11" fill="#5e5241" textAnchor="middle" fontFamily={MONO}>
          {freeBytes} bytes
        </text>

        {tuples.map((t) => {
          const x = tupleX.get(t.lp) ?? X1;
          const w = tupleWidth(t.len);
          const dead = isDead(t);
          const on = picked === t.lp;
          return (
            <g key={t.lp} onClick={() => setPicked(on ? null : t.lp)} style={{ cursor: "pointer" }}>
              <rect x={x} y={BAR_Y} width={w} height={BAR_H} fill={dead ? "#fbd8d1" : "#dfedcc"} stroke={on ? "#2f281e" : dead ? "#b0273f" : "#4b7d33"} strokeWidth={on ? 2.2 : 1.2} />
              <text x={x + w / 2} y={BAR_Y + 25} fontSize="11" fontWeight="700" fill="#2f281e" textAnchor="middle">
                {dead ? "dead" : "live"}
              </text>
              <text x={x + w / 2} y={BAR_Y + 41} fontSize="10" fill="#5e5241" textAnchor="middle">
                {t.len} B
              </text>
            </g>
          );
        })}

        {/* Each line pointer's arrow to the row it locates. */}
        {step.items
          .filter((i) => i.flags === 1)
          .map((item) => {
            const from = pointerX(item.lp) + POINTER_W / 2;
            const to = (tupleX.get(item.lp) ?? X1) + tupleWidth(item.len) / 2;
            const lift = 18 + item.lp * 9;
            const on = picked === item.lp;
            return (
              <path
                key={item.lp}
                d={`M${from} ${BAR_Y} C${from} ${BAR_Y - lift}, ${to} ${BAR_Y - lift}, ${to} ${BAR_Y - 2}`}
                fill="none"
                stroke={on ? "#2f281e" : "#9a5400"}
                strokeWidth={on ? 2 : 1.3}
              />
            );
          })}
        {step.items
          .filter((i) => i.flags === 2)
          .map((item) => {
            const from = pointerX(item.lp) + POINTER_W / 2;
            const to = pointerX(item.off) + POINTER_W / 2;
            return <path key={item.lp} d={`M${from} ${BAR_Y + BAR_H} C${from} ${BAR_Y + BAR_H + 22}, ${to} ${BAR_Y + BAR_H + 22}, ${to} ${BAR_Y + BAR_H + 2}`} fill="none" stroke="#9a5400" strokeWidth="1.5" strokeDasharray="4 3" />;
          })}

        <text x={X0} y={176} fontSize="10.5" fill="#7a6d57">
          line pointers grow this way →
        </text>
        <text x={X1} y={176} fontSize="10.5" fill="#7a6d57" textAnchor="end">
          ← rows grow this way
        </text>
      </svg>

      <div className="chart-readout">
        {selected ? (
          <>
            Line pointer <strong>{selected.lp}</strong>:{" "}
            {selected.flags === 0 && "unused, ready for the next row."}
            {selected.flags === 2 && `a redirect to line pointer ${selected.off}, so an old index entry still finds the row.`}
            {selected.flags === 1 && (
              <>
                row at offset <strong>{selected.off}</strong>, <strong>{selected.len}</strong> bytes, made by transaction{" "}
                <strong>{selected.xmin}</strong>
                {selected.xmax !== "0" ? `, ended by transaction ${selected.xmax}.` : ", still current."}
              </>
            )}
          </>
        ) : (
          "Click a line pointer or a row to read it."
        )}
      </div>

      <div className="dt-tables">
        <div className="dt-table">
          <div className="dt-name">heap_page_items()</div>
          <ResultTable
            cols={["lp", "lp_off", "lp_len", "t_xmin", "t_xmax", "t_ctid"]}
            rows={step.items.map((i) => [i.lp, i.off, i.len, i.xmin, i.xmax, i.ctid])}
          />
        </div>
        <div className="dt-table">
          <div className="dt-name">SELECT ctid, * FROM t</div>
          <ResultTable cols={["ctid", "id", "name"]} rows={step.rows} />
        </div>
      </div>
      <div className="chart-readout">
        <span className="chart-source">✅ read from a real page on {data.engine}</span>
      </div>
    </div>
  );
}
