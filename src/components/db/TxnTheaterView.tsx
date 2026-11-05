"use client";

import { useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import type { Theater, TheaterResult, TheaterStep } from "@/components/db/types";
import { ResultTable } from "@/components/db/ResultTable";

const PLAY_MS = 2600;

function Result({ r }: { r: Omit<TheaterResult, "status"> & { status: string } }) {
  if (r.status === "error") return <div className="tt-error">ERROR: {r.error}</div>;
  if (r.cols && r.rows) return <ResultTable cols={r.cols} rows={r.rows} limit={8} />;
  return r.tag ? <div className="tt-tag">{r.tag}</div> : null;
}

/** What a statement shows at the moment `now`: it may be waiting, or may have returned since. */
function Statement({ step, index, now }: { step: TheaterStep; index: number; now: number }) {
  const waiting = step.status === "blocked" && (step.resolvedAt === undefined || step.resolvedAt > now);
  const returned = step.status === "blocked" && !waiting ? step.resolved : undefined;
  const failed = step.status === "error" || returned?.status === "error";
  const state = waiting ? "tt-waiting" : failed ? "tt-failed" : "";
  return (
    <div className={`tt-card ${state} ${index === now ? "tt-now" : ""}`}>
      <code className="tt-sql">{step.sql}</code>
      {waiting && <div className="tt-wait-label">waiting for a lock…</div>}
      {returned && (
        <>
          <div className="tt-wait-label tt-done">returned at step {(step.resolvedAt ?? 0) + 1}</div>
          <Result r={returned} />
        </>
      )}
      {step.status !== "blocked" && <Result r={step} />}
    </div>
  );
}

/**
 * Replays a real multi-session run. Each column is one database connection. A statement that
 * blocked in the recording blocks here, until the step that really released it.
 */
export default function TxnTheaterView({ theater }: { theater: Theater }) {
  const [variant, setVariant] = useState(0);
  const [now, setNow] = useState(0);
  const [playing, setPlaying] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const { steps, summary } = theater.variants[variant];
  const last = steps.length - 1;
  const current = steps[now];

  useEffect(() => {
    if (!playing) return;
    if (now >= last) {
      const stop = setTimeout(() => setPlaying(false), 0);
      return () => clearTimeout(stop);
    }
    const timer = setTimeout(() => setNow((n) => n + 1), PLAY_MS);
    return () => clearTimeout(timer);
  }, [playing, now, last]);

  useEffect(() => {
    const box = scroller.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [now, variant]);

  const pick = (i: number) => {
    setVariant(i);
    setNow(0);
    setPlaying(false);
  };

  return (
    <div className="diagram diagram-live data-trace txn-theater" role="group" aria-label={theater.alt}>
      <div className="tt-head">
        <span className="tt-title">{theater.title}</span>
        <span className="tt-engine">✅ recorded on {theater.engine}</span>
      </div>
      {theater.variants.length > 1 && (
        <div className="dt-steps" role="tablist" aria-label="Variants of this run">
          {theater.variants.map((v, i) => (
            <button key={v.label} type="button" role="tab" aria-selected={i === variant} className="dt-step" onClick={() => pick(i)}>
              {v.label}
            </button>
          ))}
        </div>
      )}
      <div className="tt-stage" style={{ "--tt-lanes": theater.sessions.length } as React.CSSProperties}>
        <div className="tt-lane-heads" aria-hidden="true">
          {theater.sessions.map((s) => (
            <div key={s} className="tt-lane-head">
              Session {s}
            </div>
          ))}
        </div>
        <div className="tt-rows" ref={scroller}>
          {steps.slice(0, now + 1).map((step, i) => (
            <div key={i} className="tt-row">
              {theater.sessions.map((s) => (
                <div key={s} className={s === step.s ? "tt-cell tt-cell-on" : "tt-cell"}>
                  {s === step.s && (
                    <>
                      <span className="tt-who">
                        {i + 1} · Session {s}
                      </span>
                      <Statement step={step} index={i} now={now} />
                    </>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className="dt-caption tt-note" aria-live="polite">
        {current.note}
      </div>
      {current.table && (
        <div className="dt-table tt-table">
          <div className="dt-name">{theater.tableName}, seen from a third connection</div>
          <ResultTable cols={current.table.cols} rows={current.table.rows} />
        </div>
      )}
      <div className="dt-nav">
        <button type="button" className="chart-button" disabled={now === 0} onClick={() => setNow(now - 1)}>
          ← Back
        </button>
        <span className="dt-count">
          Step {now + 1} of {steps.length}
        </span>
        <button type="button" className="chart-button" disabled={now === last} onClick={() => setNow(now + 1)}>
          Next →
        </button>
        <button
          type="button"
          className="chart-button tt-play"
          onClick={() => {
            if (now === last) setNow(0);
            setPlaying(!playing);
          }}
        >
          {playing ? <Pause size={13} aria-hidden="true" /> : <Play size={13} aria-hidden="true" />}
          {playing ? "Pause" : now === last ? "Replay" : "Play"}
        </button>
      </div>
      {now === last && summary && <div className="chart-readout">{summary}</div>}
    </div>
  );
}
