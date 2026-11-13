import { AMBER, FAINT, GREEN, MUTED, RED } from "../../db-lab/canvas.mjs";
import { summaryMap } from "./_shared.mjs";

const post = {
  slug: "second-brain-pipeline",
  diagrams: {
    pipeline: {
      alt: "The Second brain pipeline end to end. Sources: Gmail newsletters through an allowlist, RSS and Atom feeds, sitemaps and listing pages, NITI PDFs and SEC EDGAR filings. Parse: HTML to text, tracking links unwrapped or resolved, paywalled stories dropped. Triage: claude -p with no tools and a JSON schema scores each document. SQLite stores items, the seen-set and the owner's labels. The local curator page collects ratings. nb publish signs the public files, and the upload script sends them to the website.",
      draw(c) {
        c.size(720, 330).title("From a newsletter to a signed public file");
        const src = [["Gmail", "allowlist"], ["RSS / Atom", "feeds by topic"], ["sitemaps, pages", "watched"], ["NITI, EDGAR", "PDFs, filings"]];
        src.forEach(([n, l], i) => c.box(20, 46 + i * 62, 130, 52, n, { tone: "plain", lines: l, size: 12 }));
        const parse = c.box(190, 120, 120, 60, "parse", { tone: "raised", lines: "text, links, paywall" });
        const triage = c.box(350, 120, 120, 60, "triage", { tone: "amber", lines: "claude -p, no tools" });
        const store = c.box(510, 120, 120, 60, "SQLite", { tone: "neutral", lines: "items, labels" });
        c.box(510, 220, 120, 54, "nb brief", { tone: "cream", lines: "rate on localhost" });
        c.box(350, 220, 120, 54, "nb publish", { tone: "green", lines: "whitelist + sign" });
        c.box(190, 220, 120, 54, "upload", { tone: "raised", lines: "to Vercel Blob" });
        [72, 134, 196, 258].forEach((y) => c.arrow([150, y], [188, 150]));
        c.arrow(parse.right, triage.left);
        c.arrow(triage.right, store.left);
        c.arrow([570, 180], [570, 218], { both: true });
        c.arrow([508, 247], [472, 247]);
        c.arrow([348, 247], [312, 247]);
        c.para(640, 120, "The website only ever sees what was signed.", { width: 75, size: 10.5 });
        c.flow("parse", "triage", "", "data");
        c.flow("triage", "SQLite", "", "metadata");
        c.flow("SQLite", "nb brief", "", "data");
        c.flow("nb publish", "upload", "", "data");
        void store;
      },
    },

    "agent-loop": {
      alt: "The working loop behind this project, as the build log shows it. The owner asks for something in the chat. Claude Code, the agent, reads files, runs commands and edits code through tools, and each tool result goes back into its context before the next step. Some actions need the owner: running live Gmail fetches, approving installs into the global Python, and making the signing key. The loop ends with tests run and an entry written to the build log.",
      draw(c) {
        c.size(720, 320).title("The agent loop, and where the human sits in it");
        const ask = c.box(20, 120, 130, 60, "owner asks", { tone: "plain", lines: "goal, decisions" });
        const model = c.box(210, 120, 140, 60, "Claude Code", { tone: "amber", lines: "plans the next step" });
        const tool = c.box(420, 50, 160, 56, "tool call", { tone: "raised", lines: "Read, Bash, Edit, Write" });
        const result = c.box(420, 190, 160, 56, "tool result", { tone: "neutral", lines: "into the context" });
        c.arrow(ask.right, model.left);
        c.arrow([350, 130], [418, 80], { color: AMBER });
        c.arrow(tool.bottom, result.top);
        c.arrow([418, 216], [350, 170], { color: AMBER, label: "next step", labelDy: 18, labelAt: 0.35 });
        c.box(610, 50, 100, 56, "owner", { tone: "green", lines: "runs live fetch" });
        c.box(610, 190, 100, 56, "tests + log", { tone: "cream", lines: "then report" });
        c.arrow([580, 78], [608, 78], { color: GREEN, both: true });
        c.arrow([580, 218], [608, 218]);
        c.para(20, 270, "Private mail was fetched by the owner, not the agent, so it never entered the agent's context; installs outside the project's venv were run only after the owner approved them.", { width: 680, fill: MUTED });
        c.flow("owner asks", "Claude Code", "", "request");
        c.flow("Claude Code", "tool call", "", "request");
        c.flow("tool call", "tool result", "", "data");
        c.flow("tool result", "Claude Code", "next step", "data");
        void model;
        void result;
      },
    },

    "quota-before-after": {
      alt: "The first real failure, before and after. Before: the fetch asked Gmail for every email from the last day and fetched each one in full, back to back. A full fetch costs 60 quota units and the limit is 6,000 units per user per minute, so the run hit 403 rateLimitExceeded after 103 messages. After: a sender allowlist narrows the search at Gmail, each fetch is followed by a 0.7-second pause, about 5,100 units a minute, and a rate-limit error is retried with exponential backoff and jitter.",
      draw(c) {
        c.size(720, 270).title("Before and after: Gmail's per-minute quota");
        c.text(20, 62, "Before", { size: 12.5, weight: 700, fill: RED });
        const b = [["newer_than:1d", "whole inbox"], ["get(format=full)", "60 units each"], ["no pause", "back to back"], ["403 at 103", "rateLimitExceeded"]];
        b.forEach(([n, l], i) => {
          c.box(20 + i * 172, 72, 150, 52, n, { tone: i === 3 ? "red" : "plain", lines: l, mono: i < 2, size: 11.5 });
          if (i) c.arrow([i * 172 - 2, 98], [18 + i * 172, 98], { color: RED });
        });
        c.text(20, 160, "After", { size: 12.5, weight: 700, fill: GREEN });
        const a = [["from:(allowlist)", "newsletters only"], ["0.7 s pause", "≈ 5,100 units/min"], ["backoff + jitter", "5, 10, 20 … 60 s"], ["11 emails, 7 days", "no errors"]];
        a.forEach(([n, l], i) => {
          c.box(20 + i * 172, 170, 150, 52, n, { tone: i === 3 ? "green" : "plain", lines: l, mono: i === 0, size: 11.5 });
          if (i) c.arrow([i * 172 - 2, 196], [18 + i * 172, 196], { color: GREEN });
        });
        c.text(20, 252, "6,000 units per user per minute ÷ 60 units per full message ≈ 100 messages a minute.", { size: 11, fill: FAINT });
      },
    },

    "triage-sandbox": {
      alt: "How an untrusted newsletter reaches the model. The document goes in on stdin, never on the command line. claude -p runs in an empty throwaway folder with all tools disabled, no settings, no MCP servers and no session saved. The output must match a JSON schema. API keys are removed from the environment so the subscription is used. Code then drops any item whose URL was not in the document. In the live test, a planted instruction to create a file and add a fake item had no effect.",
      draw(c) {
        c.size(720, 310).title("Treat every document as hostile input");
        const doc = c.box(20, 110, 130, 60, "document", { tone: "red", lines: "untrusted text" });
        c.rect(190, 50, 300, 190, { tone: "neutral", dash: "5 4" });
        c.text(206, 72, "empty throwaway folder", { size: 11.5, weight: 700, fill: MUTED });
        const cli = c.box(210, 110, 260, 60, "claude -p", { tone: "amber", lines: '--tools "" · --json-schema · stdin' });
        c.para(210, 196, "no settings, no MCP, no session saved, ANTHROPIC_API_KEY removed", { width: 260, size: 10.5 });
        const check = c.box(530, 110, 170, 60, "code checks", { tone: "green", lines: "schema, URL whitelist" });
        c.arrow(doc.right, cli.left, { color: RED, label: "stdin", labelDy: -10, labelAt: 0.3 });
        c.arrow(cli.right, check.left);
        c.para(20, 262, "Live test with a planted \"echo PWNED > pwned.txt\" and a fake HACKED item: no file created, no fake item. One test, not a proof.", { width: 680, fill: MUTED });
        c.flow("document", "claude -p", "stdin", "data");
        c.flow("claude -p", "code checks", "", "data");
      },
    },

    "save-bug": {
      alt: "The bug that reached the owner, before and after. Before: the store opened its SQLite connection on the main thread, Gradio ran the Save handler on a worker thread, and SQLite refused with a ProgrammingError, so no rating was stored. Unit tests passed because they ran on one thread. After: the connection allows other threads and a lock guards every write, and the check that matters was repeated through the real page: Saved 17 labels.",
      draw(c) {
        c.size(720, 260).title("Before and after: the Save button");
        c.text(20, 62, "Before", { size: 12.5, weight: 700, fill: RED });
        const b = [["main thread", "opens SQLite"], ["Gradio worker", "runs Save"], ["ProgrammingError", "other thread"], ["0 ratings saved", ""]];
        b.forEach(([n, l], i) => {
          c.box(20 + i * 172, 72, 150, 50, n, { tone: i >= 2 ? "red" : "plain", lines: l, size: 12 });
          if (i) c.arrow([i * 172 - 2, 97], [18 + i * 172, 97], { color: RED });
        });
        c.text(20, 158, "After", { size: 12.5, weight: 700, fill: GREEN });
        const a = [["check_same_thread", "False"], ["RLock", "around writes"], ["real page, real Save", "via a client"], ["Saved 17 labels", "matched"]];
        a.forEach(([n, l], i) => {
          c.box(20 + i * 172, 168, 150, 50, n, { tone: i === 3 ? "green" : "plain", lines: l, size: 12, mono: i === 0 });
          if (i) c.arrow([i * 172 - 2, 193], [18 + i * 172, 193], { color: GREEN });
        });
        c.text(20, 246, "The tests ran on one thread; the page did not. Test the user's action, not only the function.", { size: 11, fill: FAINT });
      },
    },

    "learning-loop": {
      alt: "How the model learns from the owner's ratings without fine-tuning. The owner rates items skip, good or top learning on the curator page. Once there are at least three good-or-top and three skip ratings, the four most recent of each are shown to the triage model as labelled examples, in the user message and never the system prompt, with each item's own rating hidden when it is re-scored. nb eval then measures agreement against gates written down in advance before automatic mode is allowed.",
      draw(c) {
        c.size(720, 280).title("Ratings become examples, examples are measured");
        const rate = c.box(20, 100, 130, 60, "ratings", { tone: "plain", lines: "skip · good · top" });
        const gate = c.box(190, 100, 140, 60, "≥ 3 and ≥ 3?", { tone: "raised", lines: "likes and skips" });
        const ex = c.box(370, 100, 150, 60, "examples", { tone: "amber", lines: "in the user message" });
        const tri = c.box(560, 100, 140, 60, "triage", { tone: "raised", lines: "own rating hidden" });
        const ev = c.box(370, 196, 150, 56, "nb eval", { tone: "green", lines: "gap, precision, recall" });
        c.arrow(rate.right, gate.left);
        c.arrow(gate.right, ex.left);
        c.arrow(ex.right, tri.left);
        c.arrow([630, 160], [522, 214]);
        c.route([[368, 224], [85, 224], [85, 162]], { color: GREEN, label: "gates before automatic", labelAt: [226, 224], labelDy: 16 });
        c.flow("ratings", "≥ 3 and ≥ 3?", "", "data");
        c.flow("≥ 3 and ≥ 3?", "examples", "", "data");
        c.flow("examples", "triage", "", "data");
        void ev;
        void MUTED;
      },
    },

    "crlf-before-after": {
      alt: "The bug CI caught on its first run, before and after. Before: on Windows, Python's write_text turned line feeds into CRLF, the publisher signed those exact bytes, git normalised the committed fixture to LF, and the Linux runner checked out LF bytes whose signature covered CRLF bytes, so three tests failed. After: every signed file is written with a plain line feed on every OS, and a gitattributes rule stops git rewriting the fixtures.",
      draw(c) {
        c.size(720, 260).title("Before and after: a signature over bytes that changed in transit");
        c.text(20, 62, "Before", { size: 12.5, weight: 700, fill: RED });
        const b = [["write_text", "CRLF on Windows"], ["sign", "CRLF bytes"], ["git stores LF", "autocrlf"], ["Linux: 3 fail", "bytes differ"]];
        b.forEach(([n, l], i) => {
          c.box(20 + i * 172, 72, 150, 50, n, { tone: i === 3 ? "red" : "plain", lines: l, size: 12, mono: i === 0 });
          if (i) c.arrow([i * 172 - 2, 97], [18 + i * 172, 97], { color: RED });
        });
        c.text(20, 158, "After", { size: 12.5, weight: 700, fill: GREEN });
        const a = [['newline="\\n"', "every OS"], ["sign", "LF bytes"], ["-text", ".gitattributes"], ["13 / 13 pass", "and a regression test"]];
        a.forEach(([n, l], i) => {
          c.box(20 + i * 172, 168, 150, 50, n, { tone: i === 3 ? "green" : "plain", lines: l, size: 12, mono: i === 0 || i === 2 });
          if (i) c.arrow([i * 172 - 2, 193], [18 + i * 172, 193], { color: GREEN });
        });
        c.text(20, 246, "Nothing was wrong with the signature code. A signature covers exact bytes, and git changed them.", { size: 11, fill: FAINT });
        void AMBER;
      },
    },

    "summary-map": {
      alt: "A map of the pipeline post. Ingest: an allowlist, feeds, sitemaps and page polls, polite and cached. Judge: claude -p with no tools, a schema and checks in code. Curate: ratings, labels that beat the model, Good reads. Publish: signed files, a merge into the site repo, and CI that caught a line-ending bug.",
      draw(c) {
        summaryMap(
          c,
          "The Second brain pipeline",
          [
            { name: "Ingest", lines: ["Gmail allowlist", "60+ sources", "watched pages", "polite, cached"] },
            { name: "Judge", lines: ["claude -p", "no tools", "JSON schema", "checks in code"] },
            { name: "Curate", lines: ["skip · good · top", "labels beat model", "Good reads shelf", "nb eval gates"] },
            { name: "Publish", lines: ["whitelist", "Ed25519 signatures", "monorepo + CI", "beta, manual"] },
          ],
          "Thirty-three log entries, 138 Python tests, and every dead end kept.",
        );
      },
    },
  },
};

export default post;
