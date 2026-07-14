/** @type {import('tailwindcss').Config} */
export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        panel: "#ffffff",
        panelMuted: "#f4f8fc",
        line: "#d6e0ec",
        fg: "#132335",
        fgMuted: "#567089",
        success: "#08734d",
        warning: "#835000",
        critical: "#a82b27"
      },
      fontFamily: {
        sans: ["Segoe UI", "IBM Plex Sans", "Roboto", "Helvetica Neue", "Arial", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"]
      }
    }
  },
  plugins: []
};
