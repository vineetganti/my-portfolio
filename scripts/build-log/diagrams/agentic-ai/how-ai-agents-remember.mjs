// Diagrams added to content/blog/how-ai-agents-remember.mdx (Agentic AI) when it became the short-term
// memory post. The older diagrams of its LangGraph and AgentCore part were drawn by hand and are not here.
//   node scripts/build-log/draw.mjs how-ai-agents-remember
import { GREEN, MUTED, RED } from "../../../db-lab/canvas.mjs";
import { summaryMap } from "../_shared.mjs";

const post = {
  slug: "how-ai-agents-remember",
  diagrams: {
    "memory-types": {
      alt: "The four kinds of agent memory as a tree. Memory splits into short-term and long-term. Short-term is the current conversation, one thread, answering 'what did we just say?'. Long-term splits into three: semantic memory holds facts and answers 'what is true?', episodic memory holds experiences and answers 'what happened last time?', and procedural memory holds skills and workflows and answers 'how do I do this?'. This post covers short-term memory; the next post covers the three long-term kinds.",
      draw(c) {
        c.size(720, 330).title("Four kinds of memory, two posts");
        const root = c.box(285, 52, 150, 44, "memory", { tone: "neutral" });
        const st = c.box(60, 130, 220, 70, "short-term", { tone: "green", lines: ["one conversation (thread)", "'what did we just say?'"] });
        const lt = c.box(440, 130, 220, 70, "long-term", { tone: "amber", lines: ["across conversations", "keyed by user"] });
        c.arrow([330, 96], [190, 128]);
        c.arrow([390, 96], [530, 128]);
        const kinds = [["semantic", "facts: what is true"], ["episodic", "experiences: what happened"], ["procedural", "skills: how to act"]];
        kinds.forEach(([name, line], i) => {
          const x = 300 + i * 140;
          c.box(x, 236, 130, 58, name, { tone: "cream", lines: [line], size: 12 });
          c.arrow([550, 200], [x + 65, 234]);
        });
        c.para(20, 236, "This post: short-term memory, kept small by trimming, deleting or summarising, and saved by LangGraph checkpoints.", { width: 260, fill: MUTED });
        c.flow("memory", "short-term", "", "data");
        c.flow("memory", "long-term", "", "data");
        void root;
        void st;
        void lt;
      },
    },

    "hot-vs-background": {
      alt: "Writing memory in the hot path versus in the background, measured on Claude Haiku 5.5 for a three-message chat. Hot path: before every reply, one extra model call extracts facts and saves them, so memory is fresh at once; the three replies took 37.8 seconds in all. Background: replies only, and one batch call extracts the facts afterwards; 18.7 seconds in all. Both saved the same two facts: a trip to Rishikesh with parents, and the mother cannot climb stairs.",
      draw(c) {
        c.size(720, 290).title("Save memory before replying, or later in one batch?");
        c.text(20, 64, "Hot path", { size: 12.5, weight: 700, fill: RED });
        c.text(20, 168, "Background", { size: 12.5, weight: 700, fill: GREEN });
        for (let i = 0; i < 3; i++) {
          const x = 120 + i * 180;
          c.box(x, 50, 80, 40, "extract", { tone: "amber", size: 11.5 });
          c.box(x + 86, 50, 80, 40, "reply", { tone: "plain", size: 11.5 });
          c.box(x + 43, 154, 80, 40, "reply", { tone: "plain", size: 11.5 });
        }
        c.box(620, 154, 80, 40, "extract all", { tone: "amber", size: 11 });
        c.para(120, 110, "Memory is fresh at once, every reply waits for an extra call: 37.8 s in all.", { width: 560 });
        c.para(120, 214, "Replies only, one batch afterwards: 18.7 s in all. The new facts reach future chats later.", { width: 580 });
        c.para(20, 262, "Claude Haiku 5.5, three messages. Both ways saved the same two facts.", { width: 680, fill: MUTED });
      },
    },

    "short-term-strategies": {
      alt: "Three ways to keep one conversation small, on the same ten-message chat. Trim keeps the most recent messages that fit a token budget, about 300 tokens here, and drops the rest: 2 of 10 messages kept on Groq, whose answers were longer, and 4 of 10 on Claude. Delete removes chosen messages, here the four long explanations in the middle: 6 of 10 kept, including the first message where the user gave her name. Summarise replaces the six oldest messages with one summary written by the model and keeps the last four: 5 messages, and the summary still names the user.",
      draw(c) {
        c.size(720, 270).title("Ten messages, three ways to make them fit");
        const cols = [
          ["trim", "amber", ["keep the newest that fit", "about 300 tokens", "", "kept 2 (Groq) or 4 (Claude) of 10"]],
          ["delete", "cream", ["remove chosen messages", "(the 4 long middle ones)", "", "kept 6 of 10, name included"]],
          ["summarise", "green", ["6 oldest -> 1 summary", "keep the last 4", "", "5 messages, name in summary"]],
        ];
        cols.forEach(([name, tone, lines], i) => c.box(20 + i * 230, 56, 220, 120, name, { tone, lines }));
        c.para(20, 196, "Trim is cheap and automatic but forgets the start. Delete needs to know which messages matter. Summarise costs a model call and can drop details the summary leaves out.", { width: 680 });
        c.para(20, 240, "Counts from the course notebook, re-run on both providers.", { width: 680, fill: MUTED });
      },
    },

    "trim-test": {
      alt: "Testing the notebook's claim that trimming loses the user's name. The notebook says so but never asks for the name after trimming. Test A, the notebook's own five-turn chat: the trim keeps the last two messages, and the last answer already says 'Your name is Alice', yet asked again, Claude said it didn't know the name and that its earlier answer had been wrong. Test B, the first four turns only: on Claude the trim kept two messages, neither mentioning Alice, and the model said it didn't know; on Groq a long answer alone was over the 300-token budget and the trim kept no messages at all.",
      draw(c) {
        c.size(720, 330).title("Does trimming really lose the name? The notebook never asked");
        c.box(20, 56, 680, 44, "the notebook's note: trimming removes old messages, so the user's name is LOST", { tone: "plain" });
        c.box(20, 120, 330, 120, "A: the notebook's 5 turns", { tone: "amber", lines: ["kept 2: 'remind me what my name is?'", "+ 'Your name is Alice.'", "asked again: 'I don't know your name…", "my earlier answer was wrong'"] });
        c.box(370, 120, 330, 120, "B: first 4 turns only", { tone: "green", lines: ["Claude: kept 2, neither mentions Alice:", "'I don't know your name'", "Groq: kept 0 messages,", "an empty history"] });
        c.para(20, 258, "In A the name survives the trim inside the model's own previous answer, and the model still refused it, because nothing the user said supports it. In B a single long answer can exceed the 300-token budget, and start_on='human' then leaves an empty history.", { width: 680, fill: MUTED });
      },
    },

    "summary-map": {
      alt: "A map of the post in four columns. Why: a model is stateless, memory means resending, five questions of what, when, where, how and how much. Writing: hot path is fresh but slower, background is fast but later, measured 37.8 against 18.7 seconds. One conversation: trim, delete, summarise, and test what you claim. Saving it: LangGraph checkpoints by thread_id, AgentCore Memory with session_id and actor_id.",
      draw(c) {
        summaryMap(
          c,
          "Short-term memory, in four ideas",
          [
            { name: "Why", lines: ["the model is stateless", "memory = resending", "what, when, where,", "how, how much"] },
            { name: "Writing", lines: ["hot path: fresh, slower", "background: fast, later", "37.8 s vs 18.7 s", "(Claude, 3 messages)"] },
            { name: "One conversation", lines: ["trim, delete, summarise", "budget in tokens", "start on a user message", "test what you claim"] },
            { name: "Saving it", lines: ["LangGraph checkpointer", "thread_id", "AgentCore Memory", "session_id, actor_id"] },
          ],
          "Short-term memory is the transcript you choose to resend. Choosing well is the whole job.",
        );
      },
    },
  },
};

export default post;
