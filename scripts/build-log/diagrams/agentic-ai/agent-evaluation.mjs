// Diagrams added to content/blog/agent-evaluation.mdx (Agentic AI) when it became the evaluation post.
// The AgentCore Evaluations diagrams in the same folder were drawn by hand for the older post.
//   node scripts/build-log/draw.mjs agent-evaluation
import { MUTED } from "../../../db-lab/canvas.mjs";
import { summaryMap } from "../_shared.mjs";

const post = {
  slug: "agent-evaluation",
  diagrams: {
    "three-gulfs": {
      alt: "The three gulfs between a developer, the data and the model. Comprehension, between developer and data: you haven't looked at what users actually ask. Specification, from developer to model: what you want is loosely written in the prompt, as in prompt Version 1, 'Answer the question.' Generalization, from data to model: the model behaves differently on inputs it hasn't seen, such as a question about a supplier that is really a reorder question. Evals exist to find which gulf a failure fell into.",
      draw(c) {
        c.size(720, 320).title("Three gulfs where agent mistakes come from");
        const dev = c.box(40, 70, 160, 56, "developer", { tone: "neutral" });
        const data = c.box(280, 220, 160, 56, "data", { tone: "neutral", lines: "what users really ask" });
        const llm = c.box(520, 70, 160, 56, "model", { tone: "neutral" });
        c.arrow([200, 98], [518, 98], { both: true });
        c.arrow([150, 126], [300, 218], { both: true });
        c.arrow([570, 126], [420, 218], { both: true });
        c.box(250, 38, 220, 50, "specification", { tone: "amber", lines: "the prompt says too little", size: 12 });
        c.box(40, 152, 190, 50, "comprehension", { tone: "cream", lines: "you never read the inputs", size: 12 });
        c.box(490, 152, 190, 50, "generalization", { tone: "red", lines: "new inputs, new errors", size: 12 });
        c.para(20, 292, "Prompt Version 1 ('Answer the question.') against Version 2 (what a good answer contains) is a specification experiment.", { width: 680, fill: MUTED });
        void dev;
        void data;
        void llm;
      },
    },

    "component-evals": {
      alt: "Four component evals, each built the same way: a small test set with known good answers, run one part of the agent, score each answer, report. The router gets questions with the correct route and is scored on routes. The system prompt, Version 1 against Version 2, is scored by an LLM judge on accuracy, clarity and completeness. Search plus answer is scored on Recall@k without a model, then by a judge on relevance, groundedness and correctness. Tool calling is scored on precision, recall, calls per task, success, latency and cost. A last step checks the judge itself against a second rater with Cohen's kappa.",
      draw(c) {
        c.size(720, 330).title("Evaluate the parts, not just the whole");
        const parts = [
          ["router", "green", ["which specialist?", "scored on routes"]],
          ["prompt V1 vs V2", "amber", ["LLM judge:", "accuracy, clarity,", "completeness"]],
          ["search + answer", "cream", ["Recall@k (no model)", "judge: relevance,", "groundedness, correct"]],
          ["tool calling", "raised", ["precision, recall,", "calls per task,", "latency, cost"]],
        ];
        parts.forEach(([n, t, l], i) => c.box(20 + i * 172, 56, 160, 110, n, { tone: t, lines: l }));
        const steps = ["test set + good answers", "run one part", "score each answer", "report + CSV"];
        steps.forEach((n, i) => {
          c.box(20 + i * 172, 196, 160, 40, n, { tone: "plain", size: 11.5 });
          if (i) c.arrow([20 + i * 172 - 12, 216], [20 + i * 172, 216]);
        });
        c.box(20, 258, 680, 40, "then check the judge: does a second rater agree beyond chance? (Cohen's kappa)", { tone: "neutral", size: 12 });
      },
    },

    "judges-disagree": {
      alt: "The same eval code scored by two different judges. Prompt evals: with Groq gpt-oss-20b as the judge, Version 1 passed 100 percent and Version 2 85 percent, so the improved prompt looked worse; with Claude Haiku 5.5 as the judge, Version 1 passed 67 percent and Version 2 89 percent. Each judge graded the answers written by its own provider. RAG evals: Recall@k was identical for both runs, 50, 60 and 80 percent for k of 1, 2 and 3, because retrieval is local; but the Groq judge picked configuration B as best at 93 percent and the Claude judge picked C at 80 percent, marking no answer in A or B as grounded.",
      draw(c) {
        c.size(720, 330).title("Same evals, two judges, two conclusions");
        c.text(20, 62, "Prompt evals: overall pass rate", { size: 12.5, weight: 700 });
        c.box(20, 72, 330, 70, "judge: Groq gpt-oss-20b", { tone: "amber", lines: ["V1 100%  ·  V2 85%", "'the new prompt is worse'"] });
        c.box(370, 72, 330, 70, "judge: Claude Haiku 5.5", { tone: "green", lines: ["V1 67%  ·  V2 89%", "'the new prompt is better'"] });
        c.text(20, 176, "RAG evals: same retrieval, different winner", { size: 12.5, weight: 700 });
        c.box(20, 186, 220, 70, "Recall@k, no model", { tone: "plain", lines: ["k=1 50% · k=2 60%", "k=3 80% (both runs)"] });
        c.box(250, 186, 220, 70, "Groq judge", { tone: "amber", lines: ["best: B (k=2), 93%", "grounded 40/80/80%"] });
        c.box(480, 186, 220, 70, "Claude judge", { tone: "green", lines: ["best: C (k=3), 80%", "grounded 0/0/40%"] });
        c.para(20, 278, "Each judge graded its own provider's answers, so model and judge are confounded here; the next diagram puts both judges on the same answers.", { width: 680, fill: MUTED });
      },
    },

    "kappa-matrix": {
      alt: "Two LLM judges grading the same 18 answers, the Claude run's prompt-eval answers. Claude's judge passed 10 and failed 8; Groq gpt-oss-20b's judge passed 15 and failed 3. They agreed on 11 of 18: both passed 9, both failed 2. Raw agreement was 61 percent, but agreement expected by chance, given how often each passes, was 54 percent, so Cohen's kappa was 0.16, slight agreement. Most disagreements were answers Claude's judge failed for a missing nuance and Groq's judge passed.",
      draw(c) {
        c.size(720, 330).title("Two judges, the same 18 answers: kappa 0.16");
        c.text(250, 64, "Groq judge: pass", { size: 12, weight: 700, anchor: "middle" });
        c.text(430, 64, "Groq judge: fail", { size: 12, weight: 700, anchor: "middle" });
        c.text(150, 104, "Claude: pass", { size: 12, weight: 700, anchor: "end" });
        c.text(150, 174, "Claude: fail", { size: 12, weight: 700, anchor: "end" });
        c.box(170, 76, 160, 56, "9", { tone: "green", size: 18 });
        c.box(350, 76, 160, 56, "1", { tone: "red", size: 18 });
        c.box(170, 146, 160, 56, "6", { tone: "red", size: 18 });
        c.box(350, 146, 160, 56, "2", { tone: "green", size: 18 });
        c.box(540, 76, 160, 126, "agreement", { tone: "raised", lines: ["raw 61%", "by chance 54%", "kappa 0.16", "'slight'"] });
        c.para(20, 230, "Kappa = (observed − chance) / (1 − chance). The Groq judge passes almost everything (15 of 18), so agreeing with it is easy by chance; what is left over is little more than luck.", { width: 680 });
        c.para(20, 290, "Run with the course's judge_agreement.py; the 'human' column held the second LLM judge, not a person.", { width: 680, fill: MUTED });
      },
    },

    "summary-map": {
      alt: "A map of the post in four columns. Why it's hard: answers vary, quality is subjective, many things must be right at once, and three gulfs explain the failures. Components: router, prompt, retrieval and tools each get their own test set and metric. Judges: an LLM judge needs a rubric and JSON output, and two judges disagreed enough to reverse conclusions, kappa 0.16. Process: synthetic test data from dimensions, error analysis by labelling and counting, and on AWS, AgentCore Evaluations reads traces and scores them.",
      draw(c) {
        summaryMap(
          c,
          "Evaluating an agent, in four ideas",
          [
            { name: "Why it's hard", lines: ["answers vary", "quality is subjective", "many parts", "three gulfs"] },
            { name: "Components", lines: ["router: routes", "prompt: judge", "RAG: Recall@k + judge", "tools: precision, cost"] },
            { name: "Judges", lines: ["rubric + JSON", "two judges, two winners", "kappa 0.16", "check the checker"] },
            { name: "Process", lines: ["synthetic test data", "label, count, fix", "AgentCore Evaluations", "on traces"] },
          ],
          "One good-looking answer proves nothing. Test many, part by part, and test the judge too.",
        );
      },
    },
  },
};

export default post;
