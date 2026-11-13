import { GREEN, MUTED, RED } from "../../db-lab/canvas.mjs";
import { summaryMap } from "./_shared.mjs";

const post = {
  slug: "site-generated-content",
  diagrams: {
    "sql-bank": {
      alt: "How a SQL practice post is generated. A Python spec holds each question's sample tables, answer and explanation. build.py creates a fresh in-memory DuckDB database per question, runs the setup and the answer, and runs a re-runnable answer twice to prove it is idempotent. From the real results it writes the post's MDX and a JSON file of trace steps that the DataTrace component reads.",
      draw(c) {
        c.size(720, 280).title("No output in the SQL posts is typed by hand");
        const spec = c.box(20, 60, 140, 60, "posts/pN_*.py", { tone: "plain", lines: "question specs", mono: true, size: 11.5 });
        const duck = c.box(210, 60, 150, 60, "DuckDB", { tone: "amber", lines: "fresh database each" });
        const mdx = c.box(420, 40, 130, 50, "<slug>.mdx", { tone: "raised", mono: true, size: 11.5 });
        const trace = c.box(420, 110, 130, 50, "<slug>.json", { tone: "raised", lines: "trace steps", mono: true, size: 11.5 });
        const comp = c.box(590, 110, 110, 50, "DataTrace", { tone: "green" });
        c.arrow(spec.right, duck.left);
        c.arrow([360, 80], [418, 65]);
        c.arrow([360, 100], [418, 135]);
        c.arrow(trace.right, comp.left);
        c.box(210, 160, 150, 50, "rerun=True", { tone: "red", lines: "run twice, must match", mono: true, size: 11.5 });
        c.arrow([285, 120], [285, 158], { color: RED });
        c.para(20, 236, "Re-run on 2026-11-13: 92 questions in 5 seconds, and git showed no file changed.", { width: 680, fill: MUTED, weight: 700 });
        c.flow("posts/pN_*.py", "DuckDB", "", "data");
        c.flow("DuckDB", "<slug>.mdx", "", "data");
        c.flow("DuckDB", "<slug>.json", "", "data");
        c.flow("<slug>.json", "DataTrace", "", "data");
        void mdx;
      },
    },

    "db-harness": {
      alt: "How the Database Engineering recordings are made. A spec describes sessions and steps. record.mjs starts the engines in Docker: PostgreSQL, MySQL, MongoDB, Redis and Memcached. Each session is a real connection, and a step that blocks is recorded with the step that released it. The results go to content/db-lab as JSON, and every live box is also checked on PGlite before anything is written.",
      draw(c) {
        c.size(720, 300).title("Recordings from real engines, replayed by components");
        const spec = c.box(20, 110, 130, 60, "specs/*.mjs", { tone: "plain", lines: "sessions, steps", mono: true, size: 11.5 });
        const rec = c.box(190, 110, 130, 60, "record.mjs", { tone: "amber", lines: "one run per item", mono: true, size: 11.5 });
        const engines = ["PostgreSQL 18", "MySQL 8.4", "MongoDB 8", "Redis 8", "Memcached"];
        engines.forEach((e, i) => c.box(360, 40 + i * 44, 140, 36, e, { tone: "neutral", size: 11.5 }));
        c.text(430, 268, "Docker, real connections", { size: 10.5, fill: MUTED, anchor: "middle" });
        const json = c.box(540, 80, 160, 56, "content/db-lab", { tone: "green", lines: "JSON per post" });
        const comps = c.box(540, 170, 160, 56, "TxnTheater, Ran", { tone: "raised", lines: "LabChart, PgPlayground" });
        c.arrow(spec.right, rec.left);
        c.arrow([320, 130], [358, 58]);
        c.arrow([320, 150], [358, 234]);
        c.arrow([500, 140], [538, 108], { color: GREEN });
        c.arrow(json.bottom, comps.top);
        c.flow("specs/*.mjs", "record.mjs", "", "data");
        c.flow("content/db-lab", "TxnTheater, Ran", "", "data");
      },
    },

    "blocked-step": {
      alt: "How a blocked statement is recorded. Session A updates a row and holds its lock. Session B tries to update the same row and blocks. The recorder does not wait for B: it records B as waiting, moves on, and when session A commits it notes that B returned at that step, with B's real result. The theater replays it the same way.",
      draw(c) {
        c.size(720, 250).title("A blocked statement is recorded as waiting, then released");
        c.text(130, 58, "Session A", { size: 12, weight: 700, anchor: "middle" });
        c.text(430, 58, "Session B", { size: 12, weight: 700, anchor: "middle" });
        const rows = [
          ["UPDATE row 1", "", "plain", null],
          ["", "UPDATE row 1", null, "amber"],
          ["COMMIT", "…waiting", "green", "neutral"],
          ["", "returns: UPDATE 1", null, "green"],
        ];
        rows.forEach(([a, b, ta, tb], i) => {
          const y = 66 + i * 40;
          c.text(20, y + 22, `step ${i + 1}`, { size: 10.5, fill: MUTED });
          if (a) c.box(70, y, 120, 32, a, { tone: ta, size: 11, mono: true });
          if (b) c.box(370, y, 150, 32, b, { tone: tb, size: 11, mono: true });
        });
        c.arrow([190, 162], [368, 182], { color: GREEN, label: "releases", labelDy: -4 });
        c.para(560, 80, "The recorder notes which step released B, so the replay shows the wait and the moment it ends.", { width: 150, size: 10.5 });
      },
    },

    "summary-map": {
      alt: "A map of the generated-content post. SQL bank: specs, DuckDB, real outputs and traces. Database harness: Docker engines and real sessions, recorded to JSON. Components: replay recordings without a database. Rules: prose numbers are re-checked after any re-run.",
      draw(c) {
        summaryMap(
          c,
          "Content generated from real runs",
          [
            { name: "SQL bank", lines: ["Python specs", "DuckDB per question", "MDX + traces"] },
            { name: "DB harness", lines: ["5 engines in Docker", "real sessions", "JSON recordings"] },
            { name: "Components", lines: ["DataTrace", "TxnTheater, Ran", "LabChart"] },
            { name: "Rule", lines: ["never type an output", "re-run, then re-read", "prose quotes the run"] },
          ],
          "A number in these posts comes from a run that can be repeated, not from memory.",
        );
      },
    },
  },
};

export default post;
