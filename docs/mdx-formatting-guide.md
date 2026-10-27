# MDX formatting guide for blog posts

A reference for writing posts in `content/blog/`. Everything here describes what
this site actually renders: `next-mdx-remote` with `remark-gfm`, `rehype-slug`
and `rehype-highlight`, styled by `src/app/globals.css`.

---

## 1. Creating a post

- One file per post: `content/blog/<slug>.mdx`. Only `.mdx` files are read.
- **The filename is the URL.** `agents-part-2.mdx` → `/blog/agents-part-2`.
  Use lowercase and hyphens, with no spaces. `mit-distributed systems - lecture1.mdx`
  becomes `/blog/mit-distributed%20systems%20-%20lecture1`.
- Posts are sorted newest first by `date`.
- Reading time ("6 min read") is calculated for you.

### Frontmatter

```yaml
---
title: "Building my first AI agent"
description: "One or two sentences. Shown under the title, on the post card, and as the meta description."
date: "2026-10-25"
tags: ["Agentic AI", "LLMs"]
toc: false        # optional. Leave it out to show the table of contents
---
```

| Field         | Required | Notes                                                                 |
| ------------- | -------- | --------------------------------------------------------------------- |
| `title`       | yes      | Rendered as the page's only `h1`. Falls back to the slug.             |
| `description` | no       | Large lead paragraph under the title. Keep it to 1–2 sentences.        |
| `date`        | yes      | `YYYY-MM-DD`, quoted. Displayed as "October 25, 2026".                |
| `tags`        | no       | A YAML array of strings, rendered as pills under the description.     |
| `toc`         | no       | `false` hides the table of contents. Defaults to on.                  |

> If `date` is missing, the post gets today's date on every build, which shuffles
> its position in the list. Always set it.

---

## 2. Headings and the table of contents

Start sections at `##`. The post title is already the page's `h1`, so don't use `#`
in the body (it renders at `h2` size but is left out of the TOC).

```md
## Section          → TOC entry
### Subsection      → indented TOC entry
#### Detail         → indented TOC entry only if there are no ## headings
```

How the TOC is built (`src/lib/blog.ts`):

- It reads `##`, `###` and `####` headings.
- The **shallowest level you use** becomes the top level, and only one level below
  it is listed. If a post uses only `###`, then `###` entries are top level and
  `####` entries are indented.
- The TOC appears only when there are **two or more** qualifying headings. On
  desktop it is a sticky sidebar; on mobile it is a "Contents" bar under the header.
- Every `##`/`###`/`####` gets an id and a `#` permalink that appears on hover.

Heading tips:

- Ids come from the heading text: `### Step 1: Install dependencies` →
  `#step-1-install-dependencies`. Repeated headings get `-1`, `-2` suffixes.
  Renaming a heading breaks links to its old anchor.
- Keep headings short. They double as TOC labels.
- Don't use bold text as a fake heading (`**Key Lessons**`). Use `####` so it
  gets an anchor, or keep it bold on purpose if it shouldn't appear in the TOC.
- Don't put headings inside a `<Callout>`.

---

## 3. Text

| You write                     | You get                                   |
| ----------------------------- | ----------------------------------------- |
| `**bold**`                    | **bold** (stronger text colour)           |
| `*italic*` or `_italic_`      | *italic*                                  |
| `~~struck~~`                  | ~~struck~~                                |
| `` `inline code` ``           | `inline code` (tinted pill, mono font)    |
| `***bold italic***`           | ***bold italic***                         |

- **Paragraphs** are separated by a blank line. A single newline inside a
  paragraph is joined into one line, so hard-wrapping your source is fine.
