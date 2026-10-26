"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp, ListTree, X } from "lucide-react";
import type { TocHeading } from "@/lib/blog";

// How far below the top of the viewport a heading must pass to count as "current".
const ACTIVE_OFFSET = 120;

interface Entry extends TocHeading {
  /** "01", "02"… for top-level entries, empty for sub-entries */
  num: string;
}

function numberEntries(headings: TocHeading[]): Entry[] {
  let n = 0;
  return headings.map((h) => ({
    ...h,
    num: h.level === 0 ? String(++n).padStart(2, "0") : "",
  }));
}

function TocList({
  entries,
  active,
  onNavigate,
  listRef,
}: {
  entries: Entry[];
  active: number;
  onNavigate?: () => void;
  listRef?: React.Ref<HTMLOListElement>;
}) {
  return (
    <ol ref={listRef} className="list-none m-0 p-0 space-y-0.5">
      {entries.map((entry, i) => {
        const isActive = i === active;
        const isDone = i < active && entry.level === 0;
        return (
          <li key={entry.id} data-index={i}>
            <a
              href={`#${entry.id}`}
              onClick={onNavigate}
              aria-current={isActive ? "location" : undefined}
              className={`grid grid-cols-[2.1rem_1fr] gap-1 rounded-lg px-2.5 no-underline leading-snug transition-colors ${
                entry.level === 0 ? "py-2 text-[0.93rem]" : "py-1.5 text-[0.86rem]"
              } ${
                isActive
                  ? "bg-accent-tint text-ink"
                  : entry.level === 0
                    ? "text-ink-2 hover:bg-card-2 hover:text-ink"
                    : "text-ink-muted hover:bg-card-2 hover:text-ink"
              }`}
            >
              <span
                className={`font-bold tabular-nums ${
                  isActive ? "text-accent-hover" : isDone ? "text-tool" : "text-ink-muted"
                }`}
              >
                {entry.num || <span className="text-ink-light">·</span>}
              </span>
              <span>{entry.text}</span>
            </a>
          </li>
        );
      })}
    </ol>
  );
}

export default function TableOfContents({
  headings,
  title,
}: {
  headings: TocHeading[];
  title: string;
}) {
  const entries = numberEntries(headings);
  const [active, setActive] = useState(-1);
  const [progress, setProgress] = useState(0);
  const [open, setOpen] = useState(false);
  const listRef = useRef<HTMLOListElement>(null);
  const menuBtnRef = useRef<HTMLButtonElement>(null);

  // Scrollspy + reading progress, throttled to one update per frame.
  useEffect(() => {
    // Indexes stay aligned with the TOC entries, even if a heading is missing.
    const targets = headings.map((h) => document.getElementById(h.id));
    let frame = 0;

    function update() {
      frame = 0;
      const doc = document.documentElement;
      const max = doc.scrollHeight - doc.clientHeight;
      setProgress(max > 0 ? Math.min(1, doc.scrollTop / max) : 0);

      let current = -1;
      targets.forEach((el, i) => {
        if (el && el.getBoundingClientRect().top <= ACTIVE_OFFSET) current = i;
      });
      // At the very bottom, short final sections never reach the offset.
      if (max > 0 && doc.scrollTop >= max - 2) current = targets.length - 1;
      setActive(current);
    }

    function onScroll() {
      if (!frame) frame = requestAnimationFrame(update);
    }

    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [headings]);

  // Keep the active entry visible when the sidebar list is taller than the screen.
  useEffect(() => {
    const list = listRef.current;
    const scroller = list?.parentElement;
    const item = list?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    if (!scroller || !item) return;
    const top = item.offsetTop - list.offsetTop;
    if (top < scroller.scrollTop || top + item.offsetHeight > scroller.scrollTop + scroller.clientHeight) {
      scroller.scrollTop = top - scroller.clientHeight / 3;
    }
  }, [active]);

  const close = useCallback(() => {
    setOpen(false);
    menuBtnRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, close]);

  const current = active >= 0 ? entries[active] : undefined;

  return (
    <>
      {/* Reading progress */}
      <div
        aria-hidden
        className="fixed left-0 right-0 top-header z-50 h-[3px] origin-left bg-tool"
        style={{ transform: `scaleX(${progress})` }}
      />

      {/* Mobile: sticky bar showing the current section */}
      <div className="toc-mobile-bar lg:hidden sticky top-header z-40 -mx-4 sm:-mx-6 mb-6 h-12 px-4 sm:px-6 flex items-center gap-3 border-b border-border bg-cream/90 backdrop-blur-md">
        <button
          ref={menuBtnRef}
          type="button"
          onClick={() => setOpen(true)}
          aria-expanded={open}
          aria-controls="toc-drawer"
          className="inline-flex items-center gap-2 h-8 px-3 rounded-lg border border-border bg-card text-sm font-semibold text-ink"
        >
          <ListTree size={16} />
          Contents
        </button>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink-2">
          {current ? `${current.num ? current.num + "  " : ""}${current.text}` : title}
        </span>
      </div>

      {/* Mobile: slide-out drawer */}
      <div
        className={`lg:hidden fixed inset-0 z-[60] bg-[rgba(10,14,30,0.45)] transition-opacity ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={close}
        aria-hidden
      />
      <aside
        id="toc-drawer"
        aria-label="Table of contents"
        inert={!open}
        className={`lg:hidden fixed inset-y-0 left-0 z-[70] w-[min(320px,86vw)] overflow-y-auto border-r border-border bg-card px-4 pt-5 pb-10 transition-transform duration-200 ${
          open ? "translate-x-0" : "-translate-x-[102%]"
        }`}
      >
        <div className="flex items-center justify-between mb-4">
          <p className="text-xs font-bold uppercase tracking-wider text-ink-muted">On this page</p>
          <button
            type="button"
            onClick={close}
            aria-label="Close contents"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border text-ink-2"
          >
            <X size={16} />
          </button>
        </div>
        <TocList entries={entries} active={active} onNavigate={close} />
      </aside>

      {/* Desktop: sticky sidebar */}
      <aside
        aria-label="Table of contents"
        className="hidden lg:flex flex-col sticky self-start top-[calc(var(--header-h)+1.5rem)] max-h-[calc(100vh-var(--header-h)-3rem)] rounded-2xl border border-border bg-card"
      >
        <p className="px-5 pt-5 pb-3 text-xs font-bold uppercase tracking-wider text-ink-muted">
          On this page
        </p>
        <nav className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-3"><TocList entries={entries} active={active} listRef={listRef} /></nav>
        <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-3 text-sm text-ink-muted">
          <span className="tabular-nums">{Math.round(progress * 100)}% read</span>
          <a href="#top" className="inline-flex items-center gap-1 hover:text-accent transition-colors">
            <ArrowUp size={14} />
            Top
          </a>
        </div>
      </aside>
    </>
  );
}
