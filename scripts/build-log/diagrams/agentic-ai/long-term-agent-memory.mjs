// Diagrams for content/blog/long-term-agent-memory.mdx (Agentic AI). The Mem0 diagrams this post reuses
// live in public/images/ai-llms/agentic-ai/how-ai-agents-remember/, where they were first published.
//   node scripts/build-log/draw.mjs long-term-agent-memory
import { GREEN, MUTED, RED } from "../../../db-lab/canvas.mjs";
import { summaryMap } from "../_shared.mjs";

const post = {
  slug: "long-term-agent-memory",
  diagrams: {
    "three-memories": {
      alt: "memory_demo_1 as a LangGraph pipeline of four steps. A customer's question enters. Step 1, semantic memory, adds general facts that match keywords in the question, such as the 30-day return policy. Step 2 adds what is stored about this customer: name, preferences such as detail level, and recent interactions; the code calls this episodic memory. Step 3, procedural memory, follows fixed steps to look up the customer's orders. Step 4 sends all three to the model, which writes the reply. The memories are Python dictionaries, so the flow is easy to see.",
      draw(c) {
        c.size(720, 320).title("Three memories feed one answer");
        const q = c.box(20, 60, 140, 60, "question", { tone: "plain", lines: "orders + return policy?" });
        const sem = c.box(200, 40, 220, 56, "1. semantic", { tone: "cream", lines: "facts: return period 30 days" });
        const epi = c.box(200, 112, 220, 56, "2. 'episodic' (the profile)", { tone: "amber", lines: "name, detail level, past chats" });
        const pro = c.box(200, 184, 220, 56, "3. procedural", { tone: "raised", lines: "look up this user's orders" });
        const gen = c.box(480, 104, 220, 72, "4. generate_response", { tone: "green", lines: ["the model writes the reply", "from all three"] });
        c.arrow(q.right, [198, 68]);
        c.arrow([310, 96], [310, 110]);
        c.arrow([310, 168], [310, 182]);
        c.arrow([420, 212], [520, 178]);
        c.para(20, 262, "Semantic facts are found by keywords ('return', 'shipping'): 'Can I get a refund?' finds nothing. The lecture would call the customer profile semantic memory about the user; the code calls it episodic.", { width: 680, fill: MUTED });
        c.flow("question", "1. semantic", "", "request");
        c.flow("1. semantic", "2. 'episodic' (the profile)", "", "data");
        c.flow("2. 'episodic' (the profile)", "3. procedural", "", "data");
        c.flow("3. procedural", "4. generate_response", "", "data");
        void sem;
        void epi;
        void pro;
        void gen;
      },
    },

    "episode-paths": {
      alt: "Episodic memory in use, from the lecture. A user asks 'Where is my order #78910?'. Episode 1, a failure: the agent asked for the order ID, then sent it straight to the shipping API, which answered 'Invalid ID format'. Episode 2, a success: the agent validated the ID first, turning it into ORD-78910, looked it up in the order database and confirmed the status. When a new request 'Where is my order #55321?' arrives, the agent retrieves both past episodes with the same goal, compares the outcomes, and follows the path that worked.",
      draw(c) {
        c.size(720, 330).title("Remember what happened, then avoid it");
        c.text(20, 62, "Episode 1: failure", { size: 12.5, weight: 700, fill: RED });
        c.text(20, 162, "Episode 2: success", { size: 12.5, weight: 700, fill: GREEN });
        const fail = [["ask for ID", "plain"], ["shipping API", "red"], ["'Invalid ID format'", "red"]];
        fail.forEach(([n, t], i) => {
          c.box(20 + i * 160, 72, 140, 44, n, { tone: t, size: 12 });
          if (i) c.arrow([20 + i * 160 - 18, 94], [20 + i * 160 - 2, 94]);
        });
        const ok = [["ask for ID", "plain"], ["validate ID", "green"], ["order database", "green"], ["confirm status", "green"]];
        ok.forEach(([n, t], i) => {
          c.box(20 + i * 160, 172, 140, 44, n, { tone: t, size: 12 });
          if (i) c.arrow([20 + i * 160 - 18, 194], [20 + i * 160 - 2, 194]);
        });
        c.box(500, 62, 200, 64, "new: order #55321", { tone: "amber", lines: ["find episodes with this goal,", "follow the one that worked"] });
        c.para(20, 244, "The shipping API wants the courier's tracking number, not the shop's order number. A person learns that once; an agent without episodic memory makes the mistake for every customer. (The lecture's example, not re-run here.)", { width: 680, fill: MUTED });
      },
    },

    "preference-update": {
      alt: "memory_demo_2 over three turns. Turn 1, 'What is the status of my orders and the return policy?': the detector finds no preference change, and the reply is detailed. Turn 2, 'Please keep your answers brief from now on': the detector returns detail_level brief, the preference is updated at once, saved to episodic_memory.json with an audit trail, and the same turn's reply is already brief. Turn 3, 'Can you give me an update on all my orders?': on Claude the detector found no change and the reply was a short list; on Groq gpt-oss-120b the JSON-mode call itself returned HTTP 400 'Failed to generate JSON', which the code did not catch, so the program stopped.",
      draw(c) {
        c.size(720, 340).title("Memory that updates itself, three turns");
        const turns = [
          ["turn 1", "plain", ["'status + return policy?'", "no change", "detailed reply"]],
          ["turn 2", "green", ["'keep your answers brief'", "detail_level -> brief", "saved to JSON, brief reply"]],
          ["turn 3", "amber", ["'update on all my orders?'", "Claude: no change, short list", "Groq: HTTP 400, crash"]],
        ];
        turns.forEach(([name, tone, lines], i) => {
          c.box(20 + i * 230, 60, 220, 100, name, { tone, lines });
          if (i) c.arrow([20 + i * 230 - 8, 110], [20 + i * 230, 110]);
        });
        c.box(250, 190, 220, 50, "episodic_memory.json", { tone: "raised", lines: "preferences + preference_history" });
        c.arrow([360, 160], [360, 188]);
        c.para(20, 260, "The detector asks the model for JSON in JSON mode. On Groq, output that isn't valid JSON is rejected by the API itself, as an error, before the code's json.loads ever runs, and the code only caught json.JSONDecodeError.", { width: 680, fill: MUTED });
      },
    },

    "shared-default": {
      alt: "Before and after for a bug Shivank fixed in memory_demo_2. Before: each MemoryDemo starts with self.episodic_memory = EPISODIC_MEMORY_DEFAULT, which is the same dictionary, not a copy. Updating a preference changes the default itself, so a second MemoryDemo in the same program starts with the changed values. After: copy.deepcopy(EPISODIC_MEMORY_DEFAULT) gives each instance its own copy, and the default stays as written.",
      draw(c) {
        c.size(720, 300).title("Before and after: a default that changed itself");
        c.text(20, 62, "Before", { size: 12.5, weight: 700, fill: RED });
        c.text(380, 62, "After", { size: 12.5, weight: 700, fill: GREEN });
        c.box(20, 72, 320, 48, "memory = DEFAULT", { tone: "plain", lines: "the same dict, not a copy", mono: false });
        c.arrow([180, 120], [180, 140]);
        c.box(20, 140, 320, 48, "update: detail_level = brief", { tone: "amber", lines: "changes DEFAULT too" });
        c.arrow([180, 188], [180, 208]);
        c.box(20, 208, 320, 48, "a new MemoryDemo()", { tone: "red", lines: "starts already 'brief'" });
        c.box(380, 72, 320, 48, "memory = copy.deepcopy(DEFAULT)", { tone: "plain", lines: "its own copy" });
        c.arrow([540, 120], [540, 140]);
        c.box(380, 140, 320, 48, "update: detail_level = brief", { tone: "amber", lines: "changes only the copy" });
        c.arrow([540, 188], [540, 208]);
        c.box(380, 208, 320, 48, "a new MemoryDemo()", { tone: "green", lines: "starts 'detailed', as written" });
        c.para(20, 274, "From the explainer's list of changes; the fixed code is what I ran.", { width: 680, fill: MUTED });
      },
    },

    "summary-map": {
      alt: "A map of the post in four columns. Three kinds: semantic is what is true, episodic is what happened, procedural is how to act. Mem0: an LLM extracts facts, they are embedded locally and kept in FAISS per user. Three memories in one agent: keyword facts, the customer profile and an order lookup feed one reply. Memory that learns: a detector updates preferences in the hot path and saves them, JSON mode can still fail, and a shared default needs a deep copy.",
      draw(c) {
        summaryMap(
          c,
          "Long-term memory, in four ideas",
          [
            { name: "Three kinds", lines: ["semantic: what is true", "episodic: what happened", "procedural: how to act", "kept per user"] },
            { name: "Mem0", lines: ["an LLM extracts facts", "local embeddings", "FAISS, per user_id", "search before answering"] },
            { name: "One agent, three", lines: ["keyword facts", "the customer profile", "an order procedure", "one reply"] },
            { name: "Memory that learns", lines: ["detect, update, save", "hot path, same turn", "JSON mode can fail", "deep-copy defaults"] },
          ],
          "Long-term memory is a store plus a rule for what goes in and how it comes back out.",
        );
      },
    },
  },
};

export default post;
