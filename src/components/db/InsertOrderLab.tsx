"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, RotateCcw } from "lucide-react";
import { Tree } from "@/components/db/btree";
import TreeView from "@/components/db/TreeView";

const COURSE = [10, 90, 80, 40, 5, 70, 60, 30, 50, 20, 85, 15];
const ORDERED = [...COURSE].sort((a, b) => a - b);
const STEP_MS = 900;

function build(keys: number[], upto: number) {
  const t = new Tree("bplus", 2);
  let path: number[] = [];
  let lastSplits = 0;
  keys.slice(0, upto).forEach((k) => {
    const r = t.insert(k);
    path = r.path;
    lastSplits = r.splits;
  });
  return { t, path, lastSplits };
}

function Side({ title, keys, step }: { title: string; keys: number[]; step: number }) {
  const { t, path, lastSplits } = useMemo(() => build(keys, step), [keys, step]);
  const stats = t.stats();
  return (
    <div className="order-side">
      <div className="rc-title">
        {title}
        <span className="rc-count">
          next key: <strong>{keys[step] ?? "done"}</strong>
        </span>
      </div>
      <div className="tree-stage order-stage">
        <TreeView tree={t} lit={path} version={step} />
      </div>
      <div className="tree-stats">
        <span>
          splits <strong>{t.splits}</strong>
        </span>
        <span>
          pages <strong>{stats.pages}</strong>
        </span>
        <span>
          <strong>{Math.round(stats.fill * 100)}%</strong> full
        </span>
        <span className={lastSplits ? "order-split" : undefined}>{lastSplits ? "page split!" : " "}</span>
      </div>
    </div>
  );
}

/**
 * The course's page-split demo: the same keys inserted in random and in sorted order, into pages
 * that hold two keys, on real trees (btree.ts). The counters come from the trees themselves.
 */
export default function InsertOrderLab() {
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const done = step >= COURSE.length;

  useEffect(() => {
    if (!playing) return;
    timer.current = setTimeout(() => {
      if (done) setPlaying(false);
      else setStep((s) => s + 1);
    }, STEP_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [playing, step, done]);

  return (
    <div
      className="diagram diagram-live data-trace order-lab"
      role="group"
      aria-label="The same twelve keys inserted into two B+trees with two keys per page, one in the order they arrived and one sorted. Random order splits pages in the middle of the tree and leaves them less full, while sorted order only ever grows the right edge."
    >
      <div className="rc-grid">
        <Side title="Random order" keys={COURSE} step={step} />
        <Side title="Sorted order" keys={ORDERED} step={step} />
      </div>
      <div className="dt-nav">
        <button type="button" className="chart-button" disabled={done} onClick={() => setStep(step + 1)}>
          Insert next key
        </button>
        <span className="dt-count">
          {step} of {COURSE.length} keys
        </span>
        <button
          type="button"
          className="chart-button tt-play"
          onClick={() => {
            if (done) setStep(0);
            setPlaying(!playing);
          }}
        >
          {playing ? <Pause size={13} aria-hidden="true" /> : <Play size={13} aria-hidden="true" />}
          {playing ? "Pause" : "Play"}
        </button>
        <button
          type="button"
          className="chart-button tt-play"
          onClick={() => {
            setPlaying(false);
            setStep(0);
          }}
        >
          <RotateCcw size={13} aria-hidden="true" />
          Reset
        </button>
      </div>
    </div>
  );
}
