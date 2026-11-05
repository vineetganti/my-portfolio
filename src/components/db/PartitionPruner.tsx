"use client";

import { useState } from "react";
import { Slider } from "@/components/charts/ChartFrame";

const QUERIES = [
  { label: "g = 30", lo: 30, hi: 30, note: "The value sits in one range, so the planner drops every other partition before running anything." },
  { label: "g BETWEEN 30 AND 65", lo: 30, hi: 65, note: "A range can span a few partitions. Only those are read." },
  { label: "g > 90", lo: 91, hi: 99, note: "Only the top range can match." },
  { label: "id = 7", lo: null, hi: null, note: "The filter isn't on the partition key, so nothing can be ruled out. Every partition is searched, each through its own index, which can be slower than one table." },
] as const;

const ROWS = 10_000_000;

/**
 * Range partitioning on a grade from 0 to 99, with real pruning logic: a partition is scanned only
 * if its bounds overlap the condition. Upper bounds are exclusive, as they are in Postgres.
 */
export default function PartitionPruner() {
  const [parts, setParts] = useState(4);
  const [query, setQuery] = useState(0);
  const [pruning, setPruning] = useState(true);
  const q = QUERIES[query];

  const width = Math.ceil(100 / parts);
  const partitions = Array.from({ length: parts }, (_, i) => {
    const from = i * width;
    return { from, to: Math.min(100, from + width) };
  }).filter((p) => p.from < 100);

  const scanned = partitions.map((p) => !pruning || q.lo === null || (p.from <= (q.hi ?? 0) && (q.lo ?? 0) < p.to));
  const count = scanned.filter(Boolean).length;
  const rows = Math.round(partitions.reduce((n, p, i) => n + (scanned[i] ? ((p.to - p.from) / 100) * ROWS : 0), 0));

  return (
    <div
      className="diagram diagram-live data-trace part-lab"
      role="group"
      aria-label="A table partitioned by grade into equal ranges. Choose a query and see which partitions get scanned. A condition on the partition key rules out most partitions. A condition on another column, or pruning turned off, means scanning all of them."
    >
      <div className="dt-steps" role="tablist" aria-label="Queries">
        {QUERIES.map((item, i) => (
          <button key={item.label} type="button" role="tab" aria-selected={i === query} className="dt-step" onClick={() => setQuery(i)}>
            {item.label}
          </button>
        ))}
      </div>
      <div className="part-bars">
        {partitions.map((p, i) => (
          <div key={p.from} className={scanned[i] ? "part-bar part-on" : "part-bar"} style={{ flexGrow: p.to - p.from }}>
            <span className="part-name">
              {p.from} to {p.to - 1}
            </span>
            <span className="part-state">{scanned[i] ? "scanned" : "pruned"}</span>
          </div>
        ))}
      </div>
      <div className="tree-stats">
        <span>
          partitions scanned <strong>{count}</strong> of {partitions.length}
        </span>
        <span>
          rows in scope <strong>{rows.toLocaleString("en-US")}</strong> of {ROWS.toLocaleString("en-US")}
        </span>
      </div>
      <div className="chart-readout">{pruning ? q.note : "With enable_partition_pruning off, every partition is scanned whatever the query says. Partitioning then only adds work."}</div>
      <div className="chart-controls">
        <Slider label="Partitions" value={parts} min={2} max={10} step={1} display={String(partitions.length)} onChange={setParts} />
      </div>
      <div className="tree-actions">
        <label className="part-toggle">
          <input type="checkbox" checked={pruning} onChange={(e) => setPruning(e.target.checked)} /> enable_partition_pruning
        </label>
      </div>
    </div>
  );
}
