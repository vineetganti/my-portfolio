"use client";

import { useState } from "react";

/** How a row changed in this step. Shown as a tinted row plus a word, never colour alone. */
export type RowMark = "keep" | "new" | "drop" | "upd" | "hit" | "bad" | "";

export interface TraceTable {
  name: string;
  columns: string[];
  rows: (string | number | boolean | null)[][];
  /** One mark per row, or empty for an unmarked table. */
  marks?: RowMark[];
  /** An error the engine raised instead of rows (for constraint demos). */
  error?: string;
}

export interface TraceStep {
  label: string;
  caption: string;
  tables: TraceTable[];
}

export interface Trace {
  alt: string;
  steps: TraceStep[];
}

const MARK_TEXT: Record<Exclude<RowMark, "">, string> = {
  keep: "kept",
  new: "inserted",
  drop: "removed",
  upd: "changed",
  hit: "look here",
  bad: "wrong",
};

function Cell({ value }: { value: string | number | boolean | null }) {
  if (value === null) return <span className="dt-null">NULL</span>;
  if (typeof value === "boolean") return <>{value ? "TRUE" : "FALSE"}</>;
  return <>{String(value)}</>;
}

/**
 * Steps through a SQL answer on its sample data: each step shows the tables at that point, with
 * changed rows tinted and labelled. The data comes from real DuckDB runs (scripts/sql-bank).
 */
export default function DataTraceView({ trace }: { trace: Trace }) {
  const [step, setStep] = useState(0);
  const current = trace.steps[step];
  const used = new Set(trace.steps.flatMap((s) => s.tables.flatMap((t) => t.marks ?? [])).filter(Boolean));

  return (
    <div className="diagram diagram-live data-trace" role="group" aria-label={trace.alt}>
      {trace.steps.length > 1 && (
        <div className="dt-steps" role="tablist" aria-label="Steps of the query">
          {trace.steps.map((s, i) => (
            <button
              key={s.label}
              type="button"
              role="tab"
              aria-selected={i === step}
              className="dt-step"
              onClick={() => setStep(i)}
            >
              <span className="dt-step-n">{i + 1}</span>
              {s.label}
            </button>
          ))}
        </div>
      )}
      <div className="dt-caption">{current.caption}</div>
      <div className="dt-tables">
        {current.tables.map((t) => (
          <div key={t.name} className="dt-table">
            <div className="dt-name">{t.name}</div>
            {t.error ? (
              <div className="dt-error">{t.error}</div>
            ) : (
              <div className="dt-scroll">
                <table>
                  <thead>
                    <tr>
                      {t.marks?.some(Boolean) && <th aria-label="Change" />}
                      {t.columns.map((c) => (
                        <th key={c}>{c}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {t.rows.length === 0 && (
                      <tr>
                        <td className="dt-empty" colSpan={t.columns.length + 1}>
                          (no rows)
                        </td>
                      </tr>
                    )}
                    {t.rows.map((r, i) => {
                      const mark = t.marks?.[i] ?? "";
                      return (
                        <tr key={i} className={mark ? `dt-${mark}` : undefined}>
                          {t.marks?.some(Boolean) && (
                            <td className="dt-mark">{mark ? MARK_TEXT[mark] : ""}</td>
                          )}
                          {r.map((v, j) => (
                            <td
                              key={j}
                              className={
                                typeof v === "number" || (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v))
                                  ? "dt-num"
                                  : undefined
                              }
                            >
                              <Cell value={v} />
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ))}
      </div>
      {trace.steps.length > 1 && (
        <div className="dt-nav">
          <button type="button" className="chart-button" disabled={step === 0} onClick={() => setStep(step - 1)}>
            ← Back
          </button>
          <span className="dt-count">
            Step {step + 1} of {trace.steps.length}
          </span>
          <button
            type="button"
            className="chart-button"
            disabled={step === trace.steps.length - 1}
            onClick={() => setStep(step + 1)}
          >
            Next →
          </button>
        </div>
      )}
      {used.size > 0 && (
        <div className="dt-legend" aria-hidden>
          {[...used].map((m) => (
            <span key={m} className={`dt-chip dt-${m}`}>
              {MARK_TEXT[m as Exclude<RowMark, "">]}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
