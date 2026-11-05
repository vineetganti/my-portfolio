"use client";

import { useState } from "react";
import { Lsm, type Entry } from "@/components/db/lsm";

function Chip({ e }: { e: Entry }) {
  return <span className={e.value === null ? "lsm-chip lsm-tomb" : "lsm-chip"}>{e.value === null ? `${e.key}✕` : e.key}</span>;
}

/**
 * Drives the real tree in lsm.ts. Keys are written, flushed, merged and deleted by that code, so
 * what appears at each level and the amplification figures are worked out, not scripted.
 */
export default function LsmLab() {
  const [db, setDb] = useState(() => new Lsm());
  const [tick, setTick] = useState(0);
  const [key, setKey] = useState("7");
  const [message, setMessage] = useState("Write some keys. A full memtable becomes a sorted file, and files merge down the levels.");

  const act = (text: string, run: () => void) => {
    run();
    setMessage(text);
    setTick(tick + 1);
  };

  const k = Number(key);
  const stats = db.stats();

  return (
    <div
      className="diagram diagram-live data-trace lsm-lab"
      role="group"
      aria-label="A working log-structured merge tree. Writes go to a log and a memtable. A full memtable is flushed to a sorted file at level 0, and compaction merges files down the levels, keeping the newest version of each key and dropping deleted keys at the bottom. Reads check the memtable and then files, newest first."
    >
      <div className="lsm-grid" key={tick}>
        <div className="lsm-tier lsm-mem">
          <div className="lsm-label">Memtable (RAM, sorted)</div>
          <div className="lsm-row">
            {[...db.memtable.values()]
              .sort((a, b) => a.key - b.key)
              .map((e) => (
                <Chip key={e.key} e={e} />
              ))}
            {db.memtable.size === 0 && <span className="lsm-empty">empty</span>}
          </div>
        </div>
        <div className="lsm-tier lsm-log">
          <div className="lsm-label">Write-ahead log (disk, append only)</div>
          <div className="lsm-row">
            {db.wal.map((e) => (
              <Chip key={e.seq} e={e} />
            ))}
            {db.wal.length === 0 && <span className="lsm-empty">empty</span>}
          </div>
        </div>
        {db.levels.map((files, level) => (
          <div key={level} className="lsm-tier">
            <div className="lsm-label">
              Level {level} {level === 0 ? "(newest first, files can overlap)" : "(one sorted run)"}
            </div>
            <div className="lsm-files">
              {files.map((f) => (
                <div key={f.id} className="lsm-file">
                  <span className="lsm-file-name">file {f.id}</span>
                  <div className="lsm-row">
                    {f.entries.map((e) => (
                      <Chip key={e.seq} e={e} />
                    ))}
                  </div>
                </div>
              ))}
              {files.length === 0 && <span className="lsm-empty">no files</span>}
            </div>
          </div>
        ))}
      </div>
      <div className="chart-readout" aria-live="polite">
        {message}
      </div>
      <div className="tree-stats">
        <span>
          entries stored <strong>{stats.stored}</strong> for <strong>{stats.live}</strong> live keys
        </span>
        <span>
          files <strong>{stats.files}</strong>
        </span>
        <span>
          write amplification <strong>{stats.writeAmp.toFixed(1)}×</strong>
        </span>
        <span>
          compactions <strong>{db.compactions}</strong>
        </span>
      </div>
      <div className="tree-actions">
        <label className="tree-field">
          Key
          <input value={key} inputMode="numeric" onChange={(e) => setKey(e.target.value)} />
        </label>
        <button type="button" className="chart-button" onClick={() => act(`Wrote key ${k}: one log append and one memtable insert. Nothing on disk was rewritten.`, () => db.put(k, `v${db.seq}`))}>
          Put
        </button>
        <button type="button" className="chart-button" onClick={() => act(`Deleted key ${k}: that's a new entry, a tombstone. The old value stays until compaction meets it.`, () => db.put(k, null))}>
          Delete
        </button>
        <button
          type="button"
          className="chart-button"
          onClick={() => {
            const r = db.get(k);
            setMessage(`Get ${k}: ${r.found ? "found" : r.value === null && r.probes.length > 1 ? "not found" : "not found"} after checking ${r.probes.join(", then ")}.`);
          }}
        >
          Get
        </button>
      </div>
      <div className="tree-actions">
        <button
          type="button"
          className="chart-button"
          onClick={() =>
            act("Wrote 10 random keys. Repeats simply become newer entries.", () => {
              for (let i = 0; i < 10; i++) db.put(Math.floor(Math.random() * 30), "x");
            })
          }
        >
          Write 10 random keys
        </button>
        <button type="button" className="chart-button" onClick={() => act("Flushed the memtable to a new file at level 0, and the log can start over.", () => db.flush())}>
          Flush
        </button>
        <button type="button" className="chart-button" onClick={() => act("Compacted everything down. Old versions and tombstones are gone, so space came back, at the cost of rewriting data.", () => db.compactAll())}>
          Compact all
        </button>
        <button
          type="button"
          className="chart-button"
          onClick={() => {
            const n = db.crash();
            setMessage(`Crash! RAM was lost, and ${n} entr${n === 1 ? "y was" : "ies were"} replayed from the log. Nothing committed is gone.`);
            setTick(tick + 1);
          }}
        >
          Crash and replay
        </button>
        <button
          type="button"
          className="chart-button"
          onClick={() => {
            setDb(new Lsm());
            setMessage("Reset.");
          }}
        >
          Reset
        </button>
      </div>
    </div>
  );
}
