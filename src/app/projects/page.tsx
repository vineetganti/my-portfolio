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
        <h1 className="font-heading font-extrabold text-5xl sm:text-6xl tracking-[-0.03em] text-ink mb-3">
          Projects
        </h1>
        <p className="text-lg text-ink-2">Things I&apos;ve built and worked on.</p>
      </header>

      {projects.length === 0 ? (
        <p className="text-ink-muted">No projects yet. Check back soon!</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
            <ProjectCard key={project.slug} project={project} />
          ))}
        </div>
      )}
    </div>
  );
}
