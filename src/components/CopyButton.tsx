"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

export default function CopyButton() {
  const [copied, setCopied] = useState(false);

  async function copy(e: React.MouseEvent<HTMLButtonElement>) {
    const pre = e.currentTarget.closest(".code-block")?.querySelector("pre");
    if (!pre) return;
    try {
      await navigator.clipboard.writeText(pre.textContent ?? "");
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard access can be blocked; nothing useful to show.
    }
  }

  return (
    <button type="button" onClick={copy} className="copy-btn" aria-live="polite">
      {copied ? <Check size={13} /> : <Copy size={13} />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}
