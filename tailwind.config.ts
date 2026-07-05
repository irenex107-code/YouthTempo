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
        cream: "#f7f8f3",
        "cream-deep": "#eef3ec",
        ink: "#273633",
        muted: "#65736f",
        sage: "#5ea38d",
        "sage-dark": "#467f70",
        mist: "#e4eee8"
      },
      boxShadow: {
        soft: "0 20px 60px rgba(39, 54, 51, 0.08)"
      }
    },
  },
  plugins: [],
};

export default config;
