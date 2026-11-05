import { MONO } from "@/components/charts/util";
import { CELL_WIDTH, layout, type Tree } from "@/components/db/btree";

const NODE_H = 30;

/** Draws a tree of pages. Pages in `lit` are the ones the last operation read. */
export default function TreeView({ tree, lit, version }: { tree: Tree; lit: number[]; version: number }) {
  const { placed, width, height } = layout(tree);
  const byId = new Map(placed.map((p) => [p.node.id, p]));
  const pad = 12;
  const litSet = new Set(lit);
  return (
    <svg
      key={version}
      viewBox={`${-pad} ${-pad} ${width + pad * 2} ${height + pad * 2}`}
      width={Math.min(width + pad * 2, 740)}
      fontFamily={MONO}
      aria-hidden="true"
      focusable="false"
      style={{ maxHeight: 340 }}
    >
      {placed.flatMap((p) =>
        p.node.children.map((child) => {
          const c = byId.get(child.id);
          if (!c) return null;
          const on = litSet.has(p.node.id) && litSet.has(child.id);
          return (
            <line
              key={`${p.node.id}-${child.id}`}
              x1={p.x + p.width / 2}
              y1={p.y + NODE_H}
              x2={c.x + c.width / 2}
              y2={c.y}
              stroke={on ? "#9a5400" : "#7a6d57"}
              strokeWidth={on ? 2 : 1}
            />
          );
        }),
      )}
      {placed
        .filter((p) => p.node.next)
        .map((p) => {
          const n = byId.get(p.node.next?.id ?? -1);
          if (!n) return null;
          return <line key={`next-${p.node.id}`} x1={p.x + p.width} y1={p.y + NODE_H / 2} x2={n.x} y2={n.y + NODE_H / 2} stroke="#4b7d33" strokeWidth="1.6" strokeDasharray="3 2" />;
        })}
      {placed.map((p) => {
        const on = litSet.has(p.node.id);
        return (
          <g key={p.node.id}>
            <rect x={p.x} y={p.y} width={p.width} height={NODE_H} rx="4" fill={on ? "#fde3ad" : "#faf3e3"} stroke={on ? "#9a5400" : "#5e5241"} strokeWidth={on ? 2 : 1.2} />
            {p.node.keys.map((k, i) => (
              <g key={k}>
                {i > 0 && <line x1={p.x + i * CELL_WIDTH} y1={p.y} x2={p.x + i * CELL_WIDTH} y2={p.y + NODE_H} stroke="#dccfb1" strokeWidth="1" />}
                <text x={p.x + i * CELL_WIDTH + CELL_WIDTH / 2} y={p.y + 20} fontSize="12.5" fontWeight="700" fill="#2f281e" textAnchor="middle">
                  {k}
                </text>
              </g>
            ))}
          </g>
        );
      })}
    </svg>
  );
}
