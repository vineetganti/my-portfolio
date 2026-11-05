"use client";

import { useState } from "react";
import { Slider } from "@/components/charts/ChartFrame";
import { Tree, type TreeKind } from "@/components/db/btree";
import TreeView from "@/components/db/TreeView";

function shuffled(n: number): number[] {
  const out = Array.from({ length: n }, (_, i) => (i + 1) * 5);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * A real B-tree and B+tree you can drive. Inserting, searching and range scanning all run on the
 * trees in btree.ts, so the page reads and splits it reports are counted, not scripted.
 */
export default function BPlusTreeLab() {
  const [kind, setKind] = useState<TreeKind>("bplus");
  const [max, setMax] = useState(3);
  const [tree, setTree] = useState(() => new Tree("bplus", 3));
  const [lit, setLit] = useState<number[]>([]);
  const [version, setVersion] = useState(0);
  const [message, setMessage] = useState("Insert keys, or fill the tree, then search it and scan a range.");
  const [input, setInput] = useState("42");
  const [lo, setLo] = useState("20");
  const [hi, setHi] = useState("60");

  const redraw = (pages: number[], text: string) => {
    setLit(pages);
    setMessage(text);
    setVersion((v) => v + 1);
  };

  const rebuild = (nextKind: TreeKind, nextMax: number, keys: number[]) => {
    const t = new Tree(nextKind, nextMax);
    keys.forEach((k) => t.insert(k));
    setTree(t);
    return t;
  };

  const allKeys = () => {
    const out: number[] = [];
    const walk = (n: typeof tree.root) => {
      out.push(...n.keys);
      n.children.forEach(walk);
    };
    walk(tree.root);
    return [...new Set(out)];
  };

  const insert = () => {
    const key = Number(input);
    if (!Number.isFinite(key)) return;
    const r = tree.insert(key);
    redraw(r.path, r.path.length === 0 ? `${key} is already in the tree.` : `Inserted ${key}: read ${r.path.length} page${r.path.length === 1 ? "" : "s"}, ${r.splits} split${r.splits === 1 ? "" : "s"}.`);
  };

  const search = () => {
    const key = Number(input);
    const r = tree.search(key);
    redraw(r.path, `${r.found ? "Found" : "Didn't find"} ${key}: ${r.path.length} page read${r.path.length === 1 ? "" : "s"}.`);
  };

  const range = () => {
    const r = tree.range(Number(lo), Number(hi));
    redraw(r.reads, `Range ${lo} to ${hi}: ${r.keys.length} keys, ${r.reads.length} page reads${kind === "btree" ? ", going back up to parents between children" : ", walking the leaf links"}.`);
  };

  const fill = (keys: number[], label: string) => {
    const t = rebuild(kind, max, keys);
    redraw([], `${label}: ${keys.length} keys, ${t.splits} splits, pages ${Math.round(t.stats().fill * 100)}% full.`);
  };

  const stats = tree.stats();

  return (
    <div
      className="diagram diagram-live data-trace tree-lab"
      role="group"
      aria-label="An interactive B-tree and B+tree. Insert keys and watch pages split, search a key and count the pages read, and scan a range. A B+tree walks its linked leaves, while a B-tree has to climb back through parent pages."
    >
      <div className="dt-steps" role="tablist" aria-label="Tree type">
        {(["bplus", "btree"] as const).map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={k === kind}
            className="dt-step"
            onClick={() => {
              const keys = allKeys();
              setKind(k);
              rebuild(k, max, keys);
              redraw([], k === "bplus" ? "B+tree: every key is in a leaf, and internal pages only route." : "B-tree: each key lives once, at any level, with its value.");
            }}
          >
            {k === "bplus" ? "B+Tree" : "B-Tree"}
          </button>
        ))}
      </div>
      <div className="tree-stage">
        <TreeView tree={tree} lit={lit} version={version} />
      </div>
      <div className="chart-readout" aria-live="polite">
        {message}
      </div>
      <div className="tree-stats">
        <span>
          height <strong>{stats.height}</strong>
        </span>
        <span>
          pages <strong>{stats.pages}</strong>
        </span>
        <span>
          splits so far <strong>{tree.splits}</strong>
        </span>
        <span>
          pages <strong>{Math.round(stats.fill * 100)}%</strong> full
        </span>
      </div>
      <div className="chart-controls">
        <Slider
          label="Keys per page"
          value={max}
          min={2}
          max={6}
          step={1}
          display={String(max)}
          onChange={(m) => {
            const keys = allKeys();
            setMax(m);
            rebuild(kind, m, keys);
            redraw([], `Rebuilt with ${m} keys per page. A real page holds hundreds.`);
          }}
        />
      </div>
      <div className="tree-actions">
        <label className="tree-field">
          Key
          <input value={input} inputMode="numeric" onChange={(e) => setInput(e.target.value)} />
        </label>
        <button type="button" className="chart-button" onClick={insert}>
          Insert
        </button>
        <button type="button" className="chart-button" onClick={search}>
          Search
        </button>
        <label className="tree-field">
          From
          <input value={lo} inputMode="numeric" onChange={(e) => setLo(e.target.value)} />
        </label>
        <label className="tree-field">
          to
          <input value={hi} inputMode="numeric" onChange={(e) => setHi(e.target.value)} />
        </label>
        <button type="button" className="chart-button" onClick={range}>
          Scan range
        </button>
      </div>
      <div className="tree-actions">
        <button type="button" className="chart-button" onClick={() => fill(Array.from({ length: 20 }, (_, i) => (i + 1) * 5), "Ordered keys")}>
          Fill with ordered keys
        </button>
        <button type="button" className="chart-button" onClick={() => fill(shuffled(20), "Random keys")}>
          Fill with random keys
        </button>
        <button type="button" className="chart-button" onClick={() => fill([], "Empty")}>
          Clear
        </button>
      </div>
    </div>
  );
}
