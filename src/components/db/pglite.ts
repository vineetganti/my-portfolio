/**
 * Loads real PostgreSQL (PGlite, compiled to WebAssembly) into the page, once, the first time a
 * reader presses Run. The files are served from /pglite, copied there by scripts/copy-pglite.mjs.
 */
export interface PgResult {
  fields: { name: string }[];
  rows: unknown[][];
  affectedRows?: number;
}

export interface Pg {
  exec(sql: string, options?: { rowMode?: "array" | "object" }): Promise<PgResult[]>;
  isInTransaction?: () => boolean;
}

const EXTENSIONS = ["pageinspect", "pg_visibility", "pg_buffercache", "pg_walinspect", "pg_freespacemap", "bloom"];

let loading: Promise<Pg> | null = null;

/** PGlite's file system image, gzipped by scripts/copy-pglite.mjs because hosts won't compress it. */
async function fileSystem(): Promise<Blob> {
  const response = await fetch("/pglite/pglite.data.gzipped");
  if (!response.ok || !response.body) throw new Error(`Couldn't download PostgreSQL (${response.status})`);
  return new Response(response.body.pipeThrough(new DecompressionStream("gzip"))).blob();
}

// The URLs live in variables so that neither bundler tries to resolve them at build time.
async function load(): Promise<Pg> {
  const entry = "/pglite/index.js";
  const [{ PGlite }, modules, fsBundle] = await Promise.all([
    import(/* webpackIgnore: true */ /* turbopackIgnore: true */ entry),
    Promise.all(
      EXTENSIONS.map((name) => {
        const url = `/pglite/contrib/${name}.js`;
        return import(/* webpackIgnore: true */ /* turbopackIgnore: true */ url);
      }),
    ),
    fileSystem(),
  ]);
  const extensions = Object.fromEntries(EXTENSIONS.map((name, i) => [name, modules[i][name]]));
  const db: Pg = await PGlite.create({ extensions, fsBundle });
  await db.exec(EXTENSIONS.map((name) => `CREATE EXTENSION IF NOT EXISTS ${name};`).join("\n"));
  return db;
}

export function postgres(): Promise<Pg> {
  loading ??= load().catch((e) => {
    loading = null;
    throw e;
  });
  return loading;
}

/** Makes a query result's values printable the way psql would print them. */
export function show(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString().replace("T", " ").replace(/\.\d+Z$/, "+00");
  if (value instanceof Uint8Array) return `\\x${[...value].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
  return JSON.stringify(value, (_, v) => (typeof v === "bigint" ? v.toString() : v));
}
