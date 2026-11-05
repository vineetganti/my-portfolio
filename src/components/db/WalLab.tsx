"use client";

import { useState } from "react";

interface Version {
  value: number;
  txn: number;
}

interface Record {
  lsn: number;
  kind: "update" | "commit";
  txn: number;
  page?: string;
  value?: number;
}

interface State {
  disk: { [page: string]: Version[] };
  memory: { [page: string]: Version[] } | null;
  walDisk: Record[];
  walBuffer: Record[];
  committed: number[];
  checkpoint: number;
  nextLsn: number;
  txn: number | null;
  nextTxn: number;
  log: string;
}

const PAGES = ["A", "B"];

const START: State = {
  disk: { A: [{ value: 1, txn: 0 }], B: [{ value: 1, txn: 0 }] },
  memory: { A: [{ value: 1, txn: 0 }], B: [{ value: 1, txn: 0 }] },
  walDisk: [],
  walBuffer: [],
  committed: [0],
  checkpoint: 0,
  nextLsn: 1,
  txn: null,
  nextTxn: 1,
  log: "Update a page, commit, then crash at any point. Try crashing before and after COMMIT.",
};

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

const visible = (versions: Version[], committed: number[]) => [...versions].reverse().find((v) => committed.includes(v.txn))?.value;

function Page({ name, versions, committed, dirty }: { name: string; versions: Version[]; committed: number[]; dirty?: boolean }) {
  return (
    <div className={dirty ? "wal-page wal-dirty" : "wal-page"}>
      <span className="wal-page-name">page {name}</span>
      <span className="wal-page-value">{visible(versions, committed)}</span>
      <span className="wal-page-note">{versions.length > 1 ? `${versions.length} versions` : "1 version"}</span>
    </div>
  );
}

/**
 * A working model of write-ahead logging, with Postgres's rules: the log is forced at commit, pages
 * go to disk at a checkpoint, and recovery replays the log and then ignores what never committed.
 */
