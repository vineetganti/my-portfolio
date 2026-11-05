/**
 * A real B-tree and B+tree, for the simulators in the database posts. Nodes are "pages" holding at
 * most `max` keys. In a B+tree, internal pages only route: every key lives in a leaf, and leaves are
 * linked. In a B-tree each key lives once, at whatever level it landed.
 */
export interface TreeNode {
  id: number;
  keys: number[];
  children: TreeNode[];
  /** The next leaf, in a B+tree. */
  next: TreeNode | null;
}

export type TreeKind = "btree" | "bplus";

export interface Stats {
  height: number;
  pages: number;
  keys: number;
  /** How full the pages are, from 0 to 1. */
  fill: number;
}

export class Tree {
  root: TreeNode;
  splits = 0;
  private nextId = 1;

  constructor(
    public kind: TreeKind,
    public max: number,
  ) {
    this.root = this.node();
  }

  private node(keys: number[] = [], children: TreeNode[] = []): TreeNode {
    return { id: this.nextId++, keys, children, next: null };
  }

  private isLeaf = (n: TreeNode) => n.children.length === 0;

  /** The child to descend into for a key. */
  private slot(n: TreeNode, key: number): number {
    let i = 0;
    while (i < n.keys.length && (this.kind === "bplus" ? key >= n.keys[i] : key > n.keys[i])) i++;
    return i;
  }

  /** Splits an overfull page, returning the separator and the new right sibling. */
  private split(n: TreeNode): { key: number; right: TreeNode } {
    this.splits++;
    const mid = Math.floor(n.keys.length / 2);
    if (this.kind === "bplus" && this.isLeaf(n)) {
      const right = this.node(n.keys.slice(mid));
      n.keys = n.keys.slice(0, mid);
      right.next = n.next;
      n.next = right;
      return { key: right.keys[0], right };
    }
    const key = n.keys[mid];
    const right = this.node(n.keys.slice(mid + 1), n.children.slice(mid + 1));
    n.keys = n.keys.slice(0, mid);
    n.children = n.children.slice(0, mid + 1);
    return { key, right };
  }

  private add(n: TreeNode, key: number, path: number[]): { key: number; right: TreeNode } | null {
    path.push(n.id);
    if (this.isLeaf(n)) {
      const at = n.keys.findIndex((k) => k > key);
      n.keys.splice(at === -1 ? n.keys.length : at, 0, key);
    } else {
      const i = this.slot(n, key);
      const promoted = this.add(n.children[i], key, path);
      if (promoted) {
        n.keys.splice(i, 0, promoted.key);
        n.children.splice(i + 1, 0, promoted.right);
      }
    }
    return n.keys.length > this.max ? this.split(n) : null;
  }

  /** Inserts a key and reports the pages it walked and how many splits it caused. */
  insert(key: number): { path: number[]; splits: number } {
    if (this.search(key).found) return { path: [], splits: 0 };
    const before = this.splits;
    const path: number[] = [];
    const promoted = this.add(this.root, key, path);
    if (promoted) this.root = this.node([promoted.key], [this.root, promoted.right]);
    return { path, splits: this.splits - before };
  }

  search(key: number): { path: number[]; found: boolean } {
    const path: number[] = [];
    let n = this.root;
    for (;;) {
      path.push(n.id);
      if (this.kind === "btree" && n.keys.includes(key)) return { path, found: true };
      if (this.isLeaf(n)) return { path, found: n.keys.includes(key) };
      n = n.children[this.slot(n, key)];
    }
  }

  /** Walks a key range the way each structure must, counting every page read. */
  range(lo: number, hi: number): { reads: number[]; keys: number[] } {
    const reads: number[] = [];
    const keys: number[] = [];
    if (this.kind === "bplus") {
      let n = this.root;
      reads.push(n.id);
      while (!this.isLeaf(n)) {
        n = n.children[this.slot(n, lo)];
        reads.push(n.id);
      }
      for (let leaf: TreeNode | null = n; leaf; leaf = leaf.next) {
        if (leaf !== n) reads.push(leaf.id);
        for (const k of leaf.keys) if (k >= lo && k <= hi) keys.push(k);
        if (leaf.keys.length && leaf.keys[leaf.keys.length - 1] > hi) break;
      }
      return { reads, keys };
    }
    // A B-tree has no leaf chain: an in-order walk goes back up to a parent between children.
    const walk = (n: TreeNode) => {
      reads.push(n.id);
      for (let i = 0; i <= n.keys.length; i++) {
        const left = i === 0 ? -Infinity : n.keys[i - 1];
        const right = i === n.keys.length ? Infinity : n.keys[i];
        if (n.children[i] && right >= lo && left <= hi) {
          walk(n.children[i]);
          if (i < n.keys.length) reads.push(n.id);
        }
        if (i < n.keys.length && n.keys[i] >= lo && n.keys[i] <= hi) keys.push(n.keys[i]);
      }
    };
    walk(this.root);
    return { reads, keys };
  }

  stats(): Stats {
    let pages = 0;
    let held = 0;
    const leaves: number[] = [];
    const walk = (n: TreeNode, depth: number) => {
      pages++;
      if (this.isLeaf(n) || this.kind === "btree") held += n.keys.length;
      if (this.isLeaf(n)) leaves.push(depth);
      n.children.forEach((c) => walk(c, depth + 1));
    };
    walk(this.root, 1);
    let used = 0;
    const count = (n: TreeNode) => {
      used += n.keys.length;
      n.children.forEach(count);
    };
    count(this.root);
    return { height: Math.max(...leaves), pages, keys: held, fill: used / (pages * this.max) };
  }
}

export interface Placed {
  node: TreeNode;
  x: number;
  y: number;
  width: number;
}

const CELL = 30;
const GAP = 14;
const LEVEL = 66;

/** Lays a tree out: leaves side by side, each parent centred over its children. */
export function layout(tree: Tree): { placed: Placed[]; width: number; height: number } {
  const placed: Placed[] = [];
  let cursor = 0;
  let depth = 0;
  const walk = (n: TreeNode, level: number): Placed => {
    depth = Math.max(depth, level);
    const width = Math.max(1, tree.max) * CELL;
    if (n.children.length === 0) {
      const p = { node: n, x: cursor, y: level * LEVEL, width };
      cursor += width + GAP;
      placed.push(p);
      return p;
    }
    const kids = n.children.map((c) => walk(c, level + 1));
    const center = (kids[0].x + kids[kids.length - 1].x + kids[kids.length - 1].width) / 2;
    const p = { node: n, x: center - width / 2, y: level * LEVEL, width };
    placed.push(p);
    return p;
  };
  walk(tree.root, 0);
  return { placed, width: Math.max(cursor - GAP, tree.max * CELL), height: (depth + 1) * LEVEL - 26 };
}

export const CELL_WIDTH = CELL;
