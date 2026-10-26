import type { Config } from "tailwindcss";

// Colours point at CSS variables defined in globals.css so light/dark
// themes swap without touching any component classes.
const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        heading: ["var(--font-heading)", "system-ui", "sans-serif"],
        body: ["var(--font-body)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "Menlo", "monospace"],
      },
      colors: {
        cream: "var(--paper)",
        card: {
          DEFAULT: "var(--card)",
          2: "var(--card-2)",
        },
        ink: {
          DEFAULT: "var(--ink)",
          2: "var(--ink-2)",
          muted: "var(--muted)",
          light: "var(--muted-2)",
        },
        accent: {
          DEFAULT: "var(--accent)",
          hover: "var(--accent-ink)",
          tint: "var(--accent-t)",
        },
        tool: "var(--tool)",
        border: {
          DEFAULT: "var(--rule)",
          2: "var(--rule-2)",
        },
      },
      maxWidth: {
        // Comfortable line length for reading
        content: "46rem",
        // Page frame for header, footer and two-column layouts
        wide: "76rem",
      },
      spacing: {
        header: "var(--header-h)",
      },
    },
  },
};

export default config;
