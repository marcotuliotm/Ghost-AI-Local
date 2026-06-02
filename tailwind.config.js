/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Semantic tokens backed by CSS variables (see globals.css). These adapt
        // to the macOS light/dark appearance automatically via prefers-color-scheme.
        ghost: {
          accent: 'rgb(var(--accent) / <alpha-value>)',
          'accent-hover': 'rgb(var(--accent) / 0.85)',
          text: 'rgb(var(--label) / <alpha-value>)',
          'text-muted': 'rgb(var(--label-secondary) / <alpha-value>)',
          border: 'rgb(var(--separator) / 0.12)',
          'border-hover': 'rgb(var(--separator) / 0.22)',
          // Control fills (replace the old hardcoded white/x utilities)
          fill: 'rgb(var(--surface) / 0.06)',
          'fill-strong': 'rgb(var(--surface) / 0.12)',
          surface: 'rgb(var(--surface) / 0.10)',
          // Apple system status colors
          success: '#34C759',
          warning: '#FF9F0A',
          error: '#FF453B',
        },
      },
      animation: {
        'fade-in': 'fadeIn 0.2s ease-out',
        'slide-up': 'slideUp 0.3s ease-out',
        'pulse-dot': 'pulseDot 1.5s ease-in-out infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        pulseDot: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.3' },
        },
      },
    },
  },
  plugins: [],
}
