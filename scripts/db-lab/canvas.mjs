// The drawing primitives for scripts/db-lab/diagrams. Colours come only from the site's diagram
// palette, so every drawing follows the light and dark themes. Arrows that join two boxes end on their
// edges, which is what lets a flow list animate messages along them (see src/components/flow).
const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

export const INK = "#2f281e";
export const MUTED = "#5e5241";
export const FAINT = "#7a6d57";
export const GRID = "#dccfb1";
export const AMBER = "#9a5400";
export const GREEN = "#4b7d33";
export const RED = "#b0273f";

const TONES = {
  plain: ["#fffdf8", MUTED],
  raised: ["#faf3e3", MUTED],
  neutral: ["#f3eadb", FAINT],
  amber: ["#fde3ad", AMBER],
  cream: ["#fdf0d4", AMBER],
  green: ["#dfedcc", GREEN],
  red: ["#fbd8d1", RED],
};

const escape = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const attr = (s) => escape(s).replace(/"/g, "&quot;");

/** Breaks text into lines that fit a width, by an average character width for the font size. */
function wrap(text, width, size, mono) {
  const per = Math.max(4, Math.floor(width / (size * (mono ? 0.6 : 0.52))));
  const out = [];
  for (const part of String(text).split("\n")) {
    let line = "";
    for (const word of part.split(" ")) {
      if (line && (line + " " + word).length > per) {
        out.push(line);
        line = word;
      } else line = line ? `${line} ${word}` : word;
    }
    out.push(line);
  }
  return out;
}

export class Canvas {
  constructor(w = 720, h = 330) {
    this.w = w;
    this.h = h;
    this.parts = [];
    this.colors = new Set();
    this.steps = [];
  }

  size(w, h) {
    this.w = w;
    this.h = h;
    return this;
  }

  text(x, y, value, { size = 12, weight = 400, fill = INK, anchor = "start", italic = false, mono = false, rotate } = {}) {
    const extra = [
      mono ? ` font-family="${MONO}"` : "",
      italic ? ' font-style="italic"' : "",
      rotate ? ` transform="rotate(${rotate} ${x} ${y})"` : "",
    ].join("");
    this.parts.push(`<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}"${extra}>${escape(value)}</text>`);
    return this;
  }

  /** A heading line at the top of the drawing. */
  title(value, sub) {
    this.text(20, 26, value, { size: 14, weight: 700 });
    if (sub) this.text(20, 44, sub, { size: 11.5, fill: MUTED });
    return this;
  }

  /** Several lines of plain text, wrapped to a width. */
  para(x, y, value, { width = 300, size = 11.5, fill = MUTED, anchor = "start", weight = 400, gap = 1.35, mono = false } = {}) {
    wrap(value, width, size, mono).forEach((line, i) => this.text(x, y + i * size * gap, line, { size, fill, anchor, weight, mono }));
    return this;
  }

  rect(x, y, w, h, { tone = "plain", rx = 10, dash, opacity } = {}) {
    const [fill, stroke] = TONES[tone];
    const extra = `${dash ? ` stroke-dasharray="${dash}"` : ""}${opacity ? ` opacity="${opacity}"` : ""}`;
    this.parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"${extra}/>`);
    return this;
  }

  /** A box with a bold name and optional small lines, centred. Returns the box's edges for arrows. */
  box(x, y, w, h, name, { tone = "raised", lines = [], size = 12.5, small = 10.5, dash, mono = false, align = "middle" } = {}) {
    this.rect(x, y, w, h, { tone, dash });
    const pad = 8;
    const names = name ? wrap(name, w - pad * 2, size, mono) : [];
    const small_lines = [lines].flat().flatMap((l) => wrap(l, w - pad * 2, small));
    const total = names.length * size * 1.2 + small_lines.length * small * 1.32;
    let ty = y + (h - total) / 2 + (names.length ? size * 0.95 : 0);
    const tx = align === "middle" ? x + w / 2 : x + pad + 2;
    for (const n of names) {
      this.text(tx, +ty.toFixed(2), n, { size, weight: 700, anchor: align, mono });
      ty += size * 1.2;
    }
    if (names.length) ty -= size * 0.2;
    for (const l of small_lines) {
      ty += small * 0.12;
      this.text(tx, +(ty + small * 0.75).toFixed(2), l, { size: small, fill: MUTED, anchor: align });
      ty += small * 1.2;
    }
    return { x, y, w, h, top: [x + w / 2, y], bottom: [x + w / 2, y + h], left: [x, y + h / 2], right: [x + w, y + h / 2], cx: x + w / 2, cy: y + h / 2 };
  }

  marker(color) {
    this.colors.add(color);
    return `url(#ah-${color.slice(1)})`;
  }

  /** A straight arrow from one point to another. `both` puts a head on each end. */
  arrow(a, b, { color = MUTED, width = 1.6, dash, both = false, label, labelAt = 0.5, labelDy = -6, labelDx = 0, labelSize = 11, labelFill } = {}) {
    const heads = `${both ? ` marker-start="${this.marker(color)}"` : ""} marker-end="${this.marker(color)}"`;
    this.parts.push(`<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="${color}" stroke-width="${width}"${dash ? ` stroke-dasharray="${dash}"` : ""}${heads}/>`);
    if (label) {
      const x = a[0] + (b[0] - a[0]) * labelAt + labelDx;
      const y = a[1] + (b[1] - a[1]) * labelAt + labelDy;
      this.text(+x.toFixed(1), +y.toFixed(1), label, { size: labelSize, weight: 700, fill: labelFill ?? color, anchor: "middle" });
    }
    return this;
  }

  /** An arrow along several points, for routes that turn corners. */
  route(points, { color = MUTED, width = 1.6, dash, label, labelAt, labelDy = -6 } = {}) {
    const d = points.map((p, i) => `${i ? "L" : "M"}${p[0]} ${p[1]}`).join(" ");
    this.parts.push(`<path d="${d}" fill="none" stroke="${color}" stroke-width="${width}"${dash ? ` stroke-dasharray="${dash}"` : ""} marker-end="${this.marker(color)}"/>`);
    if (label) {
      const [x, y] = labelAt ?? points[Math.floor(points.length / 2)];
      this.text(x, y + labelDy, label, { size: 11, weight: 700, fill: color, anchor: "middle" });
    }
    return this;
  }

  line(a, b, { color = GRID, width = 1, dash } = {}) {
    this.parts.push(`<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="${color}" stroke-width="${width}"${dash ? ` stroke-dasharray="${dash}"` : ""}/>`);
    return this;
  }

  circle(x, y, r, { tone = "cream" } = {}) {
    const [fill, stroke] = TONES[tone];
    this.parts.push(`<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`);
    return this;
  }

  /** Adds one step to the diagram's looping message animation. */
  flow(from, to, label, type = "data") {
    this.steps.push(label ? { from, to, label, type } : { from, to, type });
    return this;
  }

  /**
   * The site finds a flow step's boxes and label by their exact text, and a label has to sit outside
   * every box. A step that breaks either rule fails here rather than silently losing its label.
   */
  checkFlow(name) {
    const svg = this.parts.join("");
    const rects = [...svg.matchAll(/<rect x="([\d.-]+)" y="([\d.-]+)" width="([\d.-]+)" height="([\d.-]+)"/g)]
      .map((m) => m.slice(1).map(Number))
      .filter(([, , w, h]) => w > 24 && h > 14 && !(w >= this.w - 2 && h >= this.h - 2));
    const texts = [...svg.matchAll(/<text x="([\d.-]+)" y="([\d.-]+)" font-size="([\d.]+)"[^>]*text-anchor="(\w+)"[^>]*>([\s\S]*?)<\/text>/g)].map((m) => {
      const value = m[5].replace(/<[^>]+>/g, "").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&").trim().toLowerCase();
      const size = Number(m[3]);
      const cx = Number(m[1]) + (m[4] === "start" ? value.length * size * 0.28 : 0);
      const cy = Number(m[2]) - size * 0.35;
      return { value, boxed: rects.some(([x, y, w, h]) => cx >= x - 1 && cx <= x + w + 1 && cy >= y - 1 && cy <= y + h + 1) };
    });
    for (const step of this.steps) {
      for (const key of ["from", "to", "label"]) {
        const wanted = step[key]?.trim().toLowerCase();
        if (!wanted) continue;
        const found = texts.filter((t) => t.value === wanted);
        if (!found.length) throw new Error(`${name}: flow ${key} "${step[key]}" is not a text in the diagram`);
        if (key === "label" && found.every((t) => t.boxed)) throw new Error(`${name}: flow label "${step[key]}" is inside a box, so it can't label an arrow`);
      }
    }
  }

  render(name, alt) {
    this.checkFlow(name);
    const defs = [...this.colors]
      .map((c) => `<marker id="ah-${c.slice(1)}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="${c}"/></marker>`)
      .join("");
    return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${this.w} ${this.h}" width="${this.w}" height="${this.h}" font-family="${attr(FONT)}" role="img"><title>${escape(name)}</title><desc>${escape(alt)}</desc><defs>${defs}</defs><rect width="${this.w}" height="${this.h}" fill="#fffdf8"/>${this.parts.join("")}</svg>\n`;
  }
}
