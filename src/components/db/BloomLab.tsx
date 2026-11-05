"use client";

import { useMemo, useState } from "react";
import { Slider } from "@/components/charts/ChartFrame";

/** FNV-1a with a seed: a small real hash, so a name always lands on the same bits. */
function hash(text: string, seed: number): number {
  let h = 0x811c9dc5 ^ (seed * 0x9e3779b1);
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  return (h ^ (h >>> 13)) >>> 0;
}

const positions = (name: string, bits: number, hashes: number) => Array.from({ length: hashes }, (_, i) => hash(name, i) % bits);

const START = ["Jack", "Paul", "Tim", "Ali"];

const SYLLABLES = ["ka", "ro", "mi", "ta", "lo", "ne", "vi", "sa", "du", "pe", "zi", "ha"];
function randomName(seed: number) {
  let n = seed + 1;
  let out = "";
  while (n > 0) {
    out += SYLLABLES[n % SYLLABLES.length];
    n = Math.floor(n / SYLLABLES.length);
  }
  return out;
}

/**
 * A working Bloom filter. Adding a name sets real bits, and the false-positive rate is measured by
 * asking the filter about 2,000 names that were never added.
 */
export default function BloomLab() {
  const [bits, setBits] = useState(64);
  const [hashes, setHashes] = useState(1);
  const [names, setNames] = useState<string[]>(START);
  const [input, setInput] = useState("Sara");
  const [checked, setChecked] = useState<{ name: string; hits: number[]; maybe: boolean; real: boolean } | null>(null);

  const set = useMemo(() => {
    const on = new Set<number>();
    names.forEach((n) => positions(n, bits, hashes).forEach((p) => on.add(p)));
    return on;
  }, [names, bits, hashes]);

  const falsePositives = useMemo(() => {
    const known = new Set(names);
    let wrong = 0;
    let asked = 0;
    for (let i = 0; i < 2000; i++) {
      const name = `probe-${i}`;
      if (known.has(name)) continue;
      asked++;
      if (positions(name, bits, hashes).every((p) => set.has(p))) wrong++;
    }
    return wrong / asked;
  }, [names, bits, hashes, set]);

  const check = () => {
    const hits = positions(input, bits, hashes);
    setChecked({ name: input, hits, maybe: hits.every((p) => set.has(p)), real: names.includes(input) });
  };

  const add = () => {
    if (input && !names.includes(input)) setNames([...names, input]);
    setChecked(null);
  };

  const addMany = () => {
    setNames([...names, ...Array.from({ length: 20 }, (_, i) => randomName(names.length + i))]);
    setChecked(null);
  };

  const full = set.size / bits;
  const verdict = checked
    ? checked.maybe
      ? checked.real
        ? `Maybe: all ${checked.hits.length > 1 ? "its bits are" : "its bit is"} set, so ask the database. It's there.`
        : "Maybe, and that's a false positive: its bits were set by other names. The database check finds nothing."
      : "Definitely not there. A clear bit can't lie, so the database is never asked."
    : `${names.length} names added.`;

  return (
    <div
      className="diagram diagram-live data-trace bloom-lab"
      role="group"
      aria-label="A working Bloom filter. Add names to set bits and check names to see a definite no or a maybe. As the filter fills, the measured false-positive rate rises, until almost every answer is maybe. More bits or more hash functions change the trade-off."
    >
      <div className="bloom-bits" style={{ "--bloom-cols": bits <= 64 ? 16 : 32 } as React.CSSProperties}>
        {Array.from({ length: bits }, (_, i) => (
          <span key={i} className={`bloom-bit ${set.has(i) ? "bloom-on" : ""} ${checked?.hits.includes(i) ? "bloom-hit" : ""}`}>
            {set.has(i) ? 1 : 0}
          </span>
        ))}
      </div>
      <div className="tree-stats">
        <span>
          bits set <strong>{Math.round(full * 100)}%</strong>
        </span>
        <span>
          measured false positives <strong>{(falsePositives * 100).toFixed(1)}%</strong>
        </span>
        <span>
          memory <strong>{bits / 8} bytes</strong>
        </span>
      </div>
      <div className="chart-readout" aria-live="polite">
        {verdict}
      </div>
      <div className="tree-actions">
        <label className="tree-field">
          Name
          <input className="bloom-input" value={input} onChange={(e) => setInput(e.target.value)} />
        </label>
        <button type="button" className="chart-button" onClick={check}>
          Does it exist?
        </button>
        <button type="button" className="chart-button" onClick={add}>
          Add it
        </button>
        <button type="button" className="chart-button" onClick={addMany}>
          Add 20 more
        </button>
        <button
          type="button"
          className="chart-button"
          onClick={() => {
            setNames(START);
            setChecked(null);
          }}
        >
          Reset
        </button>
      </div>
      <div className="chart-controls">
        <Slider label="Bits in the filter" value={bits} min={32} max={512} step={32} display={String(bits)} onChange={setBits} />
        <Slider label="Hash functions" value={hashes} min={1} max={5} step={1} display={String(hashes)} onChange={setHashes} />
      </div>
    </div>
  );
}
