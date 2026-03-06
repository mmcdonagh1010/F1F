/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,jsx}", "./components/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        track: {
          900: "#06161B",
          800: "#0C242B",
          700: "#12333B"
        },
        accent: {
          red: "#FF3B30",
          cyan: "#00C2D1",
          gold: "#FDBA2D"
        }
      },
      fontFamily: {
        display: ["Bebas Neue", "sans-serif"],
        body: ["Manrope", "sans-serif"]
      },
      boxShadow: {
        card: "0 14px 30px rgba(0, 0, 0, 0.22)"
      }
    }
  },
  plugins: []
};
