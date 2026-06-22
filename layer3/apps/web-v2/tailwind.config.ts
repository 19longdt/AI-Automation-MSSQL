import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["selector", "[data-theme='dark']"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        ui: ["Inter", "system-ui", "sans-serif"],
        code: ["JetBrains Mono", "Fira Code", "Consolas", "monospace"],
      },
      colors: {
        bg:             "var(--color-bg)",
        surface:        "var(--color-surface)",
        "surface-2":    "var(--color-surface-2)",
        "surface-3":    "var(--color-surface-3)",
        primary:        "var(--color-primary)",
        "primary-soft": "var(--color-primary-soft)",
        critical:       "var(--color-critical)",
        "critical-soft":"var(--color-critical-soft)",
        warning:        "var(--color-warning)",
        "warning-soft": "var(--color-warning-soft)",
        info:           "var(--color-info)",
        "info-soft":    "var(--color-info-soft)",
        success:        "var(--color-success)",
        "success-soft": "var(--color-success-soft)",
        border:         "var(--color-border)",
        "border-2":     "var(--color-border-2)",
        muted:          "var(--color-muted)",
        subtle:         "var(--color-subtle)",
        text:           "var(--color-text)",
        "text-2":       "var(--color-text-2)",
        "row-hover":    "var(--color-row-hover)",
        "role-primary":   "var(--color-role-primary)",
        "role-secondary": "var(--color-role-secondary)",
      },
      borderRadius: {
        sm: "var(--radius-sm)",
        md: "var(--radius-md)",
        lg: "var(--radius-lg)",
        xl: "var(--radius-xl)",
        full: "var(--radius-full)",
      },
      spacing: {
        "1": "var(--space-1)",
        "2": "var(--space-2)",
        "3": "var(--space-3)",
        "4": "var(--space-4)",
        "5": "var(--space-5)",
        "6": "var(--space-6)",
        "8": "var(--space-8)",
        "12": "var(--space-12)",
      },
    },
  },
  plugins: [],
};

export default config;
