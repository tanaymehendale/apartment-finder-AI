import type { Config } from "tailwindcss";

// Design tokens for P4-3 (production polish pass). Palette built in OKLCH:
// a warm terracotta/clay primary (hue 32 — chosen for "home/warmth", not the
// reflex orange-60 or blue-250 defaults) with neutrals tinted toward the same
// hue at a barely-perceptible chroma, plus one restrained secondary (a muted
// sage) used only where 5 distinguishable rank colors are needed. See
// .impeccable.md for the full design brief this implements.
const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./hooks/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: "oklch(50% 0.165 32)",
          50: "oklch(97% 0.018 32)",
          100: "oklch(94% 0.035 32)",
          200: "oklch(87% 0.06 32)",
          300: "oklch(79% 0.09 32)",
          400: "oklch(70% 0.13 32)",
          500: "oklch(60% 0.16 32)",
          600: "oklch(50% 0.165 32)",
          700: "oklch(42% 0.145 32)",
          800: "oklch(34% 0.115 32)",
          900: "oklch(27% 0.085 32)",
        },
        // Secondary accent — muted sage, used sparingly (3rd-rank color, a
        // few icon highlights). Not a second "brand color"; primary carries
        // all CTAs and focus states.
        accent: {
          DEFAULT: "oklch(52% 0.08 165)",
          100: "oklch(93% 0.03 165)",
          400: "oklch(68% 0.09 165)",
          600: "oklch(52% 0.08 165)",
          700: "oklch(43% 0.07 165)",
        },
        neutral: {
          25: "oklch(98.5% 0.005 35)",
          50: "oklch(97.5% 0.006 35)",
          100: "oklch(95.5% 0.008 35)",
          200: "oklch(91% 0.009 35)",
          300: "oklch(84% 0.01 35)",
          400: "oklch(70% 0.012 35)",
          500: "oklch(55% 0.014 35)",
          600: "oklch(46% 0.014 35)",
          700: "oklch(38% 0.013 35)",
          800: "oklch(27% 0.012 35)",
          900: "oklch(18% 0.01 35)",
        },
        success: {
          50: "oklch(95% 0.04 150)",
          100: "oklch(91% 0.06 150)",
          600: "oklch(52% 0.13 150)",
          700: "oklch(44% 0.12 150)",
        },
        warning: {
          50: "oklch(95% 0.045 78)",
          100: "oklch(91% 0.07 78)",
          600: "oklch(56% 0.14 60)",
          700: "oklch(47% 0.13 55)",
        },
        danger: {
          50: "oklch(95% 0.03 20)",
          100: "oklch(90% 0.06 20)",
          // 400 exists for text/icons on DARK surfaces (e.g. the sidebar) —
          // 50/100 are light-surface tints, 600/700 are light-surface text/buttons.
          400: "oklch(72% 0.14 20)",
          600: "oklch(52% 0.17 20)",
          700: "oklch(44% 0.16 20)",
        },
        surface: "oklch(99% 0.004 35)",
        background: "oklch(97.5% 0.006 35)",
        // Warm near-black, hue-tinted like everything else — used for the
        // sidebar chrome so it reads as this product's own surface, not a
        // generic dark-gray AI-chat rail.
        ink: {
          900: "oklch(17% 0.024 32)",
          800: "oklch(22% 0.024 32)",
          700: "oklch(28% 0.022 32)",
        },
        // Legacy aliases kept temporarily so a stray untouched class doesn't
        // break the build; new work should use neutral-*/primary-* directly.
        muted: "oklch(55% 0.014 35)",
      },
      fontFamily: {
        display: ["var(--font-display)", "ui-sans-serif", "system-ui", "sans-serif"],
        sans: ["var(--font-body)", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      fontSize: {
        xs: ["0.75rem", { lineHeight: "1.5" }],
        sm: ["0.8125rem", { lineHeight: "1.55" }],
        base: ["0.9375rem", { lineHeight: "1.6" }],
        lg: ["1.125rem", { lineHeight: "1.5" }],
        xl: ["1.375rem", { lineHeight: "1.35" }],
        "2xl": ["1.75rem", { lineHeight: "1.25" }],
        "3xl": ["2.25rem", { lineHeight: "1.15" }],
      },
      spacing: {
        "4.5": "1.125rem",
        "18": "4.5rem",
      },
      borderRadius: {
        lg: "0.875rem",
        xl: "1.125rem",
        "2xl": "1.375rem",
        "3xl": "1.75rem",
      },
      boxShadow: {
        xs: "0 1px 2px oklch(25% 0.02 35 / 0.05)",
        sm: "0 1px 3px oklch(25% 0.02 35 / 0.07), 0 1px 2px oklch(25% 0.02 35 / 0.04)",
        DEFAULT: "0 1px 3px oklch(25% 0.02 35 / 0.07), 0 1px 2px oklch(25% 0.02 35 / 0.04)",
        md: "0 6px 16px oklch(25% 0.02 35 / 0.08), 0 2px 5px oklch(25% 0.02 35 / 0.04)",
        lg: "0 16px 36px oklch(25% 0.02 35 / 0.13), 0 4px 10px oklch(25% 0.02 35 / 0.05)",
      },
      animation: {
        "fade-in": "fadeIn 0.4s cubic-bezier(0.22, 1, 0.36, 1)",
        "slide-up": "slideUp 0.4s cubic-bezier(0.22, 1, 0.36, 1)",
        "reveal": "reveal 0.5s cubic-bezier(0.22, 1, 0.36, 1) both",
        "pulse-dot": "pulseDot 1.4s ease-in-out infinite",
        "shimmer": "shimmer 1.8s ease-in-out infinite",
        "spin-slow": "spin 0.9s linear infinite",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        slideUp: {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        reveal: {
          "0%": { opacity: "0", transform: "translateY(14px) scale(0.98)" },
          "100%": { opacity: "1", transform: "translateY(0) scale(1)" },
        },
        pulseDot: {
          "0%, 80%, 100%": { transform: "scale(0.6)", opacity: "0.4" },
          "40%": { transform: "scale(1)", opacity: "1" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
