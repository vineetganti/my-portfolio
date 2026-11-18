// Diagrams for content/blog/observing-agents.mdx (Agentic AI). The trace diagrams of the AWS part were
// drawn for the older evaluation post and stay in its image folder.
//   node scripts/build-log/draw.mjs observing-agents
import { GREEN, MUTED, RED } from "../../../db-lab/canvas.mjs";
import { summaryMap } from "../_shared.mjs";

const post = {
  slug: "observing-agents",
  diagrams: {
    melt: {
      alt: "MELT for one request, 'Where is my order #1234?', with one trace id tying the four records together. Metrics are numbers over time, such as latency, tokens, cost and success rate. Events are named moments that matter to the business, such as cache_hit or booking_failed. Logs are the exact words in and out of every model call. Traces are the step-by-step story of the request, a tree of spans: the agent, the model call, the tool call. Monitoring checks fixed questions on the metrics; observability lets you ask new questions of all four.",
      draw(c) {
        c.size(720, 330).title("MELT: four kinds of record, one request");
        const pillars = [
          ["Metrics", "amber", ["numbers over time", "latency, tokens, cost,", "success rate"]],
          ["Events", "cream", ["named moments", "cache_hit_semantic,", "booking_failed"]],
          ["Logs", "raised", ["the exact words", "in and out of every", "model call"]],
          ["Traces", "green", ["the story of one request", "a tree of spans:", "agent > model > tool"]],
        ];
        pillars.forEach(([n, t, l], i) => c.box(20 + i * 172, 60, 160, 110, n, { tone: t, lines: l }));
        c.box(20, 196, 680, 46, "one trace_id ties all four together for 'Where is my order #1234?'", { tone: "plain" });
        c.para(20, 262, "Monitoring asks fixed questions of the metrics ('is latency under 2 s?'). Observability keeps enough of all four to answer questions nobody wrote in advance ('which failed bookings did we report as booked?').", { width: 680, fill: MUTED });
      },
    },

    "lying-agent": {
      alt: "The lecture's booking agent that lies, before and after the fix. Before: the book_flight tool returns status failed, seat not available, and the agent hands that raw result to the model with the open question 'What should I say?'. A helpful model may answer 'I've booked your flight', and nothing crashes, so monitoring stays green. After: the code checks the tool's status first, and on failure returns a fixed, honest message without the model. In my runs of the buggy version, both providers told the truth in 5 of 5 runs each; the bug did not reproduce, but the fix removes the model from the failure path either way.",
      draw(c) {
        c.size(720, 320).title("Before and after: an agent that may confirm a failed booking");
        c.text(20, 62, "Before", { size: 12.5, weight: 700, fill: RED });
        c.text(380, 62, "After", { size: 12.5, weight: 700, fill: GREEN });
        c.box(20, 72, 320, 48, "book_flight -> failed", { tone: "plain", lines: "'Seat not available'" });
        c.arrow([180, 120], [180, 140]);
        c.box(20, 140, 320, 48, "model: 'What should I say?'", { tone: "amber", lines: "the raw error, an open question" });
        c.arrow([180, 188], [180, 208]);
        c.box(20, 208, 320, 48, "may say 'You're booked!'", { tone: "red", lines: "nothing crashes, dashboards green" });
        c.box(380, 72, 320, 48, "book_flight -> failed", { tone: "plain", lines: "'Seat not available'" });
        c.arrow([540, 120], [540, 140]);
        c.box(380, 140, 320, 48, "code checks the status", { tone: "amber", lines: "no model on the failure path" });
        c.arrow([540, 188], [540, 208]);
        c.box(380, 208, 320, 48, "'Sorry, I couldn't book FL-123'", { tone: "green", lines: "a fixed, honest message" });
        c.para(20, 276, "Measured: the buggy version told the truth in 10 of 10 runs, 5 on each provider. The lesson holds anyway: don't leave honesty to the model when code can decide.", { width: 680, fill: MUTED });
      },
    },

    "personality-graph": {
      alt: "The observability demo as a LangGraph graph with three nodes and two routers. A question first goes to check_exact_cache, which cleans the text and looks it up; on a hit the answer is returned for free. Otherwise check_semantic_cache embeds the question locally and compares it with saved questions; a similarity of 0.70 or more reuses the saved answer. Otherwise call_llm asks the model and saves the answer and its embedding. Seven questions gave two exact hits, two semantic hits and three model calls: a 57 percent hit rate on both providers. The similarities were 0.91 for 'Who is Elon Musk?' against 'elon musk', 0.89 for 'Tell me about Marie Curie', 0.16 for Marie Curie against Elon Musk and 0.40 for Albert Einstein against Marie Curie.",
      draw(c) {
        c.size(720, 330).title("Three checkpoints in a row, and what they caught");
        const ex = c.box(20, 70, 180, 64, "check_exact_cache", { tone: "green", lines: "cleaned text, a dict lookup" });
        const se = c.box(270, 70, 180, 64, "check_semantic_cache", { tone: "cream", lines: "local embedding, >= 0.70" });
        const ll = c.box(520, 70, 180, 64, "call_llm", { tone: "amber", lines: "ask, then save answer + vector" });
        c.arrow(ex.right, se.left, { label: "miss", labelDy: -8 });
        c.arrow(se.right, ll.left, { label: "miss", labelDy: -8 });
        c.box(20, 170, 180, 50, "2 exact hits", { tone: "plain", lines: "a repeat, extra spaces" });
        c.box(270, 170, 180, 50, "2 semantic hits", { tone: "plain", lines: "0.91 and 0.89" });
        c.box(520, 170, 180, 50, "3 model calls", { tone: "plain", lines: "Musk, Curie, Einstein" });
        c.arrow([110, 134], [110, 168]);
        c.arrow([360, 134], [360, 168]);
        c.arrow([610, 134], [610, 168]);
        c.para(20, 244, "Hit rate 57% on both providers: the caches don't depend on the model. Near misses: Einstein vs Curie 0.40, Curie vs Musk 0.16. The course's OpenAI embeddings gave 0.84 and 0.78 for the two hits.", { width: 680, fill: MUTED });
        c.flow("check_exact_cache", "check_semantic_cache", "miss", "request");
        c.flow("check_semantic_cache", "call_llm", "miss", "request");
      },
    },

    "trace-tree": {
      alt: "A real trace from LangSmith, drawn as a tree: question 4, Marie Curie, on Claude Haiku 5.5. The root run personality_query took 3.34 seconds and 1,130 tokens. Inside it, the LangGraph run holds three node runs. check_exact_cache with its router after_exact took no measurable time. check_semantic_cache took 0.01 seconds and contains find_semantic_match, which contains get_embedding, and the router after_semantic. call_llm took 3.33 seconds and contains record_event, call_openai_model, which contains the model run of 3.31 seconds carrying all 1,130 tokens, then get_embedding and a second record_event. Nearly all the time and every token sit in one span.",
      draw(c) {
        c.size(720, 380).title("One question, one trace: where the 3.34 s went");
        const rows = [
          [0, "personality_query", "chain", "3.34 s · 1,130 tokens", "neutral"],
          [1, "LangGraph", "chain", "3.34 s", "plain"],
          [2, "check_exact_cache  >  after_exact", "chain", "0.00 s", "plain"],
          [2, "check_semantic_cache", "chain", "0.01 s", "plain"],
          [3, "find_semantic_match  >  get_embedding", "tool / embedding", "0.01 s", "plain"],
          [2, "call_llm", "chain", "3.33 s", "amber"],
          [3, "record_event (llm_call_started)", "tool", "0.00 s", "plain"],
          [3, "call_openai_model  >  ChatClaudeCode", "chain / llm", "3.31 s · 1,130 tokens", "red"],
          [3, "get_embedding, record_event (answer_cached)", "embedding / tool", "0.01 s", "plain"],
        ];
        rows.forEach(([d, name, type, cost, tone], i) => {
          const y = 52 + i * 34;
          c.box(20 + d * 28, y, 420 - d * 28, 28, name, { tone, size: 11.5 });
          c.text(456, y + 18, type, { size: 11, fill: MUTED });
          c.text(590, y + 18, cost, { size: 11, weight: 700 });
        });
        c.para(20, 364, "Read from the LangSmith API for my run; question 4 of 7, Claude Haiku 5.5.", { width: 680, fill: MUTED });
      },
    },

    "summary-map": {
      alt: "A map of the post in four columns. Why: agents fail without crashing, the same question gets different answers, and many hidden steps run per request. MELT: metrics, events, logs and traces, tied by one trace id. Debugging: metrics show something is wrong, traces find the bad cases, logs show the exact prompt, then fix in code and confirm with metrics. Tools: LangSmith traces with one decorator, OpenTelemetry spans to any backend, and on AWS, CloudWatch, Jaeger and Langfuse read the same spans.",
      draw(c) {
        summaryMap(
          c,
          "Seeing inside an agent, in four ideas",
          [
            { name: "Why", lines: ["fails without crashing", "different answers", "hidden steps", "green dashboards"] },
            { name: "MELT", lines: ["metrics, events", "logs, traces", "one trace_id", "ask new questions"] },
            { name: "Debugging", lines: ["metrics: something's off", "traces: which cases", "logs: the exact prompt", "fix in code, re-check"] },
            { name: "Tools", lines: ["LangSmith @traceable", "OpenTelemetry spans", "CloudWatch, Jaeger", "Langfuse"] },
          ],
          "If you can't see what the agent did, you can't tell whether it did it well.",
        );
      },
    },
  },
};

export default post;
