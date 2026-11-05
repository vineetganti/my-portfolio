import type { Cell } from "@/components/db/types";

/** One value in a result table. NULL is shown as a word, so it can't be mistaken for an empty string. */
function CellValue({ value }: { value: Cell }) {
  if (value === null) return <span className="dt-null">NULL</span>;
  if (typeof value === "boolean") return <>{value ? "t" : "f"}</>;
  return <>{String(value)}</>;
}

const isNumeric = (v: Cell) => typeof v === "number" || (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v));

/** A compact table of query results, sharing the data-trace look. */
export function ResultTable({ cols, rows, limit = 50 }: { cols: string[]; rows: Cell[][]; limit?: number }) {
  return (
    <div className="dt-scroll">
      <table>
        <thead>
          <tr>
            {cols.map((c, i) => (
              <th key={i}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td className="dt-empty" colSpan={cols.length}>
                (no rows)
              </td>
            </tr>
          )}
          {rows.slice(0, limit).map((r, i) => (
            <tr key={i}>
              {r.map((v, j) => (
                <td key={j} className={isNumeric(v) ? "dt-num" : undefined}>
                  <CellValue value={v} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
