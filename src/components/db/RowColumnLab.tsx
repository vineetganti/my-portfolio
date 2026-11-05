"use client";

import { useMemo, useState } from "react";

const COLUMNS = ["id", "first", "last", "ssn", "salary", "dob"] as const;
type Column = (typeof COLUMNS)[number];

const FIRST = ["Ana", "Ben", "Cara", "Dev", "Eli", "Fay", "Gus", "Hana", "Ivy", "Jon", "Kim", "Leo"];
const LAST = ["Ross", "Shaw", "Tran", "Ueda", "Vega", "Wong", "Xu", "Yang", "Zhao", "Ames", "Boyd", "Cole"];
const ROWS = FIRST.map((first, i) => ({
  id: String(i + 1),
  first,
  last: LAST[i],
  ssn: String(111 + i * 111).padStart(3, "0"),
  salary: String(40 + ((i * 7) % 12) * 5),
  dob: String(1980 + ((i * 3) % 20)),
}));

// Both layouts use pages of 12 values. A row-store page holds two whole rows. A column-store page
// holds twelve values of one column, so here each column fits in one page.
const ROWS_PER_PAGE = 2;

interface Cell {
  row: number;
  col: Column;
}

interface Page {
  name: string;
  cells: Cell[];
}

const ROW_PAGES: Page[] = Array.from({ length: ROWS.length / ROWS_PER_PAGE }, (_, p) => ({
  name: `page ${p + 1}`,
  cells: [0, 1].flatMap((r) => COLUMNS.map((col) => ({ row: p * ROWS_PER_PAGE + r, col }))),
}));

const COLUMN_PAGES: Page[] = COLUMNS.map((col) => ({
  name: col,
  cells: ROWS.map((_, row) => ({ row, col })),
}));

interface Query {
  label: string;
  sql: string;
  /** The column searched, and the row number it finds, if any. */
  find?: { col: Column; row: number };
  /** The columns the query returns. */
  wants: readonly Column[];
  note: string;
}

const QUERIES: Query[] = [
  {
    label: "One column of one row",
    sql: "SELECT first FROM emp WHERE ssn = '888'",
    find: { col: "ssn", row: 7 },
    wants: ["first"],
    note: "The row store reads rows until it finds a match, and each page carries columns nobody asked for. The column store reads the ssn column, gets a position, and reads one more page.",
  },
  {
    label: "Every column of one row",
    sql: "SELECT * FROM emp WHERE id = 2",
    find: { col: "id", row: 1 },
    wants: COLUMNS,
    note: "This is the row store's home ground: one read and the whole row is there. The column store has to visit every column's page and put the row back together.",
  },
  {
    label: "An aggregate",
    sql: "SELECT sum(salary) FROM emp",
    wants: ["salary"],
    note: "This is the column store's home ground: one page holds every salary. The row store reads the whole table and uses one value in six.",
  },
];

/** Works out which pages a query reads, and which cells in them it really uses. */
function execute(pages: Page[], layout: "row" | "column", q: Query) {
  const read = new Set<string>();
  const used = new Set<string>();
  const key = (c: Cell) => `${c.row}:${c.col}`;
  if (layout === "row") {
    const stop = q.find ? Math.floor(q.find.row / ROWS_PER_PAGE) : pages.length - 1;
    for (let p = 0; p <= stop; p++) {
      read.add(pages[p].name);
      for (const c of pages[p].cells) {
        const scanned = q.find && c.col === q.find.col && c.row <= q.find.row;
        const wanted = q.wants.includes(c.col) && (!q.find || c.row === q.find.row);
        if (scanned || wanted) used.add(key(c));
      }
    }
  } else {
    if (q.find) {
      read.add(q.find.col);
      for (let r = 0; r <= q.find.row; r++) used.add(key({ row: r, col: q.find.col }));
    }
    for (const col of q.wants) {
      read.add(col);
      if (q.find) used.add(key({ row: q.find.row, col }));
      else ROWS.forEach((_, row) => used.add(key({ row, col })));
    }
  }
  return { read, used };
}

function Layout({ title, pages, layout, q }: { title: string; pages: Page[]; layout: "row" | "column"; q: Query }) {
  const { read, used } = useMemo(() => execute(pages, layout, q), [pages, layout, q]);
  const fetched = pages.filter((p) => read.has(p.name)).reduce((n, p) => n + p.cells.length, 0);
  return (
    <div className="rc-layout">
      <div className="rc-title">
        {title}
        <span className="rc-count">
          <strong>{read.size}</strong> page{read.size === 1 ? "" : "s"} read
        </span>
      </div>
      <div className="rc-pages">
        {pages.map((page) => (
          <div key={page.name} className={read.has(page.name) ? "rc-page rc-read" : "rc-page"}>
            <div className="rc-page-name">{page.name}</div>
            <div className="rc-cells" data-layout={layout}>
              {page.cells.map((c) => (
                <span key={`${c.row}:${c.col}`} className={used.has(`${c.row}:${c.col}`) ? "rc-cell rc-used" : "rc-cell"}>
                  {ROWS[c.row][c.col]}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="rc-foot">
        Fetched {fetched} values, used {used.size}.
      </div>
    </div>
  );
}

/**
 * The same twelve-row table in a row store and a column store. A real page-by-page walk works out
 * which pages each query reads, so the counts come from the layouts, not from a table of answers.
 */
export default function RowColumnLab() {
  const [index, setIndex] = useState(2);
  const q = QUERIES[index];
  return (
    <div
      className="diagram diagram-live data-trace rc-lab"
      role="group"
      aria-label="A simulator with the same small table stored by rows and by columns. For a lookup of one column, the row store reads several pages and the column store reads two. For a whole row, the row store reads one page and the column store six. For a sum of one column, the row store reads all six pages and the column store one."
    >
      <div className="dt-steps" role="tablist" aria-label="Queries">
        {QUERIES.map((item, i) => (
          <button key={item.label} type="button" role="tab" aria-selected={i === index} className="dt-step" onClick={() => setIndex(i)}>
            {item.label}
          </button>
        ))}
      </div>
      <code className="rc-sql">{q.sql}</code>
      <div className="rc-grid">
        <Layout title="Row store" pages={ROW_PAGES} layout="row" q={q} />
        <Layout title="Column store" pages={COLUMN_PAGES} layout="column" q={q} />
      </div>
      <div className="chart-readout">{q.note}</div>
      <div className="dt-legend" aria-hidden="true">
        <span className="dt-chip rc-chip-read">page read from disk</span>
        <span className="dt-chip rc-chip-used">value actually used</span>
      </div>
    </div>
  );
}
