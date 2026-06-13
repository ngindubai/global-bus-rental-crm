/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Brand — "road & motion" deep teal/navy with an amber highway accent
        brand: {
          50: "#eef6f7",
          100: "#d6e9eb",
          200: "#abd2d7",
          300: "#74b3bb",
          400: "#3d8e99",
          500: "#1d7280", // primary-light
          600: "#0f5b68", // primary
          700: "#0c4854", // primary-dark
          800: "#0a3a44",
          900: "#082d35",
        },
        // Amber accent — highway / signage
        gold: {
          300: "#fcd667",
          400: "#fbc531",
          500: "#f5a623", // accent
          600: "#d4860f",
        },
        canvas: "#F7FAFB", // page background
        surface: "#EAF1F3", // raised surface
        ink: "#0A2A30", // primary text
        ink2: "#274249", // secondary text
        muted: "#5E7176", // muted text
      },
      fontFamily: {
        sans: ["Manrope", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
      },
      boxShadow: {
        card: "0 1px 3px rgba(10,42,48,.08), 0 1px 2px rgba(10,42,48,.06)",
        cardmd: "0 4px 6px rgba(10,42,48,.07), 0 2px 4px rgba(10,42,48,.06)",
        cardlg: "0 10px 15px rgba(10,42,48,.10), 0 4px 6px rgba(10,42,48,.05)",
      },
    },
  },
  plugins: [],
};
