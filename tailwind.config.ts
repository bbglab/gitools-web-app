import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // App chrome — dark neutral
        surface: {
          DEFAULT: '#1a1a2e',
          raised: '#16213e',
          overlay: '#0f3460',
        },
        // Accent for interactive elements
        accent: {
          DEFAULT: '#4f8ef7',
          hover: '#3b7af0',
        },
        // Group A / Group B comparison colors
        groupA: '#3b82f6',
        groupB: '#ef4444',
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
} satisfies Config
