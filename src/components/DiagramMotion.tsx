"use client";

import { useEffect } from "react";

/** A whole diagram finishes revealing in about this long, however many parts it has. */
const REVEAL_MS = 1000;
/** Longest gap between two parts of a small diagram. */
const MAX_STEP_MS = 45;
/** Reveal a little before the diagram is fully on screen. */
const TRIGGER = 0.92;

/**
 * Ambient motion for the inlined SVG diagrams: each one fades its parts in, in drawing
 * order, the first time it scrolls into view. Renders nothing.
 *
 * Only diagrams below the fold are hidden (by the `dg-armed` class), so nothing on screen
 * flashes. Without JavaScript, with reduced motion, or in print, every diagram stays visible.
 * Live charts (`.diagram-live`) are left alone.
 */
export default function DiagramMotion() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const armed: HTMLElement[] = [];
    const viewport = window.innerHeight;

    for (const diagram of document.querySelectorAll<HTMLElement>(".prose .diagram:not(.diagram-live)")) {
      if (diagram.getBoundingClientRect().top < viewport * TRIGGER) continue;
      const svg = diagram.querySelector(":scope > svg");
      if (!svg) continue;

      const parts = [...svg.querySelectorAll(":scope > :not(defs, title, desc, style)")];
      // The first part is usually the full-size background rect; it stays put so the card doesn't flicker.
      const first = parts[0];
      if (first?.matches("rect:not([x]):not([y])")) parts.shift();
      if (parts.length === 0) continue;

      parts.forEach((part, i) => {
        part.classList.add("dg-item");
        (part as SVGElement).style.setProperty("--i", String(i));
      });
      diagram.style.setProperty("--dg-step", `${Math.min(MAX_STEP_MS, REVEAL_MS / parts.length)}ms`);
      diagram.classList.add("dg-armed");
      armed.push(diagram);
    }
    if (armed.length === 0) return;

    // A scroll check rather than an IntersectionObserver, so a diagram that is jumped
    // past (End key, a table-of-contents link) is still revealed when scrolling back up.
    let frame = 0;
    const check = () => {
      frame = 0;
      for (let i = armed.length - 1; i >= 0; i--) {
        if (armed[i].getBoundingClientRect().top < window.innerHeight * TRIGGER) {
          armed[i].classList.replace("dg-armed", "dg-in");
          armed.splice(i, 1);
        }
      }
      if (armed.length === 0) stop();
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(check);
    };
    const stop = () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    onScroll();

    return () => {
      stop();
      cancelAnimationFrame(frame);
      document.querySelectorAll(".diagram.dg-armed, .diagram.dg-in").forEach((d) => d.classList.remove("dg-armed", "dg-in"));
    };
  }, []);

  return null;
}
