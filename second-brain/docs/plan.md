# Plan

Reuses what was built in Trip Buddy: an MCP server, structured output, memory and a human-in-the-loop gate.

## Pipeline

### 1. Ingest (Gmail, read-only)
- Use the Gmail API with the `gmail.readonly` scope, so the agent can never send or delete anything.
- Run one query per day, such as `newer_than:1d`.
- Detect newsletters by the `List-Unsubscribe` header, a Gmail label you apply, or a sender allowlist in SQLite. Start with the allowlist, since it's the most predictable, and add header detection later to suggest new senders.
- Gotcha: Google test-mode OAuth refresh tokens expire after about 7 days, so plan for re-auth or move the app out of testing.

### 2. Parse and extract
- Convert the MIME HTML to clean text using BeautifulSoup or trafilatura. Keep link text together with its URL.
- Strip tracking parameters and resolve redirect links (Substack, Mailchimp and similar).
- Drop non-content links: unsubscribe, sponsors, social, "view in browser".
- Optionally fetch the target page for linked-article newsletters, and use the inline text for full-content ones. Treat paywalled pages as "summary from email only".

### 3. Dedupe
- First pass: hash the canonical URL.
- Second pass: embedding similarity (Chroma), to catch the same story from three newsletters. Merge these into one item with multiple sources.

### 4. Summarize with structured output
- One LLM call per newsletter. It returns validated items like `{title, url, source, type, topics[], summary_2_lines, why_it_matters}`.
- Tell the model to use only the email's text and never invent details, and add a `confidence` field.
- Cap items per day (say 30) and rank them, so the brief stays readable.

### 5. The brief (single view)
- A small page (Gradio or an HTML artifact), grouped by topic with a checkbox, editable tags and a "skip" action per item.
- A scheduled job produces it every morning (about 7:00 IST) and pings you with the link.

### 6. Approval, then Notion
- Nothing is written to Notion until you approve. That's the gate, like the approval step in the support-copilot idea.
- Write through the Notion API, either as a small MCP server or the official integration.
- Keep writes idempotent by checking the URL property before creating a page, so retries and re-approvals never duplicate. Notion allows roughly 3 requests per second, so batch with a short delay.

## Notion schema (second brain)
- **Resources**: Title, URL, Source newsletter (relation), Type (article, tool, paper, video), Topics (relation), Summary, Key takeaways (page body), Status (Inbox / Reading / Done), Date saved, Relevance.
- **Topics**: your areas of interest (AI agents, PM, data engineering…), organized PARA-style.
- **Newsletters**: sender, keep/drop rate, which later feeds ranking.
- Lean on relations and a few views (by topic, unread, this week) rather than many properties.

## Learning loop
- Log every approve/skip decision.
- Semantic memory holds your interests ("prefers agent engineering over funding news"). Procedural memory holds rules ("skip sponsor roundups").
- Use these to rank tomorrow's brief. After 2–3 weeks the approval rate should rise, and that's the success metric.
- Later, embed saved items so the brief can say "related to 3 notes you saved" and you can ask questions over your own Notion.

## Safety and quality
- **Prompt injection**: email content is untrusted. The model only gets "extract and summarize" instructions, has no tools that can act on the email's text, and its output is validated against the schema.
- **Evals**: hand-label about 30 real newsletter emails. Measure link-extraction precision (ads and tracking filtered out), summary faithfulness, and dedupe accuracy. Rerun them whenever you change the prompt or model.
- **Cost**: a daily run on Gemini flash-lite should cost very little. Log tokens per run.

## Build order
1. Gmail fetch plus parse, printed to the terminal (no LLM).
2. Structured extraction and dedupe, with the eval set.
3. The brief UI and the schedule.
4. Notion writer with approval and idempotency.
5. Memory and ranking.
6. Optional: a Local Guide-style second agent for "go deeper on this article".
