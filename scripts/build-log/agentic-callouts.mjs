// Writes the series list into every Agentic AI post, inside the callout titled "This is part of a series",
// with the current post in bold. The order comes from each post's `seriesOrder`, so renumbering a post is
// a frontmatter edit followed by:  node scripts/build-log/agentic-callouts.mjs
import fs from "node:fs";
import path from "node:path";

// slug -> [short title, one-line blurb]. A post missing here fails loudly rather than printing a blank line.
const BLURBS = {
  "hello-agent": ["Building my first AI agent", "what an agent is, and a first working agent."],
  "giving-agents-tools": ["Giving an AI agent tools", "from a plain function to a multi-tool assistant, and what a tool call looks like on the wire."],
  "retrieval-for-agents": ["Finding the right text", "embeddings, similarity search, reranking, chunking and HyDE."],
  "how-ai-agents-remember": ["How AI agents remember", "why a stateless model needs memory, and keeping one conversation under control."],
  "long-term-agent-memory": ["Memory that lasts", "semantic, episodic and procedural memory, and memory that updates itself."],
  "agents-working-together": ["Agents that work together", "supervisor, agent as tool, graph and swarm."],
  "how-agents-talk": ["How agents talk", "MCP for tools, A2A for other agents."],
  "agents-to-production": ["Shipping agents to production", "Lambda, ECS Fargate and AgentCore."],
  "observing-agents": ["Seeing inside an agent", "monitoring vs observability, MELT, traces, and a booking agent that might lie."],
  "agent-evaluation": ["Evaluating an agent", "component evals, error analysis, LLM judges and Cohen's kappa."],
  "agent-guardrails": ["Guardrails and policy", "prompt attacks, rail layers, NeMo Guardrails, Bedrock Guardrails and Cedar."],
  "trip-buddy-agent": ["Trip Buddy: one agent, built up in 15 lessons", "RAG, tools, MCP, memory and A2A in one app."],
  "inventory-agent": ["The inventory agent", "from one prompt to a guarded, cached, traced assistant in eight versions."],
  "agentic-bug-fixing": ["A bug-fixing agent", "a LangGraph loop that repairs crashing Python, and the stray bracket that beat it."],
};

const OPEN = '<Callout type="info" title="This is part of a series">';
const dir = path.join(process.cwd(), "content/blog");

const posts = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith(".mdx"))
  .map((f) => ({ file: path.join(dir, f), slug: f.replace(/\.mdx$/, ""), text: fs.readFileSync(path.join(dir, f), "utf8") }))
  .filter((p) => /^series:\s*"?agentic-ai"?\s*$/m.test(p.text))
  .map((p) => ({ ...p, order: Number(p.text.match(/^seriesOrder:\s*(\d+)/m)?.[1]) }))
  .sort((a, b) => a.order - b.order);

for (const p of posts) {
  if (!BLURBS[p.slug]) throw new Error(`${p.slug}: add it to BLURBS`);
}

for (const p of posts) {
  const eol = p.text.includes("\r\n") ? "\r\n" : "\n";
  const items = posts.map((q, i) => {
    const [title, blurb] = BLURBS[q.slug];
    return q.slug === p.slug ? `${i + 1}. **${title}** (this post): ${blurb}` : `${i + 1}. [${title}](/blog/${q.slug}): ${blurb}`;
  });
  const start = p.text.indexOf(OPEN);
  if (start === -1) throw new Error(`${p.slug}: no series callout`);
  const end = p.text.indexOf("</Callout>", start);
  const block = [OPEN, "", ...items, "", ""].join(eol);
  const next = p.text.slice(0, start) + block + p.text.slice(end);
  if (next !== p.text) fs.writeFileSync(p.file, next);
  console.log(`${p.slug}: part ${p.order}`);
}
