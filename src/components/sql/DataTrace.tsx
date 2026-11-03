import fs from "node:fs";
import path from "node:path";
import DataTraceView, { type Trace } from "@/components/sql/DataTraceView";

const TRACE_DIR = path.join(process.cwd(), "content/sql-traces");
const cache = new Map<string, Record<string, Trace>>();

function load(post: string): Record<string, Trace> {
  let data = cache.get(post);
  if (!data) {
    data = JSON.parse(fs.readFileSync(path.join(TRACE_DIR, `${post}.json`), "utf-8")) as Record<string, Trace>;
    cache.set(post, data);
  }
  return data;
}

/**
 * `<DataTrace post="sql-foundations" q="q08" />` in a post: the step-by-step data view of one
 * answer, read at build time from content/sql-traces/<post>.json (written by scripts/sql-bank).
 */
export default function DataTrace({ post, q }: { post: string; q: string }) {
  const trace = load(post)[q];
  if (!trace) throw new Error(`No data trace "${q}" in content/sql-traces/${post}.json`);
  return <DataTraceView trace={trace} />;
}
