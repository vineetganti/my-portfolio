import fs from "node:fs";
import path from "node:path";
import { isValidElement } from "react";
import { MDXRemote } from "next-mdx-remote/rsc";
import remarkGfm from "remark-gfm";
import rehypeSlug from "rehype-slug";
import rehypeHighlight from "rehype-highlight";
import Callout from "@/components/Callout";
import CopyButton from "@/components/CopyButton";
import DiagramMotion from "@/components/DiagramMotion";
import FlowDiagram from "@/components/flow/FlowDiagram";
import { isMarkerType, type FlowStep } from "@/components/flow/markers";
import QueueingKnee from "@/components/charts/QueueingKnee";
import NaiveFillWait from "@/components/charts/NaiveFillWait";
import PoissonArrivals from "@/components/charts/PoissonArrivals";
import DecodeLatency from "@/components/charts/DecodeLatency";
import DtypeMemory from "@/components/charts/DtypeMemory";

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

// A diagram can ship a `<name>.flow.json` beside its SVG: the steps of a looping message-flow
// animation (see components/flow). No file, no animation.
const flowCache = new Map<string, FlowStep[] | null>();
function readFlow(src: string): FlowStep[] | null {
  if (flowCache.has(src)) return flowCache.get(src) ?? null;
  const file = path.join(PUBLIC_DIR, src.replace(/\.svg$/, ".flow.json"));
  let steps: FlowStep[] | null = null;
  if (file.startsWith(PUBLIC_DIR + path.sep) && fs.existsSync(file)) {
    try {
      const raw: unknown = JSON.parse(fs.readFileSync(file, "utf-8")).steps;
      const valid = Array.isArray(raw)
        ? raw.filter((s): s is FlowStep => typeof s?.from === "string" && typeof s?.to === "string" && isMarkerType(s?.type))
        : [];
      steps = valid.length > 0 ? valid : null;
    } catch {
      steps = null;
    }
  }
  flowCache.set(src, steps);
  return steps;
}

function Image({ src, alt, ...rest }: React.ComponentPropsWithoutRef<"img">) {
  const svg = typeof src === "string" ? readDiagram(src) : null;
  if (svg === null) {
    // Raster images are served as-is, without next/image resizing.
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={alt} {...rest} />;
  }
  const steps = typeof src === "string" ? readFlow(src) : null;
  if (steps) return <FlowDiagram svg={svg} steps={steps} alt={alt ?? ""} />;
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
  QueueingKnee,
  NaiveFillWait,
  PoissonArrivals,
  DecodeLatency,
  DtypeMemory,
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
      <DiagramMotion />
    </div>
  );
}
