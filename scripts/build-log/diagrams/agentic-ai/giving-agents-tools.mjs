// Diagrams added to content/blog/giving-agents-tools.mdx (Agentic AI, part 2) for the
// "Under the hood" section. The post's older diagrams were drawn by hand and are not here.
//   node scripts/build-log/draw.mjs giving-agents-tools
import { MUTED } from "../../../db-lab/canvas.mjs";

const post = {
  slug: "giving-agents-tools",
  diagrams: {
    "tool-call-wire": {
      alt: "One question, four steps, one growing list of messages. Step 1: our code sends the user's message and the tool menu, a JSON schema for square_root, to the model. Step 2: the model replies with no text, only a tool call: name square_root, arguments as a JSON string with number 144, and an id. Step 3: our code parses the arguments, runs the real Python function, and appends a message with role tool, the same id and the content 12.0. Step 4: our code sends the whole list again and the model answers in words: the square root of 144 is 12.",
      draw(c) {
        c.size(720, 392).title("A tool call is four messages and two model calls");
        const code = c.box(20, 60, 180, 290, "our code", { tone: "raised", lines: ["holds the messages list", "", "runs square_root(144)", "", "sends the list twice"] });
        const model = c.box(520, 60, 180, 290, "the model", { tone: "amber", lines: ["sees names, descriptions", "and schemas only,", "never the Python"] });
        const steps = [
          ["1. user + tool menu", "plain", "{role: user, …} + tools=[…]"],
          ["2. assistant: tool_calls", "cream", "square_root, '{\"number\": 144}', id"],
          ["3. role: tool, same id", "green", 'content "12.0"'],
          ["4. assistant: text", "plain", "The square root of 144 is 12."],
        ];
        steps.forEach(([name, tone, line], i) => {
          const y = 70 + i * 70;
          c.box(230, y, 260, 52, name, { tone, lines: [line], size: 12, mono: false });
          if (i === 0) c.arrow([490, y + 26], [518, y + 26]);
          if (i === 1 || i === 3) c.arrow([518, y + 26], [490, y + 26]);
          if (i === 2) c.arrow([202, y + 26], [228, y + 26]);
        });
        c.para(20, 372, "The arguments arrive as a JSON string, hence json.loads. A tool result without a matching id is rejected.", { width: 680, fill: MUTED });
        c.flow("our code", "the model", "", "request");
        c.flow("the model", "our code", "", "metadata");
        c.flow("our code", "the model", "", "data");
        c.flow("the model", "our code", "", "data");
        void code;
        void model;
      },
    },

    "two-providers": {
      alt: "The same lab code on two providers through one file, llm.py. With LLM_PROVIDER set to groq, make_llm and make_client return OpenAI-compatible objects pointed at Groq's API and openai/gpt-oss-120b, and tool calls are native: the API returns tool_calls. With LLM_PROVIDER set to claude, they return a stand-in that runs Claude Haiku 5.5 through Claude Code in headless mode on a Claude subscription. Claude Code gives no raw tool-calling API, so the stand-in lists the functions in the system prompt and asks for one JSON object, either tool_calls or an answer, then turns that into the same tool_calls shape. Both use the local all-MiniLM-L6-v2 for embeddings.",
      draw(c) {
        c.size(720, 340).title("One switch, two providers, the same lab code");
        const lab = c.box(20, 130, 150, 64, "lab code", { tone: "plain", lines: "make_llm(), make_client()" });
        const sw = c.box(210, 130, 120, 64, "llm.py", { tone: "amber", lines: "LLM_PROVIDER" });
        const groq = c.box(380, 50, 320, 90, "groq", { tone: "green", lines: ["openai/gpt-oss-120b on Groq's API", "OpenAI-compatible: native tool_calls", "and JSON mode"] });
        const claude = c.box(380, 180, 320, 104, "claude", { tone: "cream", lines: ["Claude Haiku 5.5 via claude -p", "(Claude Code, subscription login)", "tools listed in the prompt; reply is", "JSON: tool_calls or answer"] });
        c.arrow(lab.right, sw.left);
        c.arrow([330, 150], [378, 95]);
        c.arrow([330, 175], [378, 232]);
        c.para(20, 304, "Embeddings: neither has an endpoint, so both use the local all-MiniLM-L6-v2. Emulated tool calls were 6 of 6 correct in a spot check once the CLI's own structured-output tool was left out.", { width: 680, fill: MUTED });
        c.flow("lab code", "llm.py", "", "request");
        c.flow("llm.py", "groq", "", "request");
        c.flow("llm.py", "claude", "", "request");
        void groq;
        void claude;
      },
    },
  },
};

export default post;
