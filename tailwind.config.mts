import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        heading: ["var(--font-dm-serif)", "Georgia", "serif"],
        body: ["var(--font-space-grotesk)", "system-ui", "sans-serif"],
        mono: ["var(--font-space-mono)", '"Courier New"', "monospace"],
      },
      colors: {
        cream: "#f5f0e8",
        ink: {
          DEFAULT: "#1a1a1a",
          muted: "#6b6560",
          light: "#b5afa6",
        },
        accent: {
          DEFAULT: "#c44d2b",
          hover: "#a33d20",
        },
        border: "#d9d3c7",
      },
      maxWidth: {
        content: "720px",
      },
    },
  },
};

export default config;
