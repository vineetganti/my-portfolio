"use client";

import { useState } from "react";
import { ResultTable } from "@/components/db/ResultTable";
import type { Cell } from "@/components/db/types";

export interface HotData {
  engine: string;
  steps: { label: string; caption: string; heap: Cell[][]; index: Cell[][] }[];
}

/** One row and its primary key entry, read from real pages after each step. */
export default function HotViewClient({ data }: { data: HotData }) {
  const [i, setI] = useState(0);
  const step = data.steps[i];
  return (
    <div
      className="diagram diagram-live data-trace hot-view"
      role="group"
      aria-label="One row and its index entry, read from real pages. A heap-only update adds a row version in the same page and leaves the index untouched. Updating an indexed column adds a new entry to every index. Vacuum removes the old versions."
    >
      <div className="dt-steps" role="tablist" aria-label="Steps">
        {data.steps.map((s, n) => (
          <button key={s.label} type="button" role="tab" aria-selected={n === i} className="dt-step" onClick={() => setI(n)}>
            <span className="dt-step-n">{n + 1}</span>
            {s.label}
          </button>
        ))}
      </div>
      <div className="dt-caption">{step.caption}</div>
      <div className="dt-tables">
        <div className="dt-table">
          <div className="dt-name">heap page 0</div>
          <ResultTable cols={["lp", "offset", "flags", "xmin", "xmax", "ctid", "hot updated", "heap only"]} rows={step.heap} />
        </div>
        <div className="dt-table">
          <div className="dt-name">primary key entries</div>
          <ResultTable cols={["entry", "points at"]} rows={step.index} />
        </div>
      </div>
      <div className="chart-readout">
        <span className="chart-source">✅ read from real pages on {data.engine}</span>
      </div>
    </div>
  );
}
