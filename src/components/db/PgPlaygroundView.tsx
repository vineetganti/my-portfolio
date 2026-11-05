"use client";

import { useId, useRef, useState } from "react";
import { Database, Play, RotateCcw } from "lucide-react";
import type { Cell, Playground } from "@/components/db/types";
import { ResultTable } from "@/components/db/ResultTable";
import { postgres, show, type Pg, type PgResult } from "@/components/db/pglite";
import { splitSql } from "@/components/db/splitSql";

interface Output {
  cols: string[];
  rows: Cell[][];
  plan: string | null;
}

type Status =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "running" }
  | { kind: "done"; ms: number; statements: number; outputs: Output[]; open: boolean; error?: string }
  | { kind: "error"; message: string };

const MAX_ROWS = 100;

function toOutput(r: PgResult): Output {
  const cols = r.fields.map((f) => f.name);
  const rows = r.rows.map((row) => row.map(show));
  // EXPLAIN comes back as one text column: show it as a plan, not a table.
  const plan = cols.length === 1 && cols[0] === "QUERY PLAN" ? rows.map((row) => String(row[0])).join("\n") : null;
  return { cols, rows, plan };
}

/** Runs statements in order, stopping at the first error, and keeps what ran before it. */
async function runAll(db: Pg, statements: string[]) {
  const results: PgResult[] = [];
  let error: string | undefined;
  const started = performance.now();
  for (const statement of statements) {
    try {
      results.push(...(await db.exec(statement, { rowMode: "array" })));
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      break;
    }
  }
  return { results, error, ms: performance.now() - started };
}

/**
 * An editable SQL box running on real PostgreSQL in the reader's browser. Each box works in its
 * own schema, so boxes on a page can't disturb each other, and Reset puts its tables back.
 */
export default function PgPlaygroundView({ id, box }: { id: string; box: Playground }) {
  const [sql, setSql] = useState(box.query);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const ready = useRef(false);
  const inputId = useId();
  const schema = `lab_${id.replace(/\W/g, "_")}`;

  async function prepare(db: Pg) {
    await db.exec(`RESET ROLE; DROP SCHEMA IF EXISTS ${schema} CASCADE; CREATE SCHEMA ${schema}; SET search_path TO ${schema}, public;`);
    for (const statement of splitSql(box.setup ?? "")) await db.exec(statement);
    ready.current = true;
  }

  async function run(text: string) {
    setStatus({ kind: ready.current ? "running" : "loading" });
    try {
      const db = await postgres();
      if (!ready.current) await prepare(db);
      await db.exec(`SET search_path TO ${schema}, public`);
      const statements = splitSql(text);
      const { results, error, ms } = await runAll(db, statements);
      const outputs = results.filter((r) => r.fields.length > 0).map(toOutput);
      setStatus({ kind: "done", ms, statements: statements.length, outputs, open: db.isInTransaction?.() ?? false, error });
    } catch (e) {
      setStatus({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }

  async function reset() {
    setSql(box.query);
    setStatus({ kind: "loading" });
    try {
      const db = await postgres();
      await db.exec("ROLLBACK");
      await prepare(db);
      setStatus({ kind: "idle" });
    } catch (e) {
      setStatus({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }

  const busy = status.kind === "loading" || status.kind === "running";

  return (
    <div className="diagram diagram-live data-trace pg-box" role="group" aria-label={`Live PostgreSQL box: ${box.title}`}>
      <div className="pg-head">
        <Database size={15} aria-hidden="true" />
        <span className="pg-title">{box.title}</span>
        <span className="pg-tag">runs in your browser</span>
      </div>
      {box.hint && <div className="pg-hint">{box.hint}</div>}
      {box.presets && box.presets.length > 0 && (
        <div className="pg-presets">
          {box.presets.map((p) => (
            <button
              key={p.label}
              type="button"
              className="pg-preset"
              disabled={busy}
              onClick={() => {
                setSql(p.sql);
                void run(p.sql);
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}
      <label className="pg-label" htmlFor={inputId}>
        SQL
      </label>
      <textarea
        id={inputId}
        className="pg-sql"
        value={sql}
        rows={Math.min(14, Math.max(3, sql.split("\n").length))}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        onChange={(e) => setSql(e.target.value)}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && !busy) void run(sql);
        }}
      />
      <div className="pg-actions">
        <button type="button" className="chart-button pg-run" disabled={busy} onClick={() => void run(sql)}>
          <Play size={13} aria-hidden="true" />
          Run this
        </button>
        <button type="button" className="chart-button" disabled={busy} onClick={() => void reset()}>
          <RotateCcw size={13} aria-hidden="true" />
          Reset
        </button>
        <span className="pg-status" aria-live="polite">
          {status.kind === "idle" && "Real PostgreSQL loads when you press Run: about 6 MB, once per visit."}
          {status.kind === "loading" && "Starting PostgreSQL in your browser…"}
          {status.kind === "running" && "Running…"}
          {status.kind === "done" &&
            `${status.statements} statement${status.statements === 1 ? "" : "s"} in ${status.ms.toFixed(1)} ms${status.open ? " · transaction still open" : ""}`}
        </span>
      </div>
      {status.kind === "error" && <div className="dt-error">ERROR: {status.message}</div>}
      {status.kind === "done" &&
        status.outputs.map((o, i) =>
          o.plan !== null ? (
            <pre key={i} className="pg-plan">
              {o.plan}
            </pre>
          ) : (
            <div key={i} className="pg-out">
              <ResultTable cols={o.cols} rows={o.rows} limit={MAX_ROWS} />
              {o.rows.length > MAX_ROWS && (
                <div className="pg-more">
                  Showing {MAX_ROWS} of {o.rows.length} rows.
                </div>
              )}
            </div>
          ),
        )}
      {status.kind === "done" && status.error && <div className="dt-error">ERROR: {status.error}</div>}
    </div>
  );
}
