import { getAllProjects } from "@/lib/projects";
import ProjectCard from "@/components/ProjectCard";

export const metadata = {
  title: "Projects",
  description: "Things I've built and worked on.",
};

export default function ProjectsPage() {
  const projects = getAllProjects();

  return (
    <div>
      <header className="mb-10">
        <h1 className="font-heading text-4xl text-ink mb-2">Projects</h1>
        <p className="font-body text-ink-muted">
          Things I&apos;ve built and worked on.
        </p>
      </header>

      {projects.length === 0 ? (
        <p className="font-mono text-sm text-ink-muted">
          No projects yet. Check back soon!
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {projects.map((project) => (
            <ProjectCard key={project.slug} project={project} />
          ))}
        </div>
      )}
    </div>
  );
}
