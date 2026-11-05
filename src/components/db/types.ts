/** The shapes of content/db-lab/<file>.json, written by scripts/db-lab/record.mjs from real runs. */
export type Cell = string | number | boolean | null;

export interface TheaterResult {
  status: "ok" | "error";
  tag?: string;
  cols?: string[];
  rows?: Cell[][];
  error?: string;
  code?: string;
}

export interface TheaterStep extends Omit<TheaterResult, "status"> {
  /** Which session ran this statement. */
  s: string;
  sql: string;
  /** What the reader should notice at this step. */
  note: string;
  status: "ok" | "error" | "blocked";
  /** For a blocked statement: the step whose action let it return, and what it returned. */
  resolvedAt?: number;
  resolved?: TheaterResult;
  /** What an outside observer saw once this step finished. */
  table?: { cols: string[]; rows: Cell[][] };
}

export interface TheaterVariant {
  label: string;
  summary: string;
  steps: TheaterStep[];
}

export interface Theater {
  title: string;
  alt: string;
  engine: string;
  sessions: string[];
  tableName: string;
  variants: TheaterVariant[];
}

export interface RanBlock {
  cmd: string;
  out: string;
}

export interface Ran {
  engine: string;
  blocks: RanBlock[];
}

export interface Preset {
  label: string;
  sql: string;
}

export interface Playground {
  title: string;
  /** Tables and rows created before the reader's first run. */
  setup?: string;
  /** The SQL in the box to begin with. */
  query: string;
  presets?: Preset[];
  /** One line about what to try or look for. */
  hint?: string;
}

export interface ChartSeries {
  name: string;
  /** x, y, and an optional word shown with the value (a plan name, say). */
  points: [number, number, string?][];
}

export interface LabChartData {
  engine: string;
  title: string;
  alt: string;
  x: { label: string; log?: boolean; format?: "int" | "pct" };
  /** On a log axis zero can't be drawn, so a point at `zeroAt` is drawn there and read out as 0. */
  y: { label: string; log?: boolean; unit?: string; zeroAt?: number };
  series: ChartSeries[];
}

export interface LabFile {
  theaters?: Record<string, Theater>;
  runs?: Record<string, Ran>;
  charts?: Record<string, LabChartData>;
  playgrounds?: Record<string, Playground>;
  data?: Record<string, unknown>;
}
