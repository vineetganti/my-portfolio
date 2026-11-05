import { FAINT, INK, MUTED, RED } from "../canvas.mjs";

const post = {
  slug: "db-postgres-mysql-internals",
  diagrams: {
    "process-model": {
      alt: "Postgres's process model. The postmaster listens and forks one backend process per client connection. All backends share memory, including shared buffers and the WAL buffers. Background processes write pages, write the log, checkpoint and vacuum.",
      draw(c) {
        c.size(720, 320).title("A process per connection, and shared memory");
        const client = c.box(20, 62, 110, 48, "client", { tone: "plain" });
        const post = c.box(190, 62, 130, 48, "postmaster", { tone: "amber", lines: "listens, forks" });
        c.box(380, 40, 130, 40, "backend", { tone: "cream", size: 11.5 });
        c.box(380, 92, 130, 40, "backend", { tone: "cream", size: 11.5 });
        c.arrow(client.right, post.left, { label: "connect" });
        c.arrow([320, 78], [378, 60]);
        c.arrow([320, 94], [378, 112]);
        c.box(190, 160, 510, 56, "shared memory", { tone: "green", lines: "shared buffers, WAL buffers, locks" });
        c.arrow([445, 132], [445, 158], { both: true });
        const names = ["checkpointer", "background writer", "WAL writer", "autovacuum", "io workers"];
        names.forEach((n, i) => c.box(190 + i * 103, 240, 97, 44, n, { tone: "raised", size: 10 }));
        c.line([445, 216], [445, 240], { color: FAINT });
        c.flow("client", "postmaster", "connect", "request");
      },
    },

    "uber-update": {
      alt: "Why updates cost Postgres more in Uber's account. In Postgres an update writes a new row version at a new address, so every index needs a new entry, unless the update is heap-only. In InnoDB secondary indexes hold the primary key, so an update to a column they don't cover touches only the primary key tree.",
      draw(c) {
        c.size(720, 280).title("One update, and who has to know");
        c.text(20, 56, "Postgres", { size: 13, weight: 700 });
        c.box(20, 72, 130, 52, "new row version", { tone: "green", lines: "new address" });
        ["index 1", "index 2", "index 3"].forEach((n, i) => {
          const b = c.box(220, 62 + i * 44, 120, 36, n, { tone: "red", size: 11.5 });
          c.arrow([150, 98], b.left, { color: RED, width: 1.2 });
        });
        c.para(20, 218, "Every index holds an address, so each may need a new entry. HOT avoids this when no indexed column changed and the page has room.", { width: 330, size: 12, fill: INK });
        c.text(380, 56, "InnoDB", { size: 13, weight: 700 });
        c.box(380, 72, 130, 52, "primary key tree", { tone: "green", lines: "row changed in place" });
        ["index 1", "index 2", "index 3"].forEach((n, i) => {
          c.box(580, 62 + i * 44, 120, 36, n, { tone: "plain", size: 11.5 });
        });
        c.para(380, 218, "Secondary indexes hold the primary key, which didn't change, so they're left alone. The old value goes to the undo log.", { width: 320, size: 12, fill: INK });
        c.line([362, 44], [362, 270], { color: FAINT, dash: "3 4" });
      },
    },

    "redo-undo": {
      alt: "Redo and undo. Redo records describe how to reapply a change, and rebuild committed work after a crash. Undo records describe how to reverse a change, and provide old versions for readers and rollback. InnoDB has both. Postgres has only redo, because old row versions stay in the table itself.",
      draw(c) {
        c.size(720, 260).title("Redo goes forward, undo goes back");
        c.box(20, 60, 330, 56, "redo (the WAL)", { tone: "green", lines: "How to repeat a change" });
        c.box(370, 60, 330, 56, "undo", { tone: "amber", lines: "How to reverse a change" });
        c.para(24, 142, "Replayed after a crash, to rebuild committed work. Also what replication ships.", { width: 320, size: 12, fill: INK });
        c.para(374, 142, "Used for rollback, and to give old snapshots an older version of a row.", { width: 320, size: 12, fill: INK });
        c.para(20, 208, "InnoDB has both. Postgres has no undo log: old versions stay in the table until VACUUM removes them, so rollback is free, and bloat is the cost.", { width: 680, size: 12, weight: 700, fill: MUTED });
      },
    },

    "two-phase-commit": {
      alt: "Two-phase commit across two databases. In phase one the coordinator asks each to prepare, and each writes its changes durably and votes yes. In phase two the coordinator tells both to commit. If the coordinator dies between the phases, the participants hold their locks until it returns.",
      draw(c) {
        c.size(720, 260).title("Two-phase commit");
        c.box(20, 90, 130, 64, "coordinator", { tone: "amber" });
        c.box(560, 40, 140, 60, "database A", { tone: "cream" });
        c.box(560, 150, 140, 60, "database B", { tone: "cream" });
        c.arrow([150, 108], [558, 66], { label: "1. PREPARE, then 2. COMMIT", both: true, labelDy: -14, labelAt: 0.42 });
        c.arrow([150, 136], [558, 174], { both: true });
        c.para(20, 222, "Between the phases each database has promised to commit, and holds its locks until told. That's the protocol's weak spot.", { width: 680, size: 12, fill: INK });
        c.flow("coordinator", "database A", "1. PREPARE, then 2. COMMIT", "request");
        c.flow("coordinator", "database B", "1. PREPARE, then 2. COMMIT", "request");
      },
    },

    "summary-map": {
      alt: "A map of this post in four columns. Processes: a process per connection, shared memory, background workers. Durability: WAL, checkpoints, redo and undo. MVCC: row versions, HOT, vacuum and bloat. Everyday costs: NULLs, SELECT star, and transactions across databases.",
      draw(c) {
        c.size(720, 280).title("The post on one page");
        const cols = [
          ["Processes", "cream", ["A process per connection", "Shared buffers", "Background workers"]],
          ["The log", "green", ["WAL first, pages later", "Checkpoints bound recovery", "Redo and undo differ"]],
          ["MVCC", "amber", ["Updates add versions", "HOT skips the indexes", "VACUUM pays the bill"]],
          ["Everyday costs", "raised", ["NULL breaks NOT IN", "SELECT * reads it all", "2PC locks across servers"]],
        ];
        cols.forEach(([name, tone, items], i) => {
          const x = 20 + i * 172;
          c.box(x, 56, 164, 44, name, { tone, size: 13 });
          items.forEach((t, j) => c.box(x, 108 + j * 40, 164, 34, "", { tone: "plain", lines: t, small: 10.5 }));
        });
      },
    },
  },
};

export default post;