export default function WalLab() {
  const [s, setS] = useState<State>(START);
  const crashed = s.memory === null;

  const update = (page: string) => {
    const n = clone(s);
    if (n.txn === null) n.txn = n.nextTxn++;
    const value = (n.memory?.[page].at(-1)?.value ?? 0) + 1;
    n.memory?.[page].push({ value, txn: n.txn });
    n.walBuffer.push({ lsn: n.nextLsn++, kind: "update", txn: n.txn, page, value });
    n.log = `Transaction ${n.txn} changed page ${page} in memory, and wrote a log record to the WAL buffer. Disk hasn't changed.`;
    setS(n);
  };

  const commit = () => {
    const n = clone(s);
    if (n.txn === null) return;
    n.walBuffer.push({ lsn: n.nextLsn++, kind: "commit", txn: n.txn });
    n.walDisk.push(...n.walBuffer);
    n.walBuffer = [];
    n.committed.push(n.txn);
    n.log = `COMMIT forced the log to disk with fsync. The client gets its reply now, even though the data pages on disk are unchanged.`;
    n.txn = null;
    setS(n);
  };

  const checkpoint = () => {
    const n = clone(s);
    if (n.memory) n.disk = clone(n.memory);
    n.walDisk.push(...n.walBuffer);
    n.walBuffer = [];
    n.checkpoint = n.nextLsn - 1;
    n.log = `Checkpoint: dirty pages were written to the data files. Recovery only has to start from log position ${n.checkpoint}.`;
    setS(n);
  };

  const crash = () => {
    const n = clone(s);
    const lost = n.walBuffer.length;
    n.memory = null;
    n.walBuffer = [];
    n.txn = null;
    n.log = `Crash! Memory is gone${lost ? `, including ${lost} log record${lost === 1 ? "" : "s"} that never reached disk` : ""}. Only the data files and the WAL on disk remain.`;
    setS(n);
  };

  const recover = () => {
    const n = clone(s);
    const memory = clone(n.disk);
    const redo = n.walDisk.filter((r) => r.lsn > n.checkpoint);
    const committed = new Set(n.walDisk.filter((r) => r.kind === "commit").map((r) => r.txn));
    for (const r of redo) if (r.kind === "update" && r.page) memory[r.page].push({ value: r.value ?? 0, txn: r.txn });
    n.memory = memory;
    n.committed = [0, ...committed];
    const skipped = new Set(redo.filter((r) => r.kind === "update" && !committed.has(r.txn)).map((r) => r.txn)).size;
    n.log = `Recovery replayed ${redo.length} log record${redo.length === 1 ? "" : "s"} after the checkpoint.${skipped ? ` ${skipped} transaction${skipped === 1 ? "" : "s"} had no commit record, so ${skipped === 1 ? "its" : "their"} row versions stay invisible.` : ""} Every committed change is back.`;
    setS(n);
  };

  return (
    <div
      className="diagram diagram-live data-trace wal-lab"
      role="group"
      aria-label="A working model of write-ahead logging. Update pages in memory, commit to force the log to disk, checkpoint to write the pages, and crash at any moment. Recovery replays the log after the last checkpoint and restores every committed change."
    >
      <div className="wal-grid">
        <div className={crashed ? "wal-tier wal-gone" : "wal-tier"}>
          <div className="lsm-label">Memory (lost in a crash)</div>
          <div className="wal-pages">
            {crashed ? (
              <span className="lsm-empty">gone</span>
            ) : (
              PAGES.map((p) => <Page key={p} name={p} versions={s.memory?.[p] ?? []} committed={[...s.committed, ...(s.txn === null ? [] : [s.txn])]} dirty={(s.memory?.[p].length ?? 0) !== s.disk[p].length} />)
            )}
          </div>
          <div className="lsm-label">WAL buffer</div>
          <div className="lsm-row">
            {s.walBuffer.map((r) => (
              <span key={r.lsn} className="lsm-chip">
                {r.lsn}: {r.page ? `${r.page}=${r.value}` : "commit"}
              </span>
            ))}
            {s.walBuffer.length === 0 && <span className="lsm-empty">empty</span>}
          </div>
        </div>
        <div className="wal-tier wal-disk">
          <div className="lsm-label">Data files on disk</div>
          <div className="wal-pages">
            {PAGES.map((p) => (
              <Page key={p} name={p} versions={s.disk[p]} committed={s.committed} />
            ))}
          </div>
          <div className="lsm-label">WAL on disk (survives)</div>
          <div className="lsm-row">
            {s.walDisk.map((r) => (
              <span key={r.lsn} className={r.lsn <= s.checkpoint ? "lsm-chip wal-old" : "lsm-chip wal-new"}>
                {r.lsn}: {r.page ? `${r.page}=${r.value}` : `commit ${r.txn}`}
              </span>
            ))}
            {s.walDisk.length === 0 && <span className="lsm-empty">empty</span>}
          </div>
        </div>
      </div>
      <div className="chart-readout" aria-live="polite">
        {s.log}
      </div>
      <div className="tree-actions">
        <button type="button" className="chart-button" disabled={crashed} onClick={() => update("A")}>
          Update A
        </button>
        <button type="button" className="chart-button" disabled={crashed} onClick={() => update("B")}>
          Update B
        </button>
        <button type="button" className="chart-button" disabled={crashed || s.txn === null} onClick={commit}>
          COMMIT
        </button>
        <button type="button" className="chart-button" disabled={crashed} onClick={checkpoint}>
          Checkpoint
        </button>
        <button type="button" className="chart-button" disabled={crashed} onClick={crash}>
          Crash
        </button>
        <button type="button" className="chart-button" disabled={!crashed} onClick={recover}>
          Recover
        </button>
        <button type="button" className="chart-button" onClick={() => setS(START)}>
          Reset
        </button>
      </div>
    </div>
  );
}
