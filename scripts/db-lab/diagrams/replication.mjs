import { AMBER, GREEN, INK, MUTED } from "../canvas.mjs";

const post = {
  slug: "db-replication-and-cap",
  diagrams: {
    "primary-standby": {
      alt: "Primary and standby replication. All writes go to the primary, which streams its write-ahead log over TCP to the standbys, which replay it. Reads can go to the primary or to any standby.",
      draw(c) {
        c.size(720, 280).title("One primary, read-only copies");
        const app = c.box(20, 110, 120, 60, "application", { tone: "plain" });
        const p = c.box(230, 110, 140, 60, "primary", { tone: "amber", lines: "takes all writes" });
        c.box(520, 50, 170, 60, "standby 1", { tone: "cream", lines: "read-only, replays WAL" });
        c.box(520, 170, 170, 60, "standby 2", { tone: "cream", lines: "read-only, replays WAL" });
        c.arrow(app.right, p.left, { color: AMBER, label: "writes" });
        c.arrow([370, 126], [518, 86], { color: GREEN, label: "WAL stream", labelDy: -12, labelDx: -14 });
        c.arrow([370, 154], [518, 194], { color: GREEN, label: "WAL stream", labelDy: 22, labelDx: -14 });
        c.para(20, 262, "Reads can go to the primary or to any standby.", { width: 680, size: 12, weight: 700, fill: MUTED });
        c.flow("application", "primary", "writes", "request");
        c.flow("primary", "standby 1", "WAL stream", "data");
        c.flow("primary", "standby 2", "WAL stream", "data");
      },
    },

    "sync-vs-async": {
      alt: "Two commit timelines. In asynchronous replication the primary replies to the client as soon as its own log is safe, and the standby receives the change later, so a read there can be stale. In synchronous replication the primary waits for the standby before replying, so every commit pays a network round trip.",
      draw(c) {
        c.size(720, 300).title("When does the client get its reply?");
        const lane = (y, name, ack) => {
          c.text(20, y + 16, name, { size: 12.5, weight: 700 });
          c.box(150, y, 120, 30, "commit locally", { tone: "cream", size: 10.5 });
          if (ack === "early") {
            c.box(280, y, 110, 30, "reply", { tone: "green", size: 11 });
            c.box(480, y, 170, 30, "standby gets it later", { tone: "red", size: 10.5 });
          } else {
            c.box(280, y, 170, 30, "standby gets it", { tone: "neutral", size: 10.5 });
            c.box(460, y, 110, 30, "reply", { tone: "green", size: 11 });
          }
        };
        lane(62, "Asynchronous", "early");
        c.para(150, 110, "Fast, and the standby can lag. If the primary dies now, that commit is gone.", { width: 520 });
        lane(164, "Synchronous", "late");
        c.para(150, 212, "Every commit pays a round trip. If the standby is unreachable, commits wait.", { width: 520 });
      },
    },

    "cap-choices": {
      alt: "The CAP choices for a primary with replicas during a network partition. Reply right away and the system stays available but stale reads are possible. Wait for the replica and the data stays consistent but writes hang or fail. A single server has no partition to tolerate, so it's both consistent and available until it fails.",
      draw(c) {
        c.size(720, 270).title("When the network splits, pick one");
        const cols = [
          ["AP: stay available", "green", "Keep accepting writes and answering reads, knowing some reads are stale.", "async replication, caches"],
          ["CP: stay consistent", "amber", "Refuse or hold writes until the copies agree, so clients wait or fail.", "sync replication"],
          ["CA: no partition", "neutral", "One machine has no network between copies to fail, until the machine itself fails.", "a single big server"],
        ];
        cols.forEach(([name, tone, line, ex], i) => {
          const x = 20 + i * 232;
          c.box(x, 60, 216, 48, name, { tone, size: 13 });
          c.para(x + 4, 132, line, { width: 208, size: 12, fill: INK });
          c.para(x + 4, 214, ex, { width: 208, size: 11, fill: MUTED, weight: 700 });
        });
      },
    },

    "summary-map": {
      alt: "A map of this post in three columns. Replication: a primary streams its log to standbys, which are read-only. Sync or async: wait for the copy or don't, and each has a measured price. CAP: during a partition choose between stale answers and no answers.",
      draw(c) {
        c.size(720, 260).title("The post on one page");
        const cols = [
          ["Replication", "cream", ["One primary takes writes", "WAL streams to standbys", "Standbys are read-only"]],
          ["Sync or async", "amber", ["Async: lag, and lost commits", "Sync: slower, can hang", "Read your writes needs care"]],
          ["CAP", "green", ["C here means latest data", "P is a network split", "Choose stale or unavailable"]],
        ];
        cols.forEach(([name, tone, items], i) => {
          const x = 20 + i * 230;
          c.box(x, 56, 220, 44, name, { tone, size: 13.5 });
          items.forEach((t, j) => c.box(x, 108 + j * 42, 220, 36, "", { tone: "plain", lines: t, small: 11 }));
        });
      },
    },
  },
};

export default post;
