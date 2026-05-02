import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        body: ["var(--font-body)", "sans-serif"],
        display: ["var(--font-display)", "sans-serif"],
      },
      colors: {
        ink: "#08111f",
        mist: "#d6e5ff",
        accent: "#44c7f4",
        accentSoft: "#133954",
        signal: "#8ee89d",
        warning: "#f6c563",
        rose: "#ff8a9f",
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(139, 194, 255, 0.16), 0 30px 80px rgba(6, 14, 32, 0.45)",
      },
    },
  },
  plugins: [],
};

export default config;
