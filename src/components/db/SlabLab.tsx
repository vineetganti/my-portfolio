"use client";

import { useMemo, useState } from "react";
import { Slider } from "@/components/charts/ChartFrame";

const PAGE = 1024 * 1024;

/** The same class sizes Memcached starts from: each chunk is `factor` times the last, 8-byte aligned. */
function classes(factor: number) {
  const out: number[] = [];
  let size = 96;
  while (size <= PAGE / 2) {
    out.push(size);
    size = Math.ceil((size * factor) / 8) * 8;
  }
  out.push(PAGE);
  return out;
}

/**
 * Memcached's slab allocator: an item goes in the smallest chunk that fits, and the rest of that
 * chunk is wasted. Drag the item size and growth factor to see the trade-off.
 */
export default function SlabLab() {
  const [size, setSize] = useState(300);
  const [factor, setFactor] = useState(1.25);
  const sizes = useMemo(() => classes(factor), [factor]);
  const index = sizes.findIndex((s) => s >= size);
  const chunk = sizes[index];
  const waste = chunk - size;
  const near = sizes.slice(Math.max(0, index - 3), index + 4);

  return (
    <div
      className="diagram diagram-live data-trace slab-lab"
      role="group"
      aria-label="Memcached's slab allocator. Memory is split into classes of fixed-size chunks, each a factor larger than the last. An item uses the smallest chunk that fits, and the unused part of the chunk is wasted. A smaller growth factor wastes less but makes more classes."
    >
      <div className="slab-row">
        {near.map((s) => (
          <div key={s} className={s === chunk ? "slab-class slab-on" : "slab-class"}>
            <span className="slab-size">{s.toLocaleString("en-US")} B</span>
            <span className="slab-count">{Math.floor(PAGE / s).toLocaleString("en-US")} per page</span>
          </div>
        ))}
      </div>
      <div className="slab-bar" aria-hidden="true">
        <span className="slab-used" style={{ width: `${(size / chunk) * 100}%` }} />
      </div>
      <div className="chart-readout">
        A <strong>{size.toLocaleString("en-US")}-byte</strong> item goes in class {index + 1}, a <strong>{chunk.toLocaleString("en-US")}-byte</strong> chunk, wasting{" "}
        <strong>
          {waste.toLocaleString("en-US")} bytes ({Math.round((waste / chunk) * 100)}%)
        </strong>
        . With this factor there are {sizes.length} classes.
      </div>
      <div className="chart-controls">
        <Slider label="Item size" value={size} min={50} max={20000} step={50} display={`${size} B`} onChange={setSize} />
        <Slider label="Growth factor" value={factor} min={1.05} max={2} step={0.05} display={factor.toFixed(2)} onChange={setFactor} />
      </div>
    </div>
  );
}
