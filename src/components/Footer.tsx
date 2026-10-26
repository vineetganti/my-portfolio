import { Code2, ExternalLink, Mail } from "lucide-react";

const SOCIAL_LINKS = [
  {
    label: "GitHub",
    href: "https://github.com/vineetganti",
    icon: Code2,
  },
  {
    label: "LinkedIn",
    href: "https://linkedin.com/in/vineetganti",
    icon: ExternalLink,
  },
  {
    label: "Email",
    href: "mailto:vineetganti@gmail.com",
    icon: Mail,
  },
];

export default async function Footer() {
  "use cache";

  return (
    <footer className="border-t border-border mt-16 bg-card">
      <div className="max-w-wide mx-auto px-4 sm:px-6 lg:px-10 py-8 flex flex-col sm:flex-row items-center justify-between gap-4">
        <p className="text-sm text-ink-muted">
          &copy; {new Date().getFullYear()} Vineet Ganti
        </p>

        <div className="flex items-center gap-2">
          {SOCIAL_LINKS.map((link) => {
            const Icon = link.icon;
            return (
              <a
                key={link.label}
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center h-9 w-9 rounded-lg border border-border text-ink-muted hover:text-accent hover:border-accent transition-colors"
                aria-label={link.label}
              >
                <Icon size={17} />
              </a>
            );
          })}
        </div>
      </div>
    </footer>
  );
}
