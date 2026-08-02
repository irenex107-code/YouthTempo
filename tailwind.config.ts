import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./views/**/*.{js,ts,jsx,tsx,mdx}",
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./data/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        cream: "#fbf7ed",
        "cream-deep": "#f1eadb",
        paper: "#fffdf8",
        ink: "#1f3934",
        muted: "#667a73",
        sage: "#5b927d",
        "sage-dark": "#285f53",
        mist: "#dceae5",
        mint: "#e8f2ed",
        clay: "#d97862",
        "clay-soft": "#f5d8cf",
        gold: "#e9b648",
        "sky-soft": "#d9e8ef",
        lavender: "#ddd5eb"
      },
      boxShadow: {
        soft: "0 18px 54px rgba(31, 57, 52, 0.08)",
        lift: "0 18px 42px rgba(31, 57, 52, 0.12)",
        button: "0 9px 22px rgba(40, 95, 83, 0.22)"
      }
    },
  },
  plugins: [],
};

export default config;
