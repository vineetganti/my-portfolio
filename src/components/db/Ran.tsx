import { labItem } from "@/lib/dbLab";
import CopyButton from "@/components/CopyButton";

/**
 * `<Ran src="acid/psql-demo" />`: commands and the output they really printed, read from a
 * recording. Nothing in this block is typed by hand. Commands and output are styled apart, so the
 * block labels which is which.
 */
export default function Ran({ src, title }: { src: string; title?: string }) {
  const run = labItem("runs", src);
  return (
    <div className="code-block ran-block">
      <div className="code-bar">
        <span className="ran-label">
          ✅ ran here · {run.engine}
          {title ? ` · ${title}` : ""}
        </span>
        <CopyButton />
      </div>
      <pre>
        <code>
          {run.blocks.map((b, i) => (
            <span key={i}>
              <span className="ran-cmd">{b.cmd}</span>
              {"\n"}
              {b.out && <span className="ran-out">{b.out + "\n"}</span>}
              {i < run.blocks.length - 1 && "\n"}
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}
