import { Mail, Code2, ExternalLink } from "lucide-react";

export const metadata = {
  title: "About",
  description: "Learn more about me.",
};

export default function AboutPage() {
  return (
    <div>
      <header className="mb-10">
        <h1 className="font-heading text-4xl text-ink mb-2">About</h1>
      </header>

      <div className="space-y-6 font-body text-ink-muted leading-relaxed max-w-lg">
        <p>
          Hi, I&apos;m <span className="text-ink font-medium">Vineet Ganti</span>.
          Welcome to my little space on the internet.
        </p>
        <p>
          I&apos;m curious about technology, love learning new things, and enjoy
          writing about what I discover along the way. This site is where I share
          my projects and thoughts.
        </p>
        <p>
          When I&apos;m not at the keyboard, you&apos;ll find me reading, exploring,
          or working on side projects that catch my interest.
        </p>
      </div>

      <div className="mt-12 pt-8 border-t border-border">
        <h2 className="font-heading text-2xl text-ink mb-4">Get in Touch</h2>
        <div className="flex flex-col gap-3">
          <a
            href="mailto:vineetganti@gmail.com"
            className="inline-flex items-center gap-2 font-mono text-sm text-ink-muted hover:text-accent transition-colors"
          >
            <Mail size={16} />
            vineetganti@gmail.com
          </a>
          <a
            href="https://github.com/vineetganti"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 font-mono text-sm text-ink-muted hover:text-accent transition-colors"
          >
            <Code2 size={16} />
            GitHub
          </a>
          <a
            href="https://linkedin.com/in/vineetganti"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 font-mono text-sm text-ink-muted hover:text-accent transition-colors"
          >
            <ExternalLink size={16} />
            LinkedIn
          </a>
        </div>
      </div>
    </div>
  );
}
