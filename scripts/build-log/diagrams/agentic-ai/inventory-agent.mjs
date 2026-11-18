// Diagrams for content/blog/inventory-agent.mdx (Agentic AI).
//   node scripts/build-log/draw.mjs inventory-agent
import { GREEN, MUTED, RED } from "../../../db-lab/canvas.mjs";
import { summaryMap } from "../_shared.mjs";

const post = {
  slug: "inventory-agent",
  diagrams: {
    "two-ladders": {
      alt: "Two ladders to the same kind of agent, both by Shivank Agarwal. The bootcamp's eight steps build a planner from parts: 01 SQLite, 02 embeddings, 03 ChromaDB retrieval, 04 a first LLM chain, 05 a RAG chain, 06 a tool-calling loop, 07 a fixed multi-chain pipeline, 08 the full app with database, notes and tools. The lecture's eight versions grow one shop assistant by one idea each: v0 one prompt, v1 a web form, v2 a database, tools and an agent, v3 guardrails, v4 a cache, v5 an email action, v6 tracing, v7 a calculation tool. The first ladder teaches how an agent is built; the second, what a production-style one needs around it.",
      draw(c) {
        c.size(720, 400).title("Two ladders: build an agent, then build around it");
        c.text(20, 60, "Bootcamp module 4: the parts", { size: 12.5, weight: 700 });
        c.text(380, 60, "Lecture code: one idea per version", { size: 12.5, weight: 700 });
        const left = ["01 SQLite", "02 embeddings", "03 ChromaDB retrieval", "04 first LLM chain", "05 RAG chain", "06 tool-calling loop", "07 multi-chain pipeline", "08 full app: DB + RAG + tools"];
        const right = ["v0 one prompt", "v1 a web form", "v2 database + tools + agent", "v3 guardrails", "v4 a cache", "v5 an email action", "v6 tracing", "v7 a calculation tool"];
        left.forEach((n, i) => c.box(20, 70 + i * 36, 320, 30, n, { tone: i === 7 ? "green" : "plain", size: 11.5 }));
        right.forEach((n, i) => c.box(380, 70 + i * 36, 320, 30, n, { tone: i === 7 ? "green" : i >= 3 ? "amber" : "plain", size: 11.5 }));
        c.para(20, 370, "Amber: the production ideas that sit around the agent rather than inside it. Trip Buddy climbed a ladder like the left one.", { width: 680, fill: MUTED });
      },
    },

    "v7-flow": {
      alt: "How one question flows through v7. The message first meets the rule-based guardrail from v3, which blocks known attack phrases. Then the cache from v4 returns a saved answer for the same question within five minutes. Otherwise the agent from v2 calls the model, which calls tools that read the SQLite database, including v7's calculate_reorder_quantity, which does the maths in Python. The answer goes back to the user and is saved in the cache, and the whole question is one trace in LangSmith, from v6. The email alert from v5 is a separate button that a person presses.",
      draw(c) {
        c.size(720, 330).title("One question through v7");
        const q = c.box(20, 70, 110, 56, "question", { tone: "plain" });
        const g = c.box(160, 70, 120, 56, "guardrail (v3)", { tone: "red", lines: "keyword lists" });
        const k = c.box(310, 70, 120, 56, "cache (v4)", { tone: "cream", lines: "5-minute expiry" });
        const a = c.box(460, 70, 120, 56, "agent (v2)", { tone: "amber", lines: "model + prompt" });
        const t = c.box(610, 70, 90, 56, "tools", { tone: "green", lines: "DB, v7 maths" });
        c.arrow(q.right, g.left);
        c.arrow(g.right, k.left, { label: "safe", labelDy: -8 });
        c.arrow(k.right, a.left, { label: "miss", labelDy: -8 });
        c.arrow([580, 90], [608, 90]);
        c.arrow([608, 108], [580, 108]);
        c.box(160, 160, 120, 44, "refusal", { tone: "red", size: 12 });
        c.box(310, 160, 120, 44, "saved answer 🔄", { tone: "cream", size: 12 });
        c.arrow([220, 126], [220, 158]);
        c.arrow([370, 126], [370, 158]);
        c.box(20, 236, 680, 40, "the whole question is one trace in LangSmith (v6)", { tone: "neutral", size: 12 });
        c.box(460, 160, 240, 44, "email alert (v5): a person presses it", { tone: "plain", size: 11.5 });
        c.para(20, 292, "The guardrail and the cache cost nothing; only a cache miss reaches the model.", { width: 680, fill: MUTED });
        c.flow("question", "guardrail (v3)", "", "request");
        c.flow("guardrail (v3)", "cache (v4)", "safe", "request");
        c.flow("cache (v4)", "agent (v2)", "miss", "request");
        void q;
        void g;
        void k;
        void a;
        void t;
      },
    },

    "rule-and-tool": {
      alt: "Before and after for 'Should I reorder toothpaste?' with 20 in stock, 5 sold a day and a 4-day lead time. In v0 the prompt gives the numbers but not the shop's reorder rule: Groq answered 'reorder 20 units', Claude suggested about 100 units with a reorder point of 30, a reasonable answer to a different rule. In v7 the system prompt states the rule, and calculate_reorder_quantity does the maths in Python: both providers answered 'order at least 20 units now'.",
      draw(c) {
        c.size(720, 300).title("Before and after: say the rule, and let code do the maths");
        c.text(20, 62, "v0: numbers, no rule", { size: 12.5, weight: 700, fill: RED });
        c.text(380, 62, "v7: rule in the prompt + a calculator tool", { size: 12.5, weight: 700, fill: GREEN });
        c.box(20, 72, 320, 56, "Groq gpt-oss-20b", { tone: "plain", lines: "'reorder 20 units'" });
        c.box(20, 140, 320, 56, "Claude Haiku 5.5", { tone: "red", lines: "'about 100 units, reorder point 30'" });
        c.box(380, 72, 320, 56, "Groq gpt-oss-20b", { tone: "green", lines: "'order at least 20 units'" });
        c.box(380, 140, 320, 56, "Claude Haiku 5.5", { tone: "green", lines: "'order at least 20 units now'" });
        c.para(20, 222, "20 in stock ÷ 5 a day = 4 days, equal to the 4-day lead time, so reorder demand × lead time = 20. Claude's v0 answer wasn't wrong arithmetic: it answered with its own, more cautious policy, because nobody told it the shop's.", { width: 680, fill: MUTED });
      },
    },

    "first-match": {
      alt: "Why 'Should I reorder shaving?' answered about shaving cream only. The tool runs SELECT … WHERE product_name LIKE '%shaving%' and takes fetchone, the first matching row. Three products match: shaving_cream with 25 in stock, shaving_gel with 10 and shaving_foam with 15. Only shaving_cream reaches the model, which answered 'no need to reorder shaving cream' on both providers, without mentioning that two other products matched.",
      draw(c) {
        c.size(720, 280).title("LIKE '%shaving%' matches three, fetchone returns one");
        const q = c.box(20, 70, 200, 56, "'reorder shaving?'", { tone: "plain" });
        const db = c.box(260, 56, 200, 112, "3 rows match", { tone: "cream", lines: ["shaving_cream  25", "shaving_gel  10", "shaving_foam  15"] });
        const ans = c.box(500, 70, 200, 56, "fetchone(): cream only", { tone: "red", lines: "'no reorder needed'" });
        c.arrow(q.right, [258, 98]);
        c.arrow([460, 98], ans.left);
        c.para(20, 196, "Both providers answered about shaving cream and never mentioned the gel or the foam: the model can't report a match the tool threw away. Return every match and let the agent ask which one.", { width: 680, fill: MUTED });
        void db;
      },
    },

    "summary-map": {
      alt: "A map of the post in four columns. Build: SQLite, embeddings, Chroma, chains, RAG and a tool loop, eight bootcamp steps. Around it: guardrails, a cache, a write action, tracing and a calculator tool, one idea per version. Measured: the rule in the prompt and a tool changed Claude's answer from 100 units to 20; keyword guardrails failed both ways; the cache answered 1 of 8 lookups. Limits: first match only, no chat history, stale cache, no login.",
      draw(c) {
        summaryMap(
          c,
          "The inventory agent, in four ideas",
          [
            { name: "Build it", lines: ["SQLite, embeddings", "Chroma, chains, RAG", "a tool loop", "8 bootcamp steps"] },
            { name: "Around it", lines: ["guardrail, cache", "email action", "tracing", "a calculator tool"] },
            { name: "Measured", lines: ["v0 Claude: 100 units", "v7 both: 20 units", "keywords wrong both ways", "cache: 1 of 8 hits"] },
            { name: "Limits", lines: ["first match only", "no chat history", "stale cache", "no login"] },
          ],
          "A production-style agent is a small model call surrounded by ordinary engineering.",
        );
      },
    },
  },
};

export default post;
