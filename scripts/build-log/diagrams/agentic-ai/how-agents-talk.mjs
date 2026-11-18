// Diagrams added to content/blog/how-agents-talk.mdx (Agentic AI) for Part 3, MCP from the host's side.
// The post's older diagrams were drawn by hand and are not here.
//   node scripts/build-log/draw.mjs how-agents-talk
import { GREEN, MUTED, RED } from "../../../db-lab/canvas.mjs";

const post = {
  slug: "how-agents-talk",
  diagrams: {
    "host-loop": {
      alt: "The notebook's host, with no agent framework. It opens a FastMCP client to the server, lists the tools and converts each one's input schema into the chat API's tool format. It sends the question and tools to the model, runs every requested tool through the client's call_tool, adds the results and asks the model once more, this time without tools. Asked for the time and weather in Tokyo, Claude asked for both tools in its first reply and the single round was enough. Groq's model asked for the time first, saw the result, and wanted to call get_weather in the second reply, but tools were no longer offered, so the API answered with HTTP 400: tool choice is none, but model called a tool.",
      draw(c) {
        c.size(720, 350).title("One round of tools is not a loop");
        const host = c.box(20, 60, 170, 70, "host (notebook)", { tone: "raised", lines: ["list_tools -> chat format", "then ask the model"] });
        const model = c.box(275, 60, 170, 70, "model", { tone: "amber", lines: ["call 1: tools offered", "call 2: no tools"] });
        const server = c.box(530, 60, 170, 70, "FastMCP server", { tone: "green", lines: ["get_current_time", "get_weather (Open-Meteo)"] });
        c.arrow([190, 85], [273, 85]);
        c.arrow([273, 108], [190, 108]);
        c.route([[105, 130], [105, 150], [615, 150], [615, 132]], { label: "call_tool via the client", labelAt: [360, 150], labelDy: 14 });
        c.box(20, 180, 330, 76, "Claude: 'time and weather in Tokyo'", { tone: "green", lines: ["both tools asked for in call 1", "call 2 answers: worked"] });
        c.box(370, 180, 330, 76, "Groq: the same question", { tone: "red", lines: ["call 1 asks for the time only", "call 2 wants get_weather: HTTP 400"] });
        c.para(20, 276, "The fix is the loop every framework runs: keep offering the tools and keep calling until the model stops asking. Both runs also reported 'Bangalore Town' as Bangalore: the geocoder's first match for 'Bangalore' is a place in Sindh, Pakistan.", { width: 680, fill: MUTED });
        c.flow("host (notebook)", "model", "", "request");
        c.flow("model", "host (notebook)", "", "metadata");
        c.flow("host (notebook)", "FastMCP server", "call_tool via the client", "request");
        void host;
        void model;
        void server;
      },
    },

    "mcp-threats": {
      alt: "Four ways an MCP setup is attacked, all because the model reads every piece of text as possible instructions. Prompt injection: a tool result contains hidden instructions, such as a web page saying ignore previous instructions. Tool poisoning: a server hides instructions in a tool's description, which the model reads while planning. Rug pull: a server behaves well when reviewed, then an update changes it; the postmark-mcp npm package worked for 15 versions, then version 1.0.16 blind-copied every email to an attacker. Confused deputy: a powerful server, such as one that can send email, is steered through the model into acting for the attacker. Defences: label tool output as data, pin and hash reviewed tool descriptions, give each server the least power it needs, and ask a human before destructive actions.",
      draw(c) {
        c.size(720, 340).title("The model is the attack surface");
        const threats = [
          ["prompt injection", "red", ["instructions hidden in", "a tool's result"]],
          ["tool poisoning", "red", ["instructions hidden in", "a tool's description"]],
          ["rug pull", "red", ["fine when reviewed,", "changed by an update"]],
          ["confused deputy", "red", ["a powerful server steered", "through the model"]],
        ];
        threats.forEach(([n, t, l], i) => c.box(20 + i * 172, 56, 160, 76, n, { tone: t, lines: l, size: 12 }));
        c.box(20, 156, 680, 56, "postmark-mcp, September 2025", { tone: "amber", lines: ["15 clean versions, then 1.0.16 blind-copied every email the AI sent to the attacker's address"] });
        const fixes = [
          ["label output as data", "green"],
          ["pin + hash descriptions", "green"],
          ["least privilege", "green"],
          ["a human approves deletes, sends", "green"],
        ];
        fixes.forEach(([n, t], i) => c.box(20 + i * 172, 236, 160, 48, n, { tone: t, size: 11.5 }));
        c.para(20, 304, "For a model, data and code are the same thing: text. Anything it reads can try to steer it.", { width: 680, fill: MUTED });
        void GREEN;
        void RED;
      },
    },
  },
};

export default post;
