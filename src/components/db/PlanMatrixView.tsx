"use client";

import { useState } from "react";

interface Row {
  name: string;
  sql: string;
  nodes: string[];
  buffers: number;
  rows: number;
  ms: number;
  text: string;
}

export interface MatrixData {
  engine: string;
  configs: { label: string; rows: Row[] }[];
}

/**
 * Real plans for one table: pick an index layout, then a query shape to read its full plan. Every
 * number was measured by running the query on the engine named at the bottom.
 */
export default function PlanMatrixView({ data }: { data: MatrixData }) {
  const [config, setConfig] = useState(0);
  const [open, setOpen] = useState(0);
  const { rows } = data.configs[config];
  const row = rows[open];
  const most = Math.max(...rows.map((r) => r.buffers));

  return (
    <div
      className="diagram diagram-live data-trace plan-matrix"
      role="group"
      aria-label="Real query plans for a million-row table under three index layouts: separate indexes on a and b, a composite index on a and b, and a composite index plus an index on b. Each layout lists five query shapes with the plan chosen, the pages touched and the time."
    >
      <div className="dt-steps" role="tablist" aria-label="Index layouts">
        {data.configs.map((c, i) => (
          <button key={c.label} type="button" role="tab" aria-selected={i === config} className="dt-step" onClick={() => setConfig(i)}>
            {c.label}
          </button>
        ))}
      </div>
      <div className="dt-scroll">
        <table>
          <thead>
            <tr>
              <th>Query</th>
              <th>Plan</th>
              <th>Pages touched</th>
              <th>Time</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.name} className={i === open ? "dt-hit pm-row" : "pm-row"} onClick={() => setOpen(i)}>
                <td>
                  <button type="button" className="pm-pick" aria-pressed={i === open} onClick={() => setOpen(i)}>
                    {r.name}
                  </button>
                </td>
                <td className="pm-plan">{r.nodes.join(" + ")}</td>
                <td>
                  <span className="pm-bar" style={{ width: `${Math.max(2, (r.buffers / most) * 100)}%` }} aria-hidden="true" />
                  <span className="dt-num">{r.buffers.toLocaleString("en-US")}</span>
                </td>
                <td className="dt-num">{r.ms} ms</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="pm-sql">{row.sql}</div>
      <pre className="pg-plan">{row.text}</pre>
      <div className="chart-readout">
        <span className="chart-source">✅ measured on {data.engine}, warm cache, one million rows</span>
      </div>
    </div>
  );
}
