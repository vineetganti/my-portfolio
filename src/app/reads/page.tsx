import fs from "fs";
import path from "path";

export const metadata = {
  title: "Good reads",
  description: "Engineering posts and articles worth reading, picked by me.",
};

interface Read {
  title: string;
  url: string;
  source: string;
  topic?: string;
  note?: string;
}

// Placeholder page: add links to content/reads.json and they show up here.
function getReads(): Read[] {
  return JSON.parse(fs.readFileSync(path.join(process.cwd(), "content", "reads.json"), "utf8")) as Read[];
}

export default function ReadsPage() {
  const reads = getReads();

  return (
    <div>
      <header className="mb-10">
        <h1 className="font-heading font-extrabold text-5xl sm:text-6xl tracking-[-0.03em] text-ink mb-3">
          Good reads
        </h1>
        <p className="text-lg text-ink-2">
          Engineering posts and articles worth reading, picked by me. This page is a placeholder and will grow.
        </p>
      </header>

      <ul className="grid gap-3 max-w-[48rem]">
        {reads.map((r) => (
          <li key={r.url} className="rounded-xl border border-border bg-card p-4">
            <a
              href={r.url}
              target="_blank"
              rel="noopener noreferrer"
              className="font-bold text-ink hover:text-accent transition-colors"
            >
              {r.title} &nearr;
            </a>
            <p className="mt-1 text-sm text-ink-muted">
              {r.source}
              {r.topic && ` · ${r.topic}`}
            </p>
            {r.note && <p className="mt-1 text-sm text-ink-2">{r.note}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}
