"use client";

import { useState } from "react";

interface Message {
  dir: "C" | "S";
  name: string;
  len: number;
  detail: string;
}

export interface WireData {
  engine: string;
  plain: { messages: Message[]; secretVisible: boolean };
  tls: { messages: Message[]; secretVisible: boolean };
}

/** A real capture: every message that crossed a logging proxy between a client and Postgres. */
export default function WireTraceView({ data }: { data: WireData }) {
  const [tab, setTab] = useState<"plain" | "tls">("plain");
  const { messages, secretVisible } = data[tab];
  return (
    <div
      className="diagram diagram-live data-trace wire-trace"
      role="group"
      aria-label="A real capture of a Postgres conversation. Without TLS, the startup message, authentication exchange, query text and result are all readable on the wire. With TLS, the client asks to upgrade, and everything after the handshake is opaque."
    >
      <div className="dt-steps" role="tablist" aria-label="Connection type">
        {(["plain", "tls"] as const).map((t) => (
          <button key={t} type="button" role="tab" aria-selected={t === tab} className="dt-step" onClick={() => setTab(t)}>
            {t === "plain" ? "No TLS" : "With TLS"}
          </button>
        ))}
      </div>
      <div className="wire-heads" aria-hidden="true">
        <span>client</span>
        <span>server</span>
      </div>
      <div className="wire-list">
        {messages.map((m, i) => (
          <div key={i} className={m.dir === "C" ? "wire-msg wire-c" : "wire-msg wire-s"}>
            <span className="wire-arrow" aria-hidden="true">
              {m.dir === "C" ? "→" : "←"}
            </span>
            <span className="wire-name">{m.name}</span>
            <span className="wire-len">{m.len} B</span>
            {m.detail && <code className="wire-detail">{m.detail}</code>}
          </div>
        ))}
      </div>
      <div className="chart-readout">
        The query was <code>SELECT &apos;my secret value&apos;</code>. Searching every captured byte for that text:{" "}
        <strong>{secretVisible ? "found, in plain sight" : "not found"}</strong>.{" "}
        <span className="chart-source">✅ captured from {data.engine}</span>
      </div>
    </div>
  );
}
