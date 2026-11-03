import { MARKER_TYPES, type FlowStep, type MarkerType } from "./markers";
import { STATIC_FRAME, frameAt, type Frame } from "./timing";

/** How visible an arrow and a label are when nothing is travelling along them. */
const REST_EDGE = 0.3;
const REST_LABEL = 0.3;
/** Pixel slack between an arrow's end and the box it points at (arrows stop a few pixels short). */
const PAD = 8;
const NS = "http://www.w3.org/2000/svg";

interface ResolvedStep {
  edge: SVGGeometryElement;
  length: number;
  reverse: boolean;
  label: SVGTextElement | null;
  destination: SVGRectElement;
  type: MarkerType;
}

export interface Flow {
  /** Draw the state at `elapsed` ms of playing time. */
  renderAt(elapsed: number): void;
  /** Draw the first step lit and still (for reduced motion). */
  renderStatic(): void;
  /** Number of steps that found their boxes and arrow. */
  readonly steps: number;
  /** Put the diagram back exactly as it was drawn. */
  destroy(): void;
}

type Box = { x: number; y: number; width: number; height: number };
const contains = (b: Box, x: number, y: number, pad = 0) =>
  x >= b.x - pad && x <= b.x + b.width + pad && y >= b.y - pad && y <= b.y + b.height + pad;
const centerOf = (b: Box): [number, number] => [b.x + b.width / 2, b.y + b.height / 2];
const strokeWidthOf = (el: Element) => parseFloat(el.getAttribute("stroke-width") ?? "") || 1.5;

/**
 * Wires an inlined SVG diagram up to a list of steps. Boxes are found by their text, arrows by their
 * `marker-end` / `marker-start`, and an arrow joins two boxes if its two ends touch them. Nothing in
 * the SVG is edited: only inline styles and one extra `<g>` for the marker, all removed by `destroy`.
 * Returns null if the root has no SVG or no step could be matched.
 */
