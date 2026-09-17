/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#2563EB', // blue-600
          hover: '#1D4ED8', // blue-700
        },
        'bg-page': '#F8FAFC', // slate-50
        'bg-card': '#FFFFFF',
        border: '#E5E7EB', // gray-200
        'text-primary': '#111827', // gray-900
        'text-secondary': '#6B7280', // gray-500
        'text-label': '#9CA3AF', // gray-400
        success: '#10B981', // emerald-500
        blocked: '#9CA3AF', // gray-400
        danger: {
          DEFAULT: '#EF4444', // red-500
          hover: '#DC2626', // red-600
        },
      },
      fontFamily: {
        sans: [
          'Inter',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
      },
    },
  },
  plugins: [],
}
