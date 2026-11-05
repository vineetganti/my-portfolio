"use client";

import { useMemo, useState } from "react";
import { SANS } from "@/components/charts/util";
import { Slider } from "@/components/charts/ChartFrame";

/** FNV-1a, spread with a final mix: a real hash, so a key always lands in the same place. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  return h >>> 0;
}

const SPACE = 2 ** 32;
const KEYS = Array.from({ length: 120 }, (_, i) => `key-${i}`);
const NAMES = ["A", "B", "C", "D", "E", "F", "G"];

type Mode = "ring" | "modulo";

function ringOwners(servers: string[], vnodes: number) {
  const points = servers
    .flatMap((s) => Array.from({ length: vnodes }, (_, v) => ({ at: hash(`${s}#${v}`), server: s })))
    .sort((a, b) => a.at - b.at);
  return { points, owner: (k: string) => (points.find((p) => p.at >= hash(k)) ?? points[0]).server };
}

function owners(mode: Mode, servers: string[], vnodes: number): Map<string, string> {
  const map = new Map<string, string>();
  if (mode === "modulo") {
    for (const k of KEYS) map.set(k, servers[hash(k) % servers.length]);
    return map;
  }
  const { owner } = ringOwners(servers, vnodes);
  for (const k of KEYS) map.set(k, owner(k));
  return map;
}

const W = 360;
const C = W / 2;
const R = 132;
/** Math.cos and Math.sin can differ in their last digits between server and browser, which breaks hydration. */
const px = (v: number) => Math.round(v * 100) / 100;
const polar = (at: number, r: number): [number, number] => {
  const a = (at / SPACE) * Math.PI * 2 - Math.PI / 2;
  return [px(C + Math.cos(a) * r), px(C + Math.sin(a) * r)];
};

/**
 * Real consistent hashing beside plain modulo. Add or remove a server and count the keys that have
 * to move. The positions come from a real hash of the names, and nothing here is scripted.
 */
export default function HashRing() {
  const [mode, setMode] = useState<Mode>("ring");
  const [count, setCount] = useState(3);
  const [before, setBefore] = useState(3);
  const [vnodes, setVnodes] = useState(1);

  const servers = NAMES.slice(0, count);
  const now = useMemo(() => owners(mode, NAMES.slice(0, count), vnodes), [mode, count, vnodes]);
  const old = useMemo(() => owners(mode, NAMES.slice(0, before), vnodes), [mode, before, vnodes]);
  const ring = ringOwners(servers, vnodes);

  const moved = KEYS.filter((k) => now.get(k) !== old.get(k));
  const load = servers.map((s) => ({ s, n: KEYS.filter((k) => now.get(k) === s).length }));
  const most = Math.max(...load.map((l) => l.n), 1);

  const change = (n: number) => {
    setBefore(count);
    setCount(n);
  };

  return (
    <div
      className="diagram diagram-live data-trace ring-lab"
      role="group"
      aria-label="A working hash ring. Servers and 120 keys are placed on a circle by a real hash. Each key belongs to the next server clockwise. Adding a server moves only the keys in its arc, while plain modulo moves most of them. Virtual nodes even out the load."
    >
      <div className="dt-steps" role="tablist" aria-label="Placement">
        {(["ring", "modulo"] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={m === mode}
            className="dt-step"
            onClick={() => {
              setMode(m);
              setBefore(count);
            }}
          >
            {m === "ring" ? "Hash ring" : "hash % N"}
          </button>
        ))}
      </div>
      <div className="ring-body">
        <svg viewBox={`0 0 ${W} ${W}`} width={W} height={W} fontFamily={SANS} aria-hidden="true" focusable="false">
          <rect width={W} height={W} fill="#fffdf8" />
          <circle cx={C} cy={C} r={R} fill="none" stroke="#dccfb1" strokeWidth="2" />
          {KEYS.map((k) => {
            const [x, y] = polar(hash(k), R - 12);
            const hit = moved.includes(k);
            return <circle key={k} cx={x} cy={y} r={hit ? 4.2 : 2.6} fill={hit ? "#b0273f" : "#7a6d57"} />;
          })}
          {mode === "ring" &&
            ring.points.map((p, i) => {
              const [x, y] = polar(p.at, R + 2);
              const [tx, ty] = polar(p.at, R + 18);
              return (
                <g key={i}>
                  <circle cx={x} cy={y} r={vnodes > 3 ? 4 : 7} fill="#fde3ad" stroke="#9a5400" strokeWidth="1.5" />
                  <text x={tx} y={ty + 4} fontSize={vnodes > 3 ? 9 : 12} fontWeight="700" fill="#2f281e" textAnchor="middle">
                    {p.server}
                  </text>
                </g>
              );
            })}
          {mode === "modulo" && (
            <text x={C} y={C + 5} fontSize="14" fontWeight="700" fill="#2f281e" textAnchor="middle">
              server = hash(key) % {count}
            </text>
          )}
        </svg>
        <div className="ring-side">
          <div className="ring-big">
            <strong>{moved.length}</strong> of {KEYS.length} keys moved
          </div>
          <div className="ring-small">
            {before === count ? "Add or remove a server to see what moves." : `Going from ${before} to ${count} servers. Red dots had to move.`}
          </div>
          {load.map((l) => (
            <div key={l.s} className="ring-load">
              <span>Server {l.s}</span>
              <span className="ring-track">
                <span className="ring-fill" style={{ width: `${(l.n / most) * 100}%` }} />
              </span>
              <span className="dt-num">{l.n}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="tree-actions">
        <button type="button" className="chart-button" disabled={count >= NAMES.length} onClick={() => change(count + 1)}>
          Add a server
        </button>
        <button type="button" className="chart-button" disabled={count <= 2} onClick={() => change(count - 1)}>
          Remove a server
        </button>
      </div>
      {mode === "ring" && (
        <div className="chart-controls">
          <Slider
            label="Points per server"
            value={vnodes}
            min={1}
            max={32}
            step={1}
            display={String(vnodes)}
            onChange={(v) => {
              setVnodes(v);
              setBefore(count);
            }}
          />
        </div>
      )}
    </div>
  );
}
