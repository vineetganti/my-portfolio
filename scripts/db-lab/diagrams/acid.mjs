import { AMBER, FAINT, GREEN, MUTED, RED } from "../canvas.mjs";

const post = {
  slug: "db-acid-transactions",
  diagrams: {
    "transaction-lifespan": {
      alt: "The life of a transaction. BEGIN opens it, then a SELECT checks the balance and two UPDATEs move 100 from account 1 to account 2. COMMIT makes all of it permanent together. Any error or crash along the way leads to ROLLBACK instead, which leaves the data as if the transaction never ran.",
      draw(c) {
        c.size(720, 270).title("One transaction: send 100 from account 1 to account 2");
        const b = c.box(20, 70, 90, 56, "BEGIN", { tone: "cream" });
        const s = c.box(146, 70, 130, 56, "SELECT", { lines: "balance > 100?" });
        const u1 = c.box(312, 70, 130, 56, "UPDATE", { lines: "account 1 - 100" });
        const u2 = c.box(478, 70, 130, 56, "UPDATE", { lines: "account 2 + 100" });
        c.arrow(b.right, s.left);
        c.arrow(s.right, u1.left);
        c.arrow(u1.right, u2.left);
        const ok = c.box(478, 180, 130, 56, "COMMIT", { tone: "green", lines: "all three stick" });
        c.box(146, 180, 180, 56, "ROLLBACK", { tone: "red", lines: "as if none of it ran" });
        c.arrow(u2.bottom, ok.top, { color: GREEN, label: "all worked", labelDy: 4, labelDx: 38 });
        c.route([[211, 126], [211, 178]], { color: RED });
        c.route([[377, 126], [377, 150], [300, 150], [300, 178]], { color: RED });
        c.text(388, 160, "any error, or a crash", { size: 11, weight: 700, fill: RED });
      },
    },

    "acid-map": {
      alt: "The four ACID properties as four cards. Atomicity: all or nothing, broken by a crash halfway, provided by rollback and the log. Consistency: only valid states, broken by rule violations, provided by constraints you define. Isolation: concurrent transactions don't see each other's work in progress, broken by read phenomena, provided by locks and snapshots. Durability: committed means safe, broken by a crash after commit, provided by the write-ahead log and fsync.",
      draw(c) {
        c.size(720, 280).title("Four promises, and what each one protects you from");
        const cards = [
          ["Atomicity", "All of it or none of it", "a crash halfway through a transfer", "rollback, the log", "amber"],
          ["Consistency", "Only valid states", "a row that breaks your rules", "constraints you define", "green"],
          ["Isolation", "Others' work in progress stays hidden", "reports that don't add up", "snapshots and locks", "cream"],
          ["Durability", "Committed means safe", "a power cut just after COMMIT", "write-ahead log, fsync", "raised"],
        ];
        cards.forEach(([name, promise, threat, how, tone], i) => {
          const x = 20 + i * 172;
          c.box(x, 62, 164, 84, name, { tone, lines: promise, size: 14, small: 11 });
          c.text(x + 4, 170, "protects against", { size: 10.5, fill: FAINT });
          c.para(x + 4, 186, threat, { width: 156, size: 11.5 });
          c.text(x + 4, 232, "made of", { size: 10.5, fill: FAINT });
          c.para(x + 4, 248, how, { width: 156, size: 11.5, weight: 700 });
        });
      },
    },

    snapshots: {
      alt: "Two timelines of the same report. At read committed each statement takes a fresh snapshot, so the second statement sees a change committed in between. At repeatable read the first statement takes the snapshot and the second reuses it, so the committed change stays invisible until the transaction ends.",
      draw(c) {
        c.size(720, 300).title("When is the snapshot taken?");
        const lane = (y, label, second, tone) => {
          c.text(20, y + 24, label, { size: 12.5, weight: 700 });
          c.rect(150, y + 6, 500, 28, { tone: "raised", rx: 6 });
          c.text(160, y + 24, "BEGIN", { size: 10.5, fill: MUTED });
          c.text(640, y + 24, "COMMIT", { size: 10.5, fill: MUTED, anchor: "end" });
          c.box(230, y + 44, 120, 42, "statement 1", { tone: "cream", lines: "snapshot A", size: 11.5 });
          c.box(470, y + 44, 120, 42, "statement 2", { tone, lines: second, size: 11.5 });
          c.line([290, y + 6], [290, y + 44], { color: AMBER, width: 1.5 });
          c.line([530, y + 6], [530, y + 44], { color: tone === "red" ? RED : GREEN, width: 1.5 });
        };
        lane(56, "Read committed", "fresh snapshot B", "red");
        lane(176, "Repeatable read", "reuses snapshot A", "green");
        c.box(346, 148, 128, 28, "", { tone: "neutral" });
        c.text(410, 166, "another session commits", { size: 10, weight: 700, anchor: "middle" });
        c.line([410, 34], [410, 280], { color: FAINT, dash: "3 4" });
      },
    },

    "row-versions": {
      alt: "How Postgres keeps two versions of one row. Version one has xmin 100 and xmax 105, with quantity 2. Version two has xmin 105 and xmax 0, with quantity 7. A transaction whose snapshot was taken before transaction 105 committed sees version one. A transaction that started after sees version two. Nobody copied the table: the old version is simply still there.",
      draw(c) {
        c.size(720, 270).title("A snapshot isn't a copy: old row versions are still there", "Every row version records which transaction made it (xmin) and which ended it (xmax).");
        const v1 = c.box(250, 70, 220, 60, "version 1: quantity 2", { tone: "neutral", lines: "xmin 100, xmax 105" });
        const v2 = c.box(250, 170, 220, 60, "version 2: quantity 7", { tone: "green", lines: "xmin 105, xmax 0 (still live)" });
        c.arrow(v1.bottom, v2.top, { label: "UPDATE by transaction 105", labelDy: 4, labelDx: 88, labelFill: MUTED });
        const old = c.box(20, 70, 170, 60, "report started early", { tone: "cream", lines: "105 not committed in its snapshot" });
        const fresh = c.box(530, 170, 170, 60, "report started later", { tone: "cream", lines: "105 committed in its snapshot" });
        c.arrow(old.right, v1.left, { color: AMBER, label: "sees", labelDy: -6 });
        c.arrow(fresh.left, v2.right, { color: AMBER, label: "sees", labelDy: -6 });
      },
    },

    "durability-path": {
      alt: "The path of a commit. The client sends COMMIT to the server, the server writes the change to the write-ahead log file through the operating system cache, and an fsync forces it onto the disk. Only then does the client get its acknowledgement. The table's data pages change in memory and reach the disk later, at a checkpoint. After a crash the log replays what the data files missed.",
      draw(c) {
        c.size(720, 300).title("What has to happen before COMMIT returns");
        const client = c.box(20, 80, 110, 60, "client", { tone: "plain" });
        const server = c.box(190, 80, 130, 60, "server", { tone: "cream", lines: "shared memory" });
        const cache = c.box(380, 80, 130, 60, "OS page cache", { tone: "neutral", lines: "still only RAM" });
        const wal = c.box(570, 80, 130, 60, "WAL on disk", { tone: "green", lines: "survives power loss" });
        c.box(380, 210, 130, 60, "data files", { tone: "raised", lines: "catch up later" });
        c.arrow(client.right, server.left, { label: "COMMIT" });
        c.arrow(server.right, cache.left, { label: "write" });
        c.arrow(cache.right, wal.left, { color: GREEN, label: "fsync" });
        c.route([[635, 142], [635, 170], [255, 170], [255, 142]], { color: GREEN, dash: "6 4", label: "durable: safe to reply", labelAt: [445, 170], labelDy: -5 });
        c.route([[255, 142], [255, 240], [378, 240]], { color: MUTED, dash: "2 4", label: "checkpoint, later", labelAt: [316, 240], labelDy: -6 });
        c.flow("client", "server", "COMMIT", "request");
        c.flow("server", "OS page cache", "write", "data");
        c.flow("OS page cache", "WAL on disk", "fsync", "data");
      },
    },

    "summary-map": {
      alt: "A map of this post in four columns. Transactions: begin, commit, rollback; a crash means rollback; one failure aborts the whole transaction. Isolation: four phenomena, four levels, snapshots from row versions, write skew needs serializable or locks. Consistency: rules you declare, and reads that may lag. Durability: the log reaches disk before the reply, and async commit trades safety for speed.",
      draw(c) {
        c.size(720, 280).title("The post on one page");
        const cols = [
          ["Transactions", "cream", ["One unit of work", "Crash means rollback", "One failure aborts the rest"]],
          ["Isolation", "amber", ["Four read phenomena", "Levels pick which you allow", "Snapshots are row versions", "Write skew: serializable or locks"]],
          ["Consistency", "green", ["Rules you declare", "Constraints enforce them", "Reads can lag: see post 9"]],
          ["Durability", "raised", ["Log first, then reply", "fsync beats the OS cache", "Async commit trades safety for speed"]],
        ];
        cols.forEach(([name, tone, items], i) => {
          const x = 20 + i * 172;
          c.box(x, 56, 164, 44, name, { tone, size: 13.5 });
          items.forEach((t, j) => c.box(x, 108 + j * 40, 164, 34, "", { tone: "plain", lines: t, small: 10.5 }));
        });
      },
    },
  },
};

export default post;
