/**
 * Reads a code fence's meta string (the text after the language) and passes two options to the
 * code block in MdxContent:
 *
 *   ```python title="agentic_bug_fixing/agent.py · lines 144–154"   → a title in the block's top bar
 *   ```text output title="python -m agentic_bug_fixing"             → printed output, joined to the block above
 *
 * `title` must use double quotes. `output` is a bare word. Anything else in the meta is ignored.
 */

interface HastNode {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
  data?: { meta?: string | null };
}

export function parseCodeMeta(meta: string): { title?: string; output: boolean } {
  const titleMatch = /(?:^|\s)title="([^"]*)"/.exec(meta);
  const rest = titleMatch ? meta.replace(titleMatch[0], " ") : meta;
  return {
    title: titleMatch?.[1].trim() || undefined,
    output: /(?:^|\s)output(?:\s|$)/.test(rest),
  };
}

export default function rehypeCodeMeta() {
  return (tree: HastNode) => {
    const walk = (node: HastNode) => {
      if (node.type === "element" && node.tagName === "pre") {
        const code = node.children?.find((c) => c.type === "element" && c.tagName === "code");
        const meta = code?.data?.meta;
        if (meta) {
          const { title, output } = parseCodeMeta(meta);
          node.properties = {
            ...node.properties,
            ...(title ? { dataTitle: title } : {}),
            ...(output ? { dataOutput: "true" } : {}),
          };
        }
      }
      node.children?.forEach(walk);
    };
    walk(tree);
  };
}