export function createFlow(root: HTMLElement, steps: FlowStep[]): Flow | null {
  const svg = root.querySelector("svg");
  if (!svg) return null;

  const view = svg.viewBox.baseVal;
  const texts = [...svg.querySelectorAll("text")].map((el) => ({ el, s: (el.textContent ?? "").trim(), box: el.getBBox() }));
  const rects = [...svg.querySelectorAll("rect")]
    .map((el) => ({ el, box: el.getBBox() }))
    .filter((r) => r.box.width > 24 && r.box.height > 14 && !(r.box.width >= view.width - 2 && r.box.height >= view.height - 2));

  // A box is the smallest rect around a piece of text.
  const insideSomeBox = (t: { box: Box }) => {
    const [x, y] = centerOf(t.box);
    return rects.some((r) => contains(r.box, x, y, 1));
  };
  const boxNamed = (name: string) => {
    // "Model#2" means the second box named "Model"; only a trailing #<digits> counts, so "#post-content" is a plain name.
    const indexed = /^(.*)#(\d+)$/.exec(name);
    const wanted = (indexed ? indexed[1] : name).trim().toLowerCase();
    const text = texts.filter((t) => t.s.toLowerCase() === wanted)[indexed ? Number(indexed[2]) - 1 : 0];
    if (!text) return null;
    const [x, y] = centerOf(text.box);
    let best: (typeof rects)[number] | null = null;
    for (const r of rects) if (contains(r.box, x, y, 1) && (!best || r.box.width * r.box.height < best.box.width * best.box.height)) best = r;
    return best;
  };

  const arrows = [...svg.querySelectorAll<SVGGeometryElement>("[marker-end], [marker-start]")]
    .filter((el) => typeof el.getTotalLength === "function")
    .map((el) => {
      const length = el.getTotalLength();
      const a = el.getPointAtLength(0);
      const b = el.getPointAtLength(length);
      return { el, length, a, b, twoWay: el.hasAttribute("marker-start") && el.hasAttribute("marker-end") };
    });

  const resolved: ResolvedStep[] = [];
  for (const step of steps) {
    const from = boxNamed(step.from);
    const to = boxNamed(step.to);
    const forward = from && to && arrows.find((a) => contains(from.box, a.a.x, a.a.y, PAD) && contains(to.box, a.b.x, a.b.y, PAD));
    // An arrow drawn the other way round can still carry the message if it has arrowheads at both ends.
    const backward = from && to && !forward && arrows.find((a) => a.twoWay && contains(to.box, a.a.x, a.a.y, PAD) && contains(from.box, a.b.x, a.b.y, PAD));
    const hit = forward || backward;
    if (!from || !to || !hit) {
      if (process.env.NODE_ENV !== "production") console.warn(`[flow] ${svg.querySelector("title")?.textContent ?? "diagram"} | no arrow found for "${step.from}" -> "${step.to}"; step skipped`);
      continue;
    }
    // The label is an existing text near the arrow; the closest one wins if the wording repeats.
    let label: SVGTextElement | null = null;
    if (step.label) {
      const mid = hit.el.getPointAtLength(hit.length / 2);
      let nearest = Infinity;
      for (const t of texts) {
        if (t.s.toLowerCase() !== step.label.trim().toLowerCase() || insideSomeBox(t)) continue;
        const [x, y] = centerOf(t.box);
        const d = Math.hypot(x - mid.x, y - mid.y);
        if (d < nearest) { nearest = d; label = t.el as SVGTextElement; }
      }
      if (!label && process.env.NODE_ENV !== "production") console.warn(`[flow] ${svg.querySelector("title")?.textContent ?? "diagram"} | label "${step.label}" not found; shown without a label`);
    }
    resolved.push({ edge: hit.el, length: hit.length, reverse: !!backward, label, destination: to.el as SVGRectElement, type: step.type });
  }
  if (resolved.length === 0) return null;

  // Resting state: every arrow in the diagram, and the labels the steps use, drawn faintly.
  const edgeBase = new Map<SVGGeometryElement, number>(arrows.map((a) => [a.el, strokeWidthOf(a.el)]));
  for (const { el } of arrows) { el.classList.add("flow-edge"); el.style.opacity = String(REST_EDGE); }
  const labels = new Set(resolved.flatMap((r) => (r.label ? [r.label] : [])));
  for (const l of labels) { l.classList.add("flow-label"); l.style.opacity = String(REST_LABEL); }
  const nodeBase = new Map<SVGRectElement, number>();
  const nodeOriginalStroke = new Map<SVGRectElement, string>();
  for (const r of resolved) nodeBase.set(r.destination, strokeWidthOf(r.destination));

  const marker = document.createElementNS(NS, "g");
  marker.setAttribute("class", "flow-marker");
  marker.setAttribute("aria-hidden", "true");
  marker.style.opacity = "0";
  marker.style.pointerEvents = "none";
  svg.appendChild(marker);
  let markerType: MarkerType | null = null;

  const mix = (pct: number, base: string) => `color-mix(in srgb, var(--dg-ink) ${(pct * 100).toFixed(0)}%, ${base})`;

  const render = (frame: Frame | null) => {
    const active = frame ? resolved[frame.step] : null;
    root.dataset.flowStep = frame ? String(frame.step) : "";

    for (const { el } of arrows) {
      const g = active && active.edge === el ? frame!.glow : 0;
      el.style.opacity = String(REST_EDGE + (1 - REST_EDGE) * g);
      el.style.strokeWidth = g ? String(edgeBase.get(el)! * (1 + 0.3 * g)) : "";
      el.style.stroke = g ? mix(g, "var(--dg-muted)") : "";
    }
    for (const l of labels) {
      const g = active && active.label === l ? frame!.glow : 0;
      l.style.opacity = String(REST_LABEL + (1 - REST_LABEL) * g);
    }
    for (const [node, base] of nodeBase) {
      const p = active && active.destination === node ? frame!.pulse : 0;
      if (p > 0) {
        // Brighten from the box's own colour toward the ink colour, read once per pulse so a theme change is honoured.
        if (!nodeOriginalStroke.has(node)) nodeOriginalStroke.set(node, getComputedStyle(node).stroke);
        node.style.strokeWidth = String(base + 1.8 * p);
        node.style.stroke = mix(p, nodeOriginalStroke.get(node)!);
      } else {
        nodeOriginalStroke.delete(node);
        node.style.strokeWidth = "";
        node.style.stroke = "";
      }
    }

    if (!active || frame!.markerOpacity <= 0.001) {
      marker.style.opacity = "0";
      return;
    }
    if (markerType !== active.type) {
      marker.innerHTML = MARKER_TYPES[active.type].markup;
      markerType = active.type;
    }
    // The marker follows the arrow's own path, so right-angle bends are followed exactly.
    const along = active.length * (active.reverse ? 1 - frame!.progress : frame!.progress);
    const pt = active.edge.getPointAtLength(along);
    const scale = 0.65 + 0.35 * Math.min(1, frame!.glow * 1.5);
    marker.setAttribute("transform", `translate(${pt.x.toFixed(2)} ${pt.y.toFixed(2)}) scale(${scale.toFixed(3)})`);
    marker.style.opacity = String(frame!.markerOpacity);
  };

  render(null);

  return {
    steps: resolved.length,
    renderAt: (elapsed) => render(frameAt(elapsed, resolved.length)),
    renderStatic: () => render(STATIC_FRAME),
    destroy() {
      for (const { el } of arrows) { el.classList.remove("flow-edge"); el.style.opacity = el.style.strokeWidth = el.style.stroke = ""; if (!el.getAttribute("style")) el.removeAttribute("style"); }
      for (const l of labels) { l.classList.remove("flow-label"); l.style.opacity = ""; if (!l.getAttribute("style")) l.removeAttribute("style"); }
      for (const node of nodeBase.keys()) { node.style.strokeWidth = node.style.stroke = ""; if (!node.getAttribute("style")) node.removeAttribute("style"); }
      marker.remove();
      delete root.dataset.flowStep;
    },
  };
}
