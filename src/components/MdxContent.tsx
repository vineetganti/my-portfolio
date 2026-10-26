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

const components = {
  h2: anchored("h2"),
  h3: anchored("h3"),
  h4: anchored("h4"),
  pre: CodeBlock,
  table: Table,
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
