import { Info, Lightbulb, Sparkles, StickyNote, TriangleAlert } from "lucide-react";

const VARIANTS = {
  note: { icon: StickyNote, label: "Note" },
  info: { icon: Info, label: "Good to know" },
  tip: { icon: Lightbulb, label: "Tip" },
  analogy: { icon: Sparkles, label: "Think of it like this" },
  warn: { icon: TriangleAlert, label: "Watch out" },
};

/**
 * Usage in MDX:
 *   <Callout type="tip" title="Optional title">Body text</Callout>
 */
export default function Callout({
  type = "note",
  title,
  children,
}: {
  type?: keyof typeof VARIANTS;
  title?: string;
  children: React.ReactNode;
}) {
  const variant = VARIANTS[type] ?? VARIANTS.note;
  const Icon = variant.icon;

  return (
    <aside className={`callout ${type} not-prose`}>
      <p className="callout-title">
        <span className="callout-ico">
          <Icon size={16} />
        </span>
        {title ?? variant.label}
      </p>
      <div className="callout-body prose prose-lg max-w-none">{children}</div>
    </aside>
  );
}
