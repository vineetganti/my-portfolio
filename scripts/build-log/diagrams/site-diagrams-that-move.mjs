import { AMBER, GREEN, MUTED } from "../../db-lab/canvas.mjs";
import { summaryMap } from "./_shared.mjs";

const post = {
  slug: "site-diagrams-that-move",
  diagrams: {
    "inline-svg": {
      alt: "What happens to a Markdown image. MdxContent's image override checks the path. A PNG is served as a normal img tag. A local SVG is read from disk at build time, its ids are prefixed with the file name so two diagrams cannot clash, and it is inlined as a span with role img and the alt text as its label. If a flow.json file sits beside it, the SVG goes to FlowDiagram instead and gets a message animation.",
      draw(c) {
        c.size(720, 300).title("A Markdown image becomes one of three things");
        const md = c.box(20, 118, 130, 60, "![alt](x.svg)", { tone: "plain", mono: true, size: 11.5 });
        const img = c.box(200, 118, 140, 60, "Image override", { tone: "amber", lines: "in MdxContent" });
        c.box(410, 40, 290, 56, "PNG or remote: <img>", { tone: "raised", lines: "served as it is" });
        c.box(410, 118, 290, 60, "SVG: inlined span.diagram", { tone: "green", lines: "ids prefixed, alt as aria-label" });
        c.box(410, 200, 290, 56, "SVG + flow.json: FlowDiagram", { tone: "cream", lines: "looping message animation" });
        c.arrow(md.right, img.left);
        c.arrow([340, 132], [408, 68]);
        c.arrow(img.right, [408, 148], { color: GREEN });
        c.arrow([340, 164], [408, 228], { color: AMBER });
        c.para(20, 196, "Inlining is what lets the page's CSS recolour the drawing for dark mode, which an <img> can't do.", { width: 170, size: 10.5 });
      },
    },

    "palette-tokens": {
      alt: "How one diagram works in both themes. The SVG is drawn only with palette hex codes, for example an amber tint fill. A CSS attribute rule in globals.css maps that hex to a token, var(--dg-amber-t). The light theme defines the token as the same pale amber; the dark theme redefines it as a deep brown, so the same file reads well on both backgrounds.",
      draw(c) {
        c.size(720, 260).title("Hex in the file, token on the page");
        const hex = c.box(20, 90, 150, 60, 'fill="#fde3ad"', { tone: "amber", mono: true, size: 11.5, lines: "in the SVG" });
        const rule = c.box(220, 90, 210, 60, ".diagram [fill=…] → var(--dg-amber-t)", { tone: "raised", size: 11, mono: true });
        c.box(500, 50, 200, 50, "light: #fde3ad", { tone: "amber", mono: true, size: 11.5 });
        c.box(500, 140, 200, 50, "dark: #3e3116", { tone: "neutral", mono: true, size: 11.5 });
        c.arrow(hex.right, rule.left);
        c.arrow([430, 110], [498, 75]);
        c.arrow([430, 130], [498, 165]);
        c.para(20, 214, "A hex outside the palette has no rule, so it stays the same colour in dark mode and usually looks wrong. That is why every drawing uses only the palette.", { width: 680, fill: MUTED });
      },
    },

    "flow-step": {
      alt: "The timeline of one animation step, 1,900 milliseconds long. For the first 220 ms the arrow and its label fade in. From 220 to 1,320 ms a marker travels along the arrow with an ease-in-out curve. When it arrives, the destination box pulses for 320 ms, and from 1,580 ms the arrow and label fade back. After the last step the loop pauses for 800 ms.",
      draw(c) {
        c.size(720, 230).title("One step of a message flow, as a function of time");
        const x = (ms) => 40 + (ms / 1900) * 640;
        c.line([x(0), 140], [x(1900), 140], { color: MUTED, width: 1.5 });
        const segs = [
          [0, 220, "fade in", "amber"],
          [220, 1320, "marker travels", "green"],
          [1320, 1640, "pulse", "cream"],
        ];
        segs.forEach(([a, b, label, tone]) => c.box(x(a), 90, x(b) - x(a) - 2, 40, b - a < 300 ? "" : label, { tone, size: 11.5 }));
        c.text(x(110), 84, "fade in", { size: 10, fill: MUTED, anchor: "middle" });
        c.text(x(1480), 84, "pulse", { size: 10, fill: MUTED, anchor: "middle" });
        c.rect(x(1580), 60, x(1900) - x(1580), 14, { tone: "neutral", rx: 4 });
        c.text(x(1740), 54, "edge and label fade", { size: 10, fill: MUTED, anchor: "middle" });
        [0, 220, 1320, 1580, 1640, 1900].forEach((ms) => {
          c.line([x(ms), 136], [x(ms), 146], { color: MUTED, width: 1.5 });
          c.text(x(ms), 162, `${ms} ms`, { size: 10.5, fill: MUTED, anchor: "middle" });
        });
        c.para(40, 192, "Everything drawn is a pure function of one number, elapsed time. Pausing stops adding to it, so resuming continues from the exact frame.", { width: 640 });
      },
    },

    "flow-matching": {
      alt: "How the animation finds its path without any ids in the SVG. A step names two boxes by their text. A box is the smallest rectangle around that text. An arrow is a line or path with an arrowhead marker. The arrow that joins the two boxes is the one whose two ends touch them, within 8 pixels. The diagram file is never edited; only inline styles and one marker group are added, and removed again on unmount.",
      draw(c) {
        c.size(720, 260).title("Matching a step to the drawing, by text and geometry");
        const a = c.box(40, 70, 150, 60, "client", { tone: "plain", lines: "a box: text in a rect" });
        const b = c.box(320, 70, 150, 60, "server", { tone: "raised", lines: "the other box" });
        c.arrow(a.right, b.left, { color: AMBER, label: "HTTP" });
        c.para(500, 70, '{ "from": "client", "to": "server", "label": "HTTP", "type": "request" }', { width: 200, mono: true, size: 10.5, fill: MUTED });
        c.para(40, 170, "1. Find each box: the smallest rect around the named text.", { width: 660 });
        c.para(40, 190, "2. Find the arrow: a line with a marker whose two ends touch the two boxes, within 8 px.", { width: 660 });
        c.para(40, 210, "3. Find the label: the same text outside any box, nearest the middle of the arrow.", { width: 660 });
        c.flow("client", "server", "HTTP", "request");
      },
    },

    "summary-map": {
      alt: "A map of the diagrams post. Inline: SVGs are read at build time and put into the page. Palette: fixed hex codes mapped to theme tokens. Motion: a scroll reveal and a looping message flow driven by one clock. Live charts: React state, sliders and a sentence that restates the numbers.",
      draw(c) {
        summaryMap(
          c,
          "Diagrams that move",
          [
            { name: "Inline", lines: ["read at build time", "ids prefixed", "role img + alt"] },
            { name: "Palette", lines: ["fixed hex codes", "attribute rules", "light + dark tokens"] },
            { name: "Motion", lines: ["reveal on scroll", "flow by text match", "one clock"] },
            { name: "Live charts", lines: ["ChartFrame", "sliders", "readout sentence"] },
          ],
          "No extra library: plain SVG, CSS and two small client components.",
        );
      },
    },
  },
};

export default post;
