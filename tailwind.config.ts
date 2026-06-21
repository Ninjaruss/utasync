import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        cinnabar: {
          950: '#0d0404',
          900: '#180606',
          800: '#2c0808',
          700: '#3d0f0f',
          accent: '#f87171',
          glow: 'rgba(248,113,113,0.5)',
        },
      },
      fontFamily: {
        sans: ['system-ui', 'sans-serif'],
        jp: ['"Hiragino Sans"', '"Yu Gothic"', '"Noto Sans JP"', '"Noto Sans CJK JP"', 'system-ui', 'sans-serif'],
      },
      keyframes: {
        'progress-enter': {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
} satisfies Config
