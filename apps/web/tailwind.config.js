/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: { ink: "#10231d", forest: { 50: "#edf9f4", 100: "#d5f2e5", 500: "#16835c", 600: "#0f6b4a", 700: "#0b523a", 900: "#0a3025" }, saffron: "#f59e0b" },
      fontFamily: { sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"], display: ["Manrope", "Inter", "sans-serif"] },
      boxShadow: { card: "0 16px 45px rgba(12, 48, 37, .08)", glow: "0 24px 80px rgba(22, 131, 92, .2)" },
    },
  },
  plugins: [],
};
