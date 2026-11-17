// Diagrams for content/blog/agentic-bug-fixing.mdx (Agentic AI, part 9).
//   node scripts/build-log/draw.mjs agentic-bug-fixing
import { GREEN, MUTED, RED } from "../../../db-lab/canvas.mjs";
import { summaryMap } from "../_shared.mjs";

/** Two columns of stacked boxes joined by down arrows: the usual before/after layout. */
function beforeAfter(c, { title, height, before, after, note }) {
  c.size(720, height).title(title);
  c.text(20, 62, "Before", { size: 12.5, weight: 700, fill: RED });
  c.text(380, 62, "After", { size: 12.5, weight: 700, fill: GREEN });
  for (const [x, steps] of [[20, before], [380, after]]) {
    let y = 72;
    steps.forEach(([name, tone, lines], i) => {
      if (i) {
        c.arrow([x + 160, y - 22], [x + 160, y]);
      }
      c.box(x, y, 320, 48, name, { tone, lines: lines ? [lines] : [] });
      y += 70;
    });
  }
  if (note) c.para(20, height - 22, note, { width: 680, fill: MUTED });
}

const post = {
  slug: "agentic-bug-fixing",
  diagrams: {
    "agent-loop": {
      alt: "The agent's graph. START leads to code_execution_node, which runs the function and records the result or the error. The error_router then decides: if the run worked, or three fix attempts have been used, it goes to END. If the function crashed, it goes to code_fix_node, which asks the LLM for a rewrite and loads the new code, and an edge always leads back to code_execution_node to run the new version. Every node reads one shared State and returns only the fields it changed.",
      draw(c) {
        c.size(720, 340).title("Two nodes, one router, one loop");
        const start = c.box(20, 104, 76, 44, "START", { tone: "neutral" });
        const run = c.box(126, 96, 190, 60, "code_execution_node", { tone: "green", lines: "run it, record result or error", size: 12 });
        const router = c.box(366, 96, 140, 60, "error_router", { tone: "amber", lines: "where next?" });
        const end = c.box(624, 104, 76, 44, "END", { tone: "neutral" });
        const fix = c.box(366, 216, 140, 60, "code_fix_node", { tone: "cream", lines: "ask the LLM, load the code", size: 12 });
        c.arrow(start.right, run.left);
        c.arrow(run.right, router.left);
        c.arrow(router.right, end.left, { label: "ok, or 3 tries", labelDy: -10 });
        c.arrow(router.bottom, fix.top, { label: "crashed", labelDx: 34, labelDy: 4 });
        c.route([[366, 246], [221, 246], [221, 158]], { color: GREEN, label: "run the new version", labelAt: [294, 246], labelDy: 18 });
        c.box(20, 196, 170, 80, "State", { tone: "raised", dash: "5 4", lines: ["function, arguments,", "error, attempts, result"] });
        c.para(20, 310, "Each node gets the whole State and returns only the fields it changed. The router reads the State and changes nothing.", { width: 680 });
        c.flow("START", "code_execution_node", "", "request");
        c.flow("code_execution_node", "error_router", "", "metadata");
        c.flow("error_router", "code_fix_node", "crashed", "request");
        c.flow("code_fix_node", "code_execution_node", "run the new version", "data");
        c.flow("code_execution_node", "error_router", "", "metadata");
        c.flow("error_router", "END", "ok, or 3 tries", "metadata");
      },
    },

    "system-map": {
      alt: "What talks to what. You start the agent from a terminal or open the Gradio app in a browser. Both call the Agent, a LangGraph graph with its State, in one Python process. Only the fix step goes over the network: it sends a prompt to the Groq API, model openai/gpt-oss-120b, using the GROQ_API_KEY loaded from the git-ignored .env file, and gets code back as text. The Agent then runs that text with exec() in the same process, which is the trust boundary.",
      draw(c) {
        c.size(720, 346).title("What talks to what");
        const term = c.box(20, 60, 200, 54, "your terminal", { tone: "plain", lines: "python -m agentic_bug_fixing" });
        const web = c.box(20, 150, 200, 54, "your browser", { tone: "plain", lines: "Gradio app on port 7860" });
        const agent = c.box(280, 100, 170, 64, "Agent", { tone: "green", lines: "LangGraph graph + State" });
        const groq = c.box(530, 105, 170, 54, "Groq API", { tone: "cream", lines: "openai/gpt-oss-120b" });
        const exec = c.box(280, 236, 170, 54, "exec()", { tone: "red", lines: "runs the LLM's code here" });
        const env = c.box(530, 236, 170, 54, ".env", { tone: "neutral", lines: "GROQ_API_KEY, git-ignored" });
        c.arrow(term.right, [280, 122]);
        c.arrow(web.right, [280, 142]);
        c.arrow([450, 132], groq.left, { both: true, label: "prompt / code", labelDy: -10 });
        c.arrow(agent.bottom, exec.top, { color: RED, label: "new code", labelDx: 34, labelDy: 4, labelFill: RED });
        c.arrow(env.top, groq.bottom, { label: "key", labelDx: 18, labelDy: 4 });
        c.para(20, 316, "Only the fix step uses the network. Everything else, including running what the model wrote, happens on your machine.", { width: 680 });
        c.flow("your browser", "Agent", "", "request");
        c.flow("Agent", "Groq API", "", "request");
        c.flow("Groq API", "Agent", "", "data");
        c.flow("Agent", "exec()", "new code", "data");
      },
    },

    "three-versions": {
      alt: "Where the code came from, in three versions. The course original from Scaler Academy used Groq with llama-3.3-70b-versatile and an old langchain.schema import. Shivank Agarwal of Future with Shivank rewrote it for OpenAI's gpt-5-mini with 14 changes and wrote the explainer. My port moved it back to Groq on openai/gpt-oss-120b, as a package with a setup check, and published it on GitHub. I have the last two versions; the first is known only from the explainer's change table.",
      draw(c) {
        c.size(720, 230).title("One agent, three versions");
        const a = c.box(20, 56, 200, 96, "Course original", { tone: "neutral", lines: ["Scaler Academy", "Groq, llama-3.3-70b-versatile", "langchain.schema import"] });
        const b = c.box(260, 56, 200, 96, "Shivank's rewrite", { tone: "cream", lines: ["Future with Shivank", "OpenAI, gpt-5-mini", "14 changes + the explainer"] });
        const d = c.box(500, 56, 200, 96, "My port", { tone: "green", lines: ["Groq, openai/gpt-oss-120b", "a package + check_setup", "on GitHub"] });
        c.arrow(a.right, b.left);
        c.arrow(b.right, d.left);
        c.para(20, 182, "I have the second and third versions. The first is known only from the explainer's table of what changed.", { width: 680 });
      },
    },

    "bug-model-404": {
      alt: "Before and after for the model error. Before: MODEL_NAME was llama-3.3-70b-versatile, the setup check's one test call came back 404 model_not_found, because Groq shut that model down on 16 August 2026. After: a GET to the models endpoint listed the models this key can use, MODEL_NAME became openai/gpt-oss-120b, which Groq names as a replacement, and the check's test call replied OK.",
      draw(c) {
        beforeAfter(c, {
          title: "A model that no longer exists",
          height: 300,
          before: [
            ["MODEL_NAME = llama-3.3-70b-versatile", "plain"],
            ["check_setup.py: one test call", "raised"],
            ["404 model_not_found", "red", "Groq shut it down on 2026-08-16"],
          ],
          after: [
            ["GET /openai/v1/models", "plain", "what can this key use?"],
            ["MODEL_NAME = openai/gpt-oss-120b", "raised", "a named replacement"],
            ["test call replied 'OK'", "green", "then the demo ran"],
          ],
          note: "Groq's models page still listed the old model that day; its deprecations page and the API agreed it was gone.",
        });
      },
    },

    "bug-stray-paren": {
      alt: "Before and after for the stray bracket. Before: the model's reply ends the fix with an extra closing bracket, exec raises SyntaxError, the agent keeps the old code, re-runs it, sees the same crash, and sends the same prompt again, so the model can send the same broken reply. In my runs 4 of 13 such retries failed again and one run gave up after three. After: the error and the broken reply are saved in the State, the next request carries them, and 10 of 10 retries loaded, 6 in an experiment and 4 in the fixed repo.",
      draw(c) {
        beforeAfter(c, {
          title: "A stray bracket, and a retry that learns nothing",
          height: 370,
          before: [
            ["reply ends in an extra )", "red", "return \"Error: division by zero\")"],
            ["SyntaxError, old code kept", "amber"],
            ["the same prompt again", "plain", "nothing says what went wrong"],
            ["4 of 13 retries failed again", "red", "one run gave up after 3"],
          ],
          after: [
            ["reply ends in an extra )", "red", "return \"Error: division by zero\")"],
            ["SyntaxError, old code kept", "amber", "and the error + reply saved"],
            ["prompt + the load error", "plain", "and the reply that broke"],
            ["10 of 10 retries loaded", "green", "6 in a test, 4 in the fixed repo"],
          ],
          note: "Measured on 2026-11-17 with openai/gpt-oss-120b. The broken reply was the same text every time.",
        });
      },
    },

    "bug-no-brake": {
      alt: "Before and after for the attempt limit, run with a stand-in model that always returns the broken reply, so no API calls. Before: with the limit set to a million, the agent made 5,003 fix attempts, one LLM call each with a real model, and stopped only when LangGraph raised GraphRecursionError at its default limit of 10,007 steps. After: with MAX_FIX_ATTEMPTS at 3, it stopped after three attempts and returned the State with error set to True, so the caller decides what to do.",
      draw(c) {
        beforeAfter(c, {
          title: "What MAX_FIX_ATTEMPTS = 3 protects you from",
          height: 300,
          before: [
            ["no real limit (1,000,000)", "plain"],
            ["5,003 fix attempts", "red", "with a real model, 5,003 paid calls"],
            ["GraphRecursionError", "red", "LangGraph's default: 10,007 steps"],
          ],
          after: [
            ["MAX_FIX_ATTEMPTS = 3", "plain"],
            ["3 fix attempts", "amber"],
            ["END, error = True", "green", "the caller decides what next"],
          ],
          note: "Run with a stand-in model that always sends the broken reply, so neither run cost anything.",
        });
      },
    },

    "bug-fix-node-crash": {
      alt: "Before and after for one of Shivank's changes, from his explainer. Before: code_fix_node asked the LLM, then ran the new function itself; if that still crashed, the exception escaped the graph and the program stopped. After: code_fix_node only loads the new code, and the loop sends it back to code_execution_node, which runs it inside try and except, records the error in the State, and lets the router decide.",
      draw(c) {
        beforeAfter(c, {
          title: "Where the second crash lands",
          height: 300,
          before: [
            ["code_fix_node runs the new code", "plain", "inside the fix step"],
            ["the new code crashes too", "amber"],
            ["exception escapes the graph", "red", "the whole program stops"],
          ],
          after: [
            ["code_fix_node only loads it", "plain"],
            ["code_execution_node runs it", "raised", "inside try / except"],
            ["error recorded in the State", "green", "the router decides"],
          ],
          note: "From Shivank's table of changes. The course original isn't in my log, so this one is described, not re-run.",
        });
      },
    },

    "two-pythons": {
      alt: "Two Pythons, one project. The global Python 3.14 is where the Groq switch installed the requirements, so it has langchain-groq 1.2.0 and python -m agentic_bug_fixing works there. The project's .venv was built earlier from the OpenAI requirements, so it has langchain-openai but no langchain-groq, and running the agent from it fails with ModuleNotFoundError: No module named langchain_groq.",
      draw(c) {
        c.size(720, 272).title("Two Pythons, one project");
        const g = c.box(20, 56, 320, 70, "global Python 3.14", { tone: "green", lines: ["where the Groq switch ran pip install", "langchain-groq 1.2.0"] });
        const v = c.box(380, 56, 320, 70, "project .venv", { tone: "red", lines: ["built earlier from the OpenAI requirements", "langchain-openai, no langchain-groq"] });
        const ok = c.box(20, 160, 320, 50, "python -m agentic_bug_fixing", { tone: "plain", lines: "works", mono: true, size: 12 });
        const bad = c.box(380, 160, 320, 50, "the same command in .venv", { tone: "plain", lines: "No module named 'langchain_groq'" });
        c.arrow(g.bottom, ok.top, { color: GREEN });
        c.arrow(v.bottom, bad.top, { color: RED });
        c.para(20, 236, "Which python is first on PATH decides where pip installs. Activate the venv before installing, or check with python -c \"import sys; print(sys.prefix)\".", { width: 680 });
      },
    },

    "summary-map": {
      alt: "A map of the post. The loop: run, route, fix, run; the State is a job card; nodes return only what changed; the router only decides. The brakes: MAX_FIX_ATTEMPTS is 3; LangGraph's own limit is 10,007 steps; a fix that won't load keeps the old code; the UI catches API errors. LLM output: strip fences and dedent; ast finds the def; exec is a trust boundary; about three replies in ten had a stray bracket. My run: a model shut down in August; list the models and pick one; two Pythons with a stale venv; dark mode hid the diff. Fixed since: the load error goes back to the model; a give-up says so; the diff is safe in dark mode; the graph draws its loop.",
      draw(c) {
        summaryMap(
          c,
          "A bug-fixing agent, on one page",
          [
            { name: "The loop", lines: ["run, route, fix, run", "State = job card", "nodes return changes", "router only decides"] },
            { name: "The brakes", lines: ["3 fix attempts max", "LangGraph: 10,007", "bad fix: keep old", "UI catches errors"] },
            { name: "LLM output", lines: ["strip fences, dedent", "ast finds the def", "exec() trusts text", "3 in 10: stray )"] },
            { name: "My run", lines: ["model shut down", "list models, pick", "two Pythons", "dark mode hid diff"] },
            { name: "Fixed since", lines: ["sends load error", "says it gave up", "dark-safe diff", "draws the loop"] },
          ],
          "A retry is only as good as the new information it carries.",
        );
      },
    },
  },
};

export default post;
