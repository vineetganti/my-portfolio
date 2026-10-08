import { Code2, ExternalLink } from "lucide-react";
import type { Project } from "@/lib/projects";

export default function ProjectCard({ project }: { project: Project }) {
  return (
    <div className="p-5 border border-border rounded-lg hover:border-accent/40 transition-colors">
      <h3 className="font-heading text-xl text-ink mb-2">{project.title}</h3>
      <p className="font-body text-sm text-ink-muted leading-relaxed mb-4">
        {project.description}
      </p>

      <div className="flex flex-wrap gap-2 mb-4">
        {project.tags.map((tag) => (
          <span
            key={tag}
            className="font-mono text-xs px-2 py-0.5 bg-cream border border-border rounded text-ink-muted"
          >
            {tag}
          </span>
        ))}
      </div>

      <div className="flex items-center gap-4">
        {project.github && (
          <a
            href={project.github}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 font-mono text-xs text-ink-muted hover:text-accent transition-colors"
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
            className="inline-flex items-center gap-1.5 font-mono text-xs text-ink-muted hover:text-accent transition-colors"
          >
            <ExternalLink size={14} />
            Live
          </a>
        )}
      </div>
    </div>
  );
}
