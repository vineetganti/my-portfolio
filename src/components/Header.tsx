"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import ThemeToggle from "@/components/ThemeToggle";

interface NavItem {
  label: string;
  /** Shown instead of `label` below the `sm` breakpoint, where the nav is tight. */
  shortLabel?: string;
  href: string;
  beta?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { label: "Blog", href: "/blog" },
  { label: "Nuggets", href: "/notes" },
  { label: "Projects", href: "/projects" },
  { label: "About", href: "/about" },
];

const SECOND_BRAIN_ITEM: NavItem = { label: "Second brain", shortLabel: "Brain", href: "/second-brain", beta: true };

/** `secondBrain` is decided on the server (SECOND_BRAIN_ENABLED), because this component runs in the browser. */
export default function Header({ secondBrain = true }: { secondBrain?: boolean }) {
  const pathname = usePathname();
  const items = secondBrain ? [NAV_ITEMS[0], SECOND_BRAIN_ITEM, ...NAV_ITEMS.slice(1)] : NAV_ITEMS;

  return (
    <header className="sticky top-0 z-50 h-header bg-cream/85 backdrop-blur-md border-b border-border">
      <div className="h-full max-w-wide mx-auto px-4 sm:px-6 lg:px-10 flex items-center justify-between gap-4">
        <Link
          href="/"
          className="font-heading font-extrabold text-lg sm:text-xl tracking-tight whitespace-nowrap text-ink hover:text-accent transition-colors"
        >
          Vineet Ganti
        </Link>

        <div className="flex items-center gap-2 sm:gap-4">
          <nav className="flex items-center gap-1">
            {items.map((item) => {
              const isActive =
                pathname === item.href || pathname.startsWith(item.href + "/");
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`px-2 sm:px-3 py-1.5 rounded-lg text-sm sm:text-[0.95rem] font-semibold transition-colors ${
                    isActive
                      ? "bg-accent-tint text-ink-strong"
                      : "text-ink-2 hover:bg-card-2 hover:text-ink"
                  }`}
                >
                  {item.shortLabel ? (
                    <>
                      <span className="sm:hidden">{item.shortLabel}</span>
                      <span className="hidden sm:inline">{item.label}</span>
                    </>
                  ) : (
                    item.label
                  )}
                  {item.beta && (
                    <span className="hidden sm:inline ml-1.5 rounded-full bg-accent-tint px-1.5 py-0.5 align-middle text-[0.65rem] font-extrabold uppercase tracking-wide text-ink-strong">
                      Beta
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
