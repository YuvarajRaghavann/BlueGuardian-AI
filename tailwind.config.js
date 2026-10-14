/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: '#0a0f1a',
        card: '#111827',
        accent: '#06b6d4',
        accentDark: '#0e7490',
        muted: '#6b7280',
      },
    },
  },
  plugins: [],
}