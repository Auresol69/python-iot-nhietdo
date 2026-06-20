/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        darkBg: "#0d1117",
        darkPanel: "#161b22",
        darkBorder: "#30363d",
        neonCyan: "#00ffd5",
        neonRed: "#ff4d4d",
      }
    },
  },
  plugins: [],
}
