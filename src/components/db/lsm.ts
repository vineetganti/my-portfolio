/**
 * A small but real log-structured merge tree. Writes go to a log and a sorted memtable. A full
 * memtable becomes an immutable sorted file at level 0, and compaction merges files down a level,
 * keeping the newest version of each key and dropping tombstones at the bottom.
 */
export interface Entry {
  key: number;
  value: string | null; // null is a tombstone
  seq: number;
}

export interface Sst {
  id: number;
  entries: Entry[];
}

const MEMTABLE_MAX = 4;
const L0_MAX = 3;
const LEVEL_MAX = [3, 3, 99];

export interface GetResult {
  value: string | null;
  found: boolean;
  /** Where the read looked, in order. */
  probes: string[];
}

export class Lsm {
  memtable = new Map<number, Entry>();
  wal: Entry[] = [];
  levels: Sst[][] = [[], [], []];
  seq = 0;
  nextId = 1;
  logicalWrites = 0;
  diskWrites = 0;
  compactions = 0;

  put(key: number, value: string | null) {
    const entry = { key, value, seq: ++this.seq };
    this.wal.push(entry);
    this.diskWrites++;
    this.logicalWrites++;
    this.memtable.set(key, entry);
    if (this.memtable.size >= MEMTABLE_MAX) this.flush();
  }

  flush() {
    if (this.memtable.size === 0) return;
    const entries = [...this.memtable.values()].sort((a, b) => a.key - b.key);
    this.levels[0].unshift({ id: this.nextId++, entries });
    this.diskWrites += entries.length;
    this.memtable = new Map();
    this.wal = [];
    if (this.levels[0].length > L0_MAX) this.compact(0);
  }

  /** Merges every file of a level into the next, newest version of each key winning. */
  compact(level: number) {
    const bottom = level + 1 === this.levels.length - 1 || this.levels.slice(level + 2).every((l) => l.length === 0);
    const merged = new Map<number, Entry>();
    for (const file of [...this.levels[level + 1], ...this.levels[level]]) {
      for (const e of file.entries) {
        const seen = merged.get(e.key);
        if (!seen || e.seq > seen.seq) merged.set(e.key, e);
      }
    }
    const entries = [...merged.values()].filter((e) => !(bottom && e.value === null)).sort((a, b) => a.key - b.key);
    this.levels[level] = [];
    this.levels[level + 1] = entries.length ? [{ id: this.nextId++, entries }] : [];
    this.diskWrites += entries.length;
    this.compactions++;
    if (this.levels[level + 1].length > LEVEL_MAX[level + 1]) this.compact(level + 1);
  }

  /** Compacts everything down to the last level, as a manual compaction would. */
  compactAll() {
    this.flush();
    for (let level = 0; level < this.levels.length - 1; level++) {
      if (this.levels[level].length) this.compact(level);
    }
  }

  get(key: number): GetResult {
    const probes: string[] = ["memtable"];
    const hit = this.memtable.get(key);
    if (hit) return { value: hit.value, found: hit.value !== null, probes };
    for (let level = 0; level < this.levels.length; level++) {
      for (const file of this.levels[level]) {
        const first = file.entries[0]?.key ?? 0;
        const last = file.entries[file.entries.length - 1]?.key ?? 0;
        if (key < first || key > last) continue; // outside this file's range: no read needed
        probes.push(`L${level} file ${file.id}`);
        const e = file.entries.find((x) => x.key === key);
        if (e) return { value: e.value, found: e.value !== null, probes };
      }
    }
    return { value: null, found: false, probes };
  }

  /** Power loss: memory is gone. On restart the log rebuilds the memtable. */
  crash() {
    const replay = this.wal;
    this.memtable = new Map();
    for (const e of replay) this.memtable.set(e.key, e);
    return replay.length;
  }

  stats() {
    const stored = this.levels.flat().reduce((n, f) => n + f.entries.length, 0);
    const live = new Set<number>();
    for (const e of [...this.levels.flat().flatMap((f) => f.entries), ...this.memtable.values()]) live.add(e.key);
    return {
      files: this.levels.flat().length,
      stored,
      live: live.size,
      writeAmp: this.logicalWrites ? this.diskWrites / this.logicalWrites : 0,
    };
  }
}
