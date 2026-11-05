import fs from "node:fs";
import path from "node:path";
import type { LabFile } from "@/components/db/types";

const DIR = path.join(process.cwd(), "content/db-lab");
const cache = new Map<string, LabFile>();

function readLab(file: string): LabFile {
  // Recordings change while the dev server is running, so only a production build keeps them.
  let lab = process.env.NODE_ENV === "production" ? cache.get(file) : undefined;
  if (!lab) {
    lab = JSON.parse(fs.readFileSync(path.join(DIR, `${file}.json`), "utf-8")) as LabFile;
    cache.set(file, lab);
  }
  return lab;
}

/**
 * Looks up "<file>/<id>" in content/db-lab, which holds the recordings from real database runs.
 * A post pointing at something that wasn't recorded fails the build rather than showing nothing.
 */
export function labItem<K extends keyof LabFile>(kind: K, src: string): NonNullable<NonNullable<LabFile[K]>[string]> {
  const [file, id] = src.split("/");
  const item = readLab(file)[kind]?.[id];
  if (!item) throw new Error(`No ${kind} "${id}" in content/db-lab/${file}.json`);
  return item as NonNullable<NonNullable<LabFile[K]>[string]>;
}
