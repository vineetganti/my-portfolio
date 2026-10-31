import fs from "node:fs";
import path from "node:path";
import { isValidElement } from "react";
import { MDXRemote } from "next-mdx-remote/rsc";
import remarkGfm from "remark-gfm";
import rehypeSlug from "rehype-slug";
import rehypeHighlight from "rehype-highlight";
import Callout from "@/components/Callout";
import CopyButton from "@/components/CopyButton";

type HeadingProps = React.ComponentPropsWithoutRef<"h2">;

// Adds a hover "#" permalink to headings that rehype-slug gave an id.
function anchored(Tag: "h2" | "h3" | "h4") {
  return function Heading({ id, children, ...rest }: HeadingProps) {
    return (
      <Tag id={id} {...rest}>
        {id && (
          <a href={`#${id}`} className="heading-anchor" aria-label="Link to this section">
            #
          </a>
        )}
        {children}
      </Tag>
    );
  };
}

function CodeBlock({ children, ...rest }: React.ComponentPropsWithoutRef<"pre">) {
  const className = isValidElement<{ className?: string }>(children)
    ? children.props.className ?? ""
    : "";
  const language = /language-([\w-]+)/.exec(className)?.[1] ?? "code";

  return (
    <div className="code-block">
      <div className="code-bar">
        <span>{language}</span>
        <CopyButton />
      </div>
      <pre {...rest}>{children}</pre>
    </div>
  );
}

function Table(props: React.ComponentPropsWithoutRef<"table">) {
  return (
    <div className="table-wrap">
      <table {...props} />
    </div>
  );
}

const PUBLIC_DIR = path.join(process.cwd(), "public");
const diagramCache = new Map<string, string | null>();

// Reads a local SVG diagram so it can be inlined, where the theme's CSS can
// recolour it. Ids get a per-file prefix so two diagrams on a page can't clash.
function readDiagram(src: string): string | null {
  if (!src.startsWith("/images/") || !src.endsWith(".svg")) return null;
  if (diagramCache.has(src)) return diagramCache.get(src) ?? null;

  const file = path.join(PUBLIC_DIR, src);
  let svg: string | null = null;
  if (file.startsWith(PUBLIC_DIR + path.sep) && fs.existsSync(file)) {
    const prefix = path.basename(src, ".svg");
    svg = fs
      .readFileSync(file, "utf-8")
      .replace(/<\?xml[^>]*\?>\s*/, "")
      .replace(/\bid="([^"]+)"/g, `id="${prefix}-$1"`)
      .replace(/url\(#([^)]+)\)/g, `url(#${prefix}-$1)`)
      .replace(/href="#([^"]+)"/g, `href="#${prefix}-$1"`)
      .replace(/<svg\b/, '<svg aria-hidden="true" focusable="false"');
  }
  diagramCache.set(src, svg);
  return svg;
}

function Image({ src, alt, ...rest }: React.ComponentPropsWithoutRef<"img">) {
  const svg = typeof src === "string" ? readDiagram(src) : null;
  if (svg === null) {
    // Raster images are served as-is, without next/image resizing.
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={alt} {...rest} />;
  }
  return (
    <span
      className="diagram"
      role="img"
      aria-label={alt}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

const components = {
  h2: anchored("h2"),
  h3: anchored("h3"),
  h4: anchored("h4"),
  pre: CodeBlock,
  table: Table,
  img: Image,
  Callout,
};

export default function MdxContent({ source }: { source: string }) {
  return (
    <div className="prose prose-lg max-w-none">
      <MDXRemote
        source={source}
        components={components}
        options={{
          mdxOptions: {
            remarkPlugins: [remarkGfm],
            rehypePlugins: [rehypeSlug, rehypeHighlight],
          },
        }}
      />
    </div>
  );
}
