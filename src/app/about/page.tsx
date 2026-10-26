import { Mail, Code2, ExternalLink } from "lucide-react";

export const metadata = {
  title: "About",
  description: "Learn more about me.",
};

const CONTACTS = [
  { label: "vineetganti@gmail.com", href: "mailto:vineetganti@gmail.com", icon: Mail },
  { label: "GitHub", href: "https://github.com/vineetganti", icon: Code2 },
  { label: "LinkedIn", href: "https://linkedin.com/in/vineetganti", icon: ExternalLink },
];

export default function AboutPage() {
  return (
    <div className="max-w-content">
      <header className="mb-10">
        <h1 className="font-heading font-extrabold text-5xl sm:text-6xl tracking-[-0.03em] text-ink">
          About
        </h1>
      </header>

      <div className="space-y-5 text-lg text-ink-2 leading-relaxed">
        <p>
          Hi, I&apos;m <span className="text-ink font-bold">Vineet Ganti</span>.
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

      <div className="mt-12 rounded-2xl border border-border bg-card p-6">
        <h2 className="font-heading font-extrabold text-2xl tracking-tight text-ink mb-4">
          Get in Touch
        </h2>
        <div className="flex flex-col gap-3">
          {CONTACTS.map((c) => {
            const Icon = c.icon;
            const external = c.href.startsWith("http");
            return (
              <a
                key={c.href}
                href={c.href}
                {...(external && { target: "_blank", rel: "noopener noreferrer" })}
                className="inline-flex items-center gap-2.5 font-semibold text-ink-2 hover:text-accent transition-colors"
              >
                <Icon size={17} />
                {c.label}
              </a>
            );
          })}
        </div>
      </div>
    </div>
  );
}
