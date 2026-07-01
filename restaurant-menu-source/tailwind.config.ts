import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        cream: "#fbf7f0",
        ink: "#221b14",
        accent: "#b5442e",
        gold: "#c8963e",
      },
      fontFamily: {
        serif: ["Georgia", "'Times New Roman'", "serif"],
      },
    },
  },
  plugins: [],
};

export default config;
