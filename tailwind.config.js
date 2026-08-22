import tailwindcssAnimate from "tailwindcss-animate";

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    container: { center: true, padding: "1.5rem", screens: { "2xl": "1280px" } },
    extend: {
      // The header CTA needs its full label back before the nav collapses.
      screens: { xs: "420px" },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        muted: { DEFAULT: "hsl(var(--muted))", foreground: "hsl(var(--muted-foreground))" },
        card: { DEFAULT: "hsl(var(--card))", foreground: "hsl(var(--card-foreground))" },
        primary: { DEFAULT: "hsl(var(--primary))", foreground: "hsl(var(--primary-foreground))" },
        accent: { DEFAULT: "hsl(var(--accent))", foreground: "hsl(var(--accent-foreground))" },
        // The dark band behind the header and hero, and the two colours that
        // only ever appear on top of it.
        forest: {
          DEFAULT: "hsl(var(--forest))",
          foreground: "hsl(var(--forest-foreground))",
          muted: "hsl(var(--forest-muted))",
          accent: "hsl(var(--forest-accent))",
        },
        destructive: "hsl(var(--destructive))",
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 4px)",
        sm: "calc(var(--radius) - 6px)",
        "2xl": "calc(var(--radius) + 4px)",
      },
      fontFamily: {
        sans: ["Figtree", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
        // The one place the display serif is named. Swap it here, nowhere else.
        // It ships a single weight — see the .display note in index.css.
        display: ["Instrument Serif", "ui-serif", "Georgia", "Times New Roman", "serif"],
      },
      boxShadow: {
        card: "0 1px 2px rgb(20 35 29 / 0.04)",
        raised: "0 10px 26px rgb(20 35 29 / 0.12)",
      },
      keyframes: {
        "fade-up": { from: { opacity: "0", transform: "translateY(8px)" }, to: { opacity: "1", transform: "none" } },
      },
      animation: { "fade-up": "fade-up .35s ease-out both" },
    },
  },
  plugins: [tailwindcssAnimate],
};
