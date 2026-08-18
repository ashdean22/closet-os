/** @type {import('tailwindcss').Config} */

// Mirrors lib/theme.ts — keep the two in sync. That file carries the rationale
// for each colour; this one only exposes them as utility classes.
module.exports = {
  content: [
    "./App.{js,jsx,ts,tsx}",
    "./index.{js,jsx,ts,tsx}",
    "./screens/**/*.{js,jsx,ts,tsx}",
    "./components/**/*.{js,jsx,ts,tsx}",
  ],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        ground: "#F2E9DA",
        surface: "#FCF8F1",
        sunken: "#EAE0CE",
        edge: "#DCCDB4",

        ink: {
          DEFAULT: "#1B333B",
          soft: "#5A7078",
          faint: "#93A5AB",
        },

        rust: {
          DEFAULT: "#C0521F",
          deep: "#9C4118",
          muted: "#DFA88A",
          tint: "#F7E2D4",
        },

        teal: {
          DEFAULT: "#2A6F84",
          deep: "#1B4E5E",
          tint: "#DCEAEE",
        },

        sky: {
          DEFAULT: "#6FB4CC",
          tint: "#E3F0F5",
        },

        brass: {
          DEFAULT: "#C9A05E",
          tint: "#F5EBD8",
        },

        danger: {
          DEFAULT: "#B3402E",
          tint: "#F9E3DE",
          edge: "#E8BFB6",
        },

        success: {
          DEFAULT: "#6B7A45",
          tint: "#EDEFE0",
        },

        // Advisory callouts — brass-toned, distinct from `danger`.
        notice: {
          DEFAULT: "#8A6A2F",
          tint: "#F5EBD8",
          edge: "#DFC894",
        },

        // Category-pill hues; see `chips` in lib/theme.ts.
        chip: {
          teal: "#DCEAEE",
          "teal-ink": "#1B4E5E",
          rust: "#F7E2D4",
          "rust-ink": "#9C4118",
          brass: "#F5EBD8",
          "brass-ink": "#7A5A22",
          olive: "#EDEFE0",
          "olive-ink": "#4E5A31",
          sky: "#E3F0F5",
          "sky-ink": "#2A6F84",
          plum: "#EDE3E4",
          "plum-ink": "#6E4048",
        },
      },

      fontFamily: {
        // Names must match the keys registered with useFonts in App.tsx.
        display: ["FascinateInline"],
        deco: ["Limelight"],
      },
    },
  },
  plugins: [],
};
