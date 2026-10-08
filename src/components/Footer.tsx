import { Code2, ExternalLink, Mail } from "lucide-react";

const SOCIAL_LINKS = [
  {
    label: "GitHub",
    href: "https://github.com/yourusername",
    icon: Code2,
  },
  {
    label: "LinkedIn",
    href: "https://linkedin.com/in/yourusername",
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
    <footer className="border-t border-border mt-16">
      <div className="max-w-content mx-auto px-4 py-8 flex flex-col sm:flex-row items-center justify-between gap-4">
        <p className="font-mono text-xs text-ink-muted">
          &copy; {new Date().getFullYear()} Vineet Ganti
        </p>

        <div className="flex items-center gap-5">
          {SOCIAL_LINKS.map((link) => {
            const Icon = link.icon;
            return (
              <a
                key={link.label}
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-ink-muted hover:text-accent transition-colors"
                aria-label={link.label}
              >
                <Icon size={18} />
              </a>
            );
          })}
        </div>
      </div>
    </footer>
  );
}