- **Forced line break** without a new paragraph: end the line with a backslash `\`
  or with two trailing spaces. Prefer the backslash because trailing spaces are invisible
  and editors strip them.
- **Horizontal rule**: `---` on its own line, with blank lines around it. It renders
  as a thin divider with generous spacing. Good for separating major parts of a
  long post.

---

## 4. Links

```md
[Groq console](https://console.groq.com/keys)
[another post](/blog/why-i-write)
[jump to a section](#step-2-choose-the-model)
https://example.com          ← bare URLs autolink (GFM)
```

- **No space** between `]` and `(`. `[text] (url)` renders as literal text.
- Links are underlined, and the underline darkens on hover.
- Links open in the same tab. For a new tab, use JSX:
  `<a href="https://…" target="_blank" rel="noreferrer">text</a>`.

---

## 5. Lists

```md
- Bullet
- Another bullet
  - Nested (indent 2 spaces under a `-` item)

1. Ordered
2. Items
   - Nested under an ordered item (indent 3 spaces)

- [x] Task done
- [ ] Task to do
```

- Leave a **blank line before a list** that follows a paragraph. Without one, the
  list can be read as part of the paragraph.
- Leave a blank line after the list too. A line directly under the last item
  is joined onto that item.
- A list item can hold more paragraphs, code or a callout if you indent them to the
  item's text column:

  ````md
  1. Install the SDK:

     ```bash
     pip install strands-agents
     ```

  2. Set your key.
  ````

- To label items, start them with a bold phrase:
  `- **LPU:** Groq's custom chip, built for inference.`

---

## 6. Code blocks

Fence code with three backticks and **always add a language**:

````md
```python
agent = Agent(model=model)
```
````

What you get:

- A dark olive panel with a top bar that shows the language name and a **Copy**
  button.
- Syntax highlighting for the language you named. Nothing is auto-detected: a fence
  with no language is shown without highlighting and labelled `code`.
- Horizontal scrolling for long lines (they don't wrap).

**Languages that are highlighted** (the language name or an alias):

`bash` / `sh` / `zsh` · `shell` / `console` (terminal sessions with `$` prompts) ·
`python` / `py` · `python-repl` (`>>>` sessions) · `javascript` / `js` / `jsx` ·
`typescript` / `ts` / `tsx` · `json` · `yaml` / `yml` · `toml` / `ini` ·
`html` / `xml` · `css` / `scss` / `less` · `rust` / `rs` · `go` · `java` ·
`kotlin` · `c` · `cpp` · `csharp` · `swift` · `sql` · `graphql` · `diff` ·
`markdown` / `md` · `makefile` · `lua` · `ruby` · `php` · `r` · `perl` ·
`objectivec` · `vbnet` · `wasm` · `arduino` · `plaintext` / `text` / `txt`

Anything else (for example `dockerfile`, `elixir` or `hcl`) still renders and
shows its label, just without colours.

Conventions that work well:

| Content                          | Fence language |
| -------------------------------- | -------------- |
| Code the reader runs             | the real language (`python`, `rust`, …) |
| Shell commands                   | `bash`         |
| Program or model output, logs    | `text`         |
| Before/after changes             | `diff` (lines starting with `+` / `-`) |
| Config files                     | `json`, `yaml`, `toml` |

**Show output in a code block, not as loose paragraphs.** Agent replies,
`Tool #1: …` lines and printed results are easy to confuse with your own prose
when written as plain text, and markdown inside them (`**bold**`, `-` bullets)
gets rendered. Wrap them in a `text` fence:

````md
```text
Tool #1: current_time
Tool #2: current_time
Bangalore: Sunday, 25 October 2026 09:16 PM IST
```
````

Not supported: file-name titles, line numbers, highlighting specific lines.

To show a fence inside a code block (as this guide does), use four backticks
for the outer fence.

---

## 7. Callouts

The one custom component. Use it to pull a point out of the flow.

```mdx
<Callout type="tip">
  Pick Groq for the free tier and fast inference.
</Callout>

<Callout type="warn" title="Free tier limits">
  A looping agent can hit rate limits fast. Expect an HTTP 429 or two.
</Callout>
```

| `type`    | Default title           | Look                     | Use it for                     |
| --------- | ----------------------- | ------------------------ | ------------------------------ |
| `note`    | Note                    | plain card (the default) | asides, context                |
| `info`    | Good to know            | vanilla tint             | background facts               |
| `tip`     | Tip                     | green tint               | practical advice, shortcuts    |
| `analogy` | Think of it like this   | amber tint, sparkle icon | mental models, comparisons     |
| `warn`    | Watch out               | red tint, warning icon   | pitfalls, costs, breaking changes |

- `title` is optional and replaces the default label.
- An unknown `type` falls back to `note` styling and icon.
- **Markdown inside callouts:** for anything beyond one short sentence, put blank
  lines after the opening tag and before the closing tag. Then lists, bold, links
  and even code blocks work:

  ````mdx
  <Callout type="analogy" title="LLM vs agent">

  The LLM is the **brain**, tools are the **hands**, and the loop ties them together.

  - Chat: one prompt in, one answer out
  - Agent: decide → call a tool → read the result → repeat

  </Callout>
  ````

- Use them sparingly, at most one every few screens, or they stop standing out.

---

## 8. Images

1. Put the file in `public/` (e.g. `public/agent-loop.png`).
2. Reference it from the site root:

```md
![Agent loop: model → tool → result → model](/agent-loop.png)
```

- Every image gets a **white backing, 12px padding, a rounded border**, and spans
  up to the full text width. This keeps transparent diagrams drawn on white readable
  on both the light and dark olive themes. Diagrams with a white or transparent
  background look best. Dark screenshots will sit inside a white frame.
- **Write real alt text** that says what the image shows, not the filename
  (`![full_system_architecture](…)` is read aloud as "full system architecture").
- Name files in kebab-case. Consider a folder per post:
  `public/blog/hello-agent/loop.png` → `/blog/hello-agent/loop.png`.
- **Caption:** use a figure (captions are styled in the muted text colour):

  ```mdx
  <figure>
    <img src="/agent-loop.png" alt="The agent loop" />
    <figcaption>The loop runs until the model decides the task is done.</figcaption>
  </figure>
  ```

- **Smaller image:** `<img src="/logo.png" alt="Groq logo" width={240} />`.
  In JSX, numeric attributes use braces.
- Prefer PNG/SVG for diagrams and WebP/JPEG for photos, and compress large files.
  Images are served as-is, with no automatic resizing.

---

## 9. Blockquotes

```md
> Start simple, iterate fast, and don't over-engineer on the first pass.
```

Renders with an olive left border, not italicised. Use it for quotations or an
attributed line. For a tip or a warning, a `<Callout>` reads better.

Multi-paragraph quote: put `>` on the blank line too.

```md
> First paragraph.
>
> Second paragraph. — *Someone*
```

---

## 10. Tables

```md
| Tier      | Requests/min | Cost          |
| --------- | -----------: | ------------- |
| Free      |           30 | $0            |
| Developer |         300+ | pay-as-you-go |
```

- Rendered in a rounded card with a tinted header row. Wide tables scroll
  sideways on phones instead of breaking the layout.
- Alignment: `:---` left, `:---:` centre, `---:` right (use right for numbers).
- Cells can contain `` `code` ``, **bold** and links, but not lists or line breaks.
  Use `<br />` for a break inside a cell. Escape a literal pipe as `\|`.
- The header row and the `---` divider row are required.

---

## 11. Footnotes

```md
Groq runs models on a custom chip called an LPU.[^lpu]

[^lpu]: Language Processing Unit, built for inference rather than training.
```

Footnotes are numbered automatically, collected at the bottom of the post, and
linked both ways. Good for sources and side notes that would break the flow.

---

## 12. Other HTML that works

MDX accepts JSX, so standard HTML elements render with the prose styling:

```mdx
Press <kbd>Ctrl</kbd> + <kbd>C</kbd> to stop the server.

H<sub>2</sub>O and E = mc<sup>2</sup>

<details>
  <summary>Full pip output</summary>

  ```text
  Successfully installed strands-agents-1.60.0 …
  ```

</details>
```

`<details>` is handy for long output or optional deep dives. It is unstyled
beyond the defaults but works on every theme.

Avoid inline `style` and Tailwind classes in posts. They aren't part of the
theme tokens, so they won't adapt to light and dark mode.

---

## 13. MDX gotchas (things that break the build)

MDX is stricter than plain Markdown because `{`, `}` and `<` mean JSX.

| Problem                                   | Fix                                                     |
| ----------------------------------------- | ------------------------------------------------------- |
| `<` in prose: `versions <2.0`, `a<b`     | Put it in backticks (`` `<2.0` ``) or write `&lt;`      |
| `{` or `}` in prose: `returns {"a": 1}`  | Put it in backticks or a code block, or escape: `\{`   |
| HTML comments `<!-- draft -->`            | Use `{/* draft note */}`                                |
| `<br>`, `<img …>` (unclosed tags)         | Self-close them: `<br />`, `<img … />`                 |
| `class="…"` on HTML                       | Use `className="…"`                                     |
| Unclosed `<Callout>`                      | Every component needs its closing tag                   |
| Code with no fence                        | Indented code (4 spaces) is **not** a code block in MDX. Always fence it |

Inside code blocks and inline code, all of these characters are safe.

If the dev server shows an MDX compile error, the message includes a
line:column. Check that spot for a stray `<` or `{`.

---

## 14. Post template

````mdx
---
title: "Post title"
description: "What the reader will get from this, in one or two sentences."
date: "2026-10-26"
tags: ["Tag One", "Tag Two"]
---

Opening paragraph: why this post exists and what you'll cover.

## First section

Prose, then code:

```python
print("hello")
```

```text
hello
```

<Callout type="tip">
  One practical takeaway.
</Callout>

## Second section

### A step

- Point one
- Point two

---

## Wrapping up

What you learned and where to go next.

## Resources

- [Resource name](https://example.com)
````

---

## 15. Pre-publish checklist

- [ ] Filename is kebab-case with no spaces
- [ ] `title`, `description`, `date` (quoted `YYYY-MM-DD`) and `tags` are set
- [ ] Sections start at `##`, with no `#` in the body
- [ ] Every code fence has a language; output is in `text` fences
- [ ] Links have no space between `]` and `(`
- [ ] Images live in `public/` and have descriptive alt text
- [ ] No stray `<`, `{` or `}` outside backticks
- [ ] Previewed with `npm run dev` at `http://localhost:3000/blog/<slug>` in both
      light and dark mode (theme toggle in the header)
