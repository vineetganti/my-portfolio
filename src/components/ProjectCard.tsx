import { Code2, ExternalLink } from "lucide-react";
import type { Project } from "@/lib/projects";

export default function ProjectCard({ project }: { project: Project }) {
  return (
    <div className="flex flex-col rounded-2xl border border-border bg-card p-6 transition-colors hover:border-accent">
      <h3 className="font-heading font-extrabold text-xl tracking-tight text-ink mb-2">
        {project.title}
      </h3>
      <p className="text-[0.97rem] text-ink-2 leading-relaxed mb-4">
        {project.description}
      </p>

      <div className="flex flex-wrap gap-2 mb-5">
        {project.tags.map((tag) => (
          <span
            key={tag}
            className="rounded-full border border-border bg-card-2 px-3 py-0.5 text-[0.8rem] text-ink-muted"
          >
            {tag}
          </span>
        ))}
      </div>

      <div className="mt-auto flex items-center gap-2">
        {project.github && (
          <a
            href={project.github}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-semibold text-ink-2 hover:border-ink-2 hover:text-ink transition-colors"
          >
            <Code2 size={14} />
            Source
          </a>
        )}
        {project.url && (
          <a
            href={project.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-semibold text-ink-2 hover:border-ink-2 hover:text-ink transition-colors"
          >
            <ExternalLink size={14} />
            Live
          </a>
        )}
      </div>
    </div>
  );
}
