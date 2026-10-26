"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import ThemeToggle from "@/components/ThemeToggle";

const NAV_ITEMS = [
  { label: "Blog", href: "/blog" },
  { label: "Projects", href: "/projects" },
  { label: "About", href: "/about" },
];

export default function Header() {
  const pathname = usePathname();

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
            {NAV_ITEMS.map((item) => {
              const isActive =
                pathname === item.href || pathname.startsWith(item.href + "/");
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`px-2 sm:px-3 py-1.5 rounded-lg text-sm sm:text-[0.95rem] font-semibold transition-colors ${
                    isActive
                      ? "bg-accent-tint text-ink"
                      : "text-ink-2 hover:bg-card-2 hover:text-ink"
                  }`}
                >
                  {item.label}
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
