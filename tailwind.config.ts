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
        cream: "#f8f6ef",
        "cream-deep": "#eeeade",
        paper: "#fffdf8",
        ink: "#20332f",
        muted: "#687772",
        sage: "#4f947e",
        "sage-dark": "#2f6f5e",
        mist: "#dfece5",
        clay: "#bd6f50",
        "clay-soft": "#f3dfd5",
        gold: "#d3a547",
        "sky-soft": "#dce8ed"
      },
      boxShadow: {
        soft: "0 22px 70px rgba(32, 51, 47, 0.09)",
        lift: "0 16px 38px rgba(32, 51, 47, 0.13)",
        button: "0 8px 22px rgba(47, 111, 94, 0.22)"
      }
    },
  },
  plugins: [],
};

export default config;
