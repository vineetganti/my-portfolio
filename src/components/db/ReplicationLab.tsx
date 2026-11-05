"use client";

import { useEffect, useRef, useState } from "react";
import { Slider } from "@/components/charts/ChartFrame";

type Mode = "async" | "sync";

interface Event {
  at: number;
  text: string;
  tone?: "bad" | "good";
}

/**
 * A primary and a replica you can drive. Writes really travel on timers: with async the client gets
 * its reply at once, and with sync it waits for the replica, or forever if the link is down.
 */
export default function ReplicationLab() {
  const [mode, setMode] = useState<Mode>("async");
  const [lag, setLag] = useState(1500);
  const [linkUp, setLinkUp] = useState(true);
  const [primary, setPrimary] = useState(1);
  const [replica, setReplica] = useState(1);
  const [waiting, setWaiting] = useState(false);
  const [inFlight, setInFlight] = useState(0);
  const [log, setLog] = useState<Event[]>([]);

  // Values the timers need at the moment they fire, not when they were set.
  const linkRef = useRef(linkUp);
  const backlog = useRef<{ value: number; ack: boolean }[]>([]);
  const started = useRef(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    started.current = Date.now();
    const list = timers.current;
    return () => list.forEach(clearTimeout);
  }, []);

  const say = (text: string, tone?: Event["tone"]) => {
    const at = Date.now() - started.current;
    setLog((l) => [{ at, text, tone }, ...l].slice(0, 7));
  };

  const ship = (value: number, ack: boolean) => {
    setInFlight((n) => n + 1);
    const t = setTimeout(() => {
      setInFlight((n) => n - 1);
      if (!linkRef.current) {
        backlog.current.push({ value, ack });
        return;
      }
      setReplica((r) => Math.max(r, value));
      say(`Replica applied value ${value}.`);
      if (ack) {
        setWaiting(false);
        say(`Client got its reply for value ${value}.`, "good");
      }
    }, lag);
    timers.current.push(t);
  };

  const write = () => {
    const value = primary + 1;
    setPrimary(value);
    if (mode === "async") {
      say(`Wrote ${value}. Reply sent at once, replica not yet told.`);
      ship(value, false);
    } else {
      setWaiting(true);
      say(`Wrote ${value} on the primary. The client waits for the replica…`);
      ship(value, true);
    }
  };

  const read = (where: "primary" | "replica") => {
    const value = where === "primary" ? primary : replica;
    const stale = value !== primary;
    say(`Read from the ${where}: ${value}${stale ? `, but the latest is ${primary}` : ""}.`, stale ? "bad" : undefined);
  };

  const toggleLink = () => {
    const next = !linkUp;
    setLinkUp(next);
    linkRef.current = next;
    say(next ? "Network restored. The replica catches up." : "Network cut between primary and replica.", next ? undefined : "bad");
    if (next) {
      const pending = backlog.current;
      backlog.current = [];
      pending.forEach((p) => ship(p.value, p.ack));
    }
  };

  const behind = primary - replica;

  return (
    <div
      className="diagram diagram-live data-trace repl-lab"
      role="group"
      aria-label="A primary and a replica you can drive. With asynchronous replication writes return at once, and a read from the replica can be stale until the change arrives. With synchronous replication the client waits for the replica, and if the network is cut the write hangs."
    >
      <div className="dt-steps" role="tablist" aria-label="Replication mode">
        {(["async", "sync"] as const).map((m) => (
          <button key={m} type="button" role="tab" aria-selected={m === mode} className="dt-step" onClick={() => setMode(m)}>
            {m === "async" ? "Asynchronous" : "Synchronous"}
          </button>
        ))}
      </div>
      <div className="repl-stage">
        <div className="repl-node">
          <span className="repl-name">Primary</span>
          <span className="repl-value">{primary}</span>
        </div>
        <div className={linkUp ? "repl-link" : "repl-link repl-cut"}>
          <span className="repl-wire" />
          {inFlight > 0 && <span className="repl-packet" style={{ animationDuration: `${lag}ms` }} />}
          <span className="repl-link-label">{linkUp ? (inFlight > 0 ? `${inFlight} in flight` : "WAL stream") : "network cut"}</span>
        </div>
        <div className={behind > 0 ? "repl-node repl-behind" : "repl-node"}>
          <span className="repl-name">Replica</span>
          <span className="repl-value">{replica}</span>
          <span className="repl-note">{behind > 0 ? `${behind} behind` : "in sync"}</span>
        </div>
      </div>
      <div className="tree-actions">
        <button type="button" className="chart-button" disabled={waiting} onClick={write}>
          {waiting ? "Waiting for the replica…" : "Write a new value"}
        </button>
        <button type="button" className="chart-button" onClick={() => read("replica")}>
          Read from the replica
        </button>
        <button type="button" className="chart-button" onClick={() => read("primary")}>
          Read from the primary
        </button>
        <button type="button" className="chart-button" onClick={toggleLink}>
          {linkUp ? "Cut the network" : "Restore the network"}
        </button>
      </div>
      <div className="chart-controls">
        <Slider label="Replication delay" value={lag} min={100} max={4000} step={100} display={`${lag} ms`} onChange={setLag} />
      </div>
      <div className="repl-log" aria-live="polite">
        {log.length === 0 && <div className="repl-line">Write a value, then read it back from the replica straight away.</div>}
        {log.map((e, i) => (
          <div key={log.length - i + e.at} className={e.tone ? `repl-line repl-${e.tone}` : "repl-line"}>
            <span className="repl-time">{(e.at / 1000).toFixed(1)}s</span> {e.text}
          </div>
        ))}
      </div>
    </div>
  );
}
