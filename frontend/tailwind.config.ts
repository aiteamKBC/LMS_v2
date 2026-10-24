import defaultColors from 'tailwindcss/colors';

// Learner pages use the journal palette, including legacy utility colours.
// Fallbacks preserve Tailwind's exact colours in every other workspace.
const learnerColorRoles = {
  slate: 'neutral', gray: 'neutral', zinc: 'neutral', neutral: 'neutral', stone: 'neutral',
  blue: 'navy', indigo: 'navy', sky: 'navy', cyan: 'navy',
  purple: 'purple', violet: 'purple', fuchsia: 'purple', pink: 'purple',
  green: 'success', emerald: 'success', teal: 'success', lime: 'success',
  red: 'danger', rose: 'danger', orange: 'warning', amber: 'warning', yellow: 'warning',
} as const;

const learnerUtilityColors = Object.fromEntries(
  Object.entries(learnerColorRoles).map(([family, role]) => [family, Object.fromEntries(
    Object.entries(defaultColors[family as keyof typeof learnerColorRoles]).map(([shade, hex]) => {
      const rgb = hex.slice(1).match(/.{2}/g)!.map(value => parseInt(value, 16)).join(' ');
      return [shade, `rgb(var(--learner-${role}-${shade}, ${rgb}) / <alpha-value>)`];
    }),
  )]),
);

/** @type {import('tailwindcss').Config} */
export default {
    content: [
      "./index.html",
      "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
      extend: {
        colors: {
          ...learnerUtilityColors,
          background: {
            DEFAULT: 'oklch(var(--llp-background, var(--background-50)) / <alpha-value>)',
            50: 'oklch(var(--background-50) / <alpha-value>)',
            100: 'oklch(var(--background-100) / <alpha-value>)',
            200: 'oklch(var(--background-200) / <alpha-value>)',
            300: 'oklch(var(--background-300) / <alpha-value>)',
            400: 'oklch(var(--background-400) / <alpha-value>)',
            500: 'oklch(var(--background-500) / <alpha-value>)',
            600: 'oklch(var(--background-600) / <alpha-value>)',
            700: 'oklch(var(--background-700) / <alpha-value>)',
            800: 'oklch(var(--background-800) / <alpha-value>)',
            900: 'oklch(var(--background-900) / <alpha-value>)',
            950: 'oklch(var(--background-950) / <alpha-value>)',
          },
          primary: {
            DEFAULT: 'oklch(var(--llp-primary, var(--primary-500)) / <alpha-value>)',
            foreground: 'oklch(var(--llp-primary-foreground, var(--background-50)) / <alpha-value>)',
            50: 'oklch(var(--primary-50) / <alpha-value>)',
            100: 'oklch(var(--primary-100) / <alpha-value>)',
            200: 'oklch(var(--primary-200) / <alpha-value>)',
            300: 'oklch(var(--primary-300) / <alpha-value>)',
            400: 'oklch(var(--primary-400) / <alpha-value>)',
            500: 'oklch(var(--primary-500) / <alpha-value>)',
            600: 'oklch(var(--primary-600) / <alpha-value>)',
            700: 'oklch(var(--primary-700) / <alpha-value>)',
            800: 'oklch(var(--primary-800) / <alpha-value>)',
            900: 'oklch(var(--primary-900) / <alpha-value>)',
            950: 'oklch(var(--primary-950) / <alpha-value>)',
          },
          accent: {
            DEFAULT: 'oklch(var(--llp-accent, var(--accent-500)) / <alpha-value>)',
            foreground: 'oklch(var(--llp-accent-foreground, var(--foreground-900)) / <alpha-value>)',
            50: 'oklch(var(--accent-50) / <alpha-value>)',
            100: 'oklch(var(--accent-100) / <alpha-value>)',
            200: 'oklch(var(--accent-200) / <alpha-value>)',
            300: 'oklch(var(--accent-300) / <alpha-value>)',
            400: 'oklch(var(--accent-400) / <alpha-value>)',
            500: 'oklch(var(--accent-500) / <alpha-value>)',
            600: 'oklch(var(--accent-600) / <alpha-value>)',
            700: 'oklch(var(--accent-700) / <alpha-value>)',
            800: 'oklch(var(--accent-800) / <alpha-value>)',
            900: 'oklch(var(--accent-900) / <alpha-value>)',
            950: 'oklch(var(--accent-950) / <alpha-value>)',
          },
          secondary: {
            DEFAULT: 'oklch(var(--llp-secondary, var(--secondary-100)) / <alpha-value>)',
            foreground: 'oklch(var(--llp-secondary-foreground, var(--foreground-900)) / <alpha-value>)',
            50: 'oklch(var(--secondary-50) / <alpha-value>)',
            100: 'oklch(var(--secondary-100) / <alpha-value>)',
            200: 'oklch(var(--secondary-200) / <alpha-value>)',
            300: 'oklch(var(--secondary-300) / <alpha-value>)',
            400: 'oklch(var(--secondary-400) / <alpha-value>)',
            500: 'oklch(var(--secondary-500) / <alpha-value>)',
            600: 'oklch(var(--secondary-600) / <alpha-value>)',
            700: 'oklch(var(--secondary-700) / <alpha-value>)',
            800: 'oklch(var(--secondary-800) / <alpha-value>)',
            900: 'oklch(var(--secondary-900) / <alpha-value>)',
            950: 'oklch(var(--secondary-950) / <alpha-value>)',
          },
          foreground: {
            DEFAULT: 'oklch(var(--llp-foreground, var(--foreground-900)) / <alpha-value>)',
            50: 'oklch(var(--foreground-50) / <alpha-value>)',
            100: 'oklch(var(--foreground-100) / <alpha-value>)',
            200: 'oklch(var(--foreground-200) / <alpha-value>)',
            300: 'oklch(var(--foreground-300) / <alpha-value>)',
            400: 'oklch(var(--foreground-400) / <alpha-value>)',
            500: 'oklch(var(--foreground-500) / <alpha-value>)',
            600: 'oklch(var(--foreground-600) / <alpha-value>)',
            700: 'oklch(var(--foreground-700) / <alpha-value>)',
            800: 'oklch(var(--foreground-800) / <alpha-value>)',
            900: 'oklch(var(--foreground-900) / <alpha-value>)',
            950: 'oklch(var(--foreground-950) / <alpha-value>)',
          },
          brand: {
            deep: 'var(--kbc-primary-deep)',
            DEFAULT: 'var(--kbc-primary)',
            secondary: 'var(--kbc-primary-secondary)',
            accent: 'var(--kbc-primary-accent)',
            light: 'var(--kbc-purple-soft)',
            wash: 'var(--kbc-purple-wash)',
            gold: 'var(--kbc-brand-gold)',
          },
          // Public pre-sign-in screens (reset password, LMS introduction):
          // fixed light designs in every theme, so literal colours, not theme vars.
          auth: {
            link: '#5b24e8',
            'link-hover': '#4b176d',
            focus: '#9861d0',
            step: '#5f5870',
            // Literal white: the .bg-white utility is repainted by the dark theme.
            surface: '#ffffff',
            ink: '#3a2059',
            hint: '#766382',
            'success-border': '#bbefd2',
            'success-bg': '#f1fcf6',
            'success-text': '#18794e',
            'error-border': '#f1c4c4',
            'error-bg': '#fdf2f2',
            'error-text': '#8a1f1f',
            'input-border': '#d8cbe8',
            'input-text': '#241638',
            action: '#6025a6',
            'action-hover': '#471882',
            'secondary-border': '#d8c7eb',
            'secondary-text': '#4b2a78',
          },
          // Inclusion & Safeguarding hand-off screen.
          inclusion: {
            bg: '#f8f5f1',
            ink: '#362044',
            muted: '#807586',
            'gold-border': '#ddc58d',
            'gold-bg': '#f0e7d8',
            gold: '#95722e',
            dot: '#b69957',
          },
          surface: 'oklch(var(--llp-surface) / <alpha-value>)',
          card: 'oklch(var(--llp-card) / <alpha-value>)',
          popover: {
            DEFAULT: 'oklch(var(--llp-popover) / <alpha-value>)',
            foreground: 'oklch(var(--llp-popover-foreground) / <alpha-value>)',
          },
          muted: {
            DEFAULT: 'oklch(var(--llp-muted) / <alpha-value>)',
            foreground: 'oklch(var(--llp-muted-foreground) / <alpha-value>)',
          },
          border: 'oklch(var(--llp-border) / <alpha-value>)',
          input: 'oklch(var(--llp-input) / <alpha-value>)',
          ring: 'oklch(var(--llp-ring) / <alpha-value>)',
          success: 'oklch(var(--llp-success) / <alpha-value>)',
          warning: 'oklch(var(--llp-warning) / <alpha-value>)',
          destructive: {
            DEFAULT: 'oklch(var(--llp-destructive) / <alpha-value>)',
            foreground: 'oklch(var(--llp-destructive-foreground) / <alpha-value>)',
          },
        },
        fontFamily: {
          serif: ['"Libre Baskerville"', 'ui-serif', 'Georgia', 'serif'],
          mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
          sans: ['"DM Sans"', 'system-ui', 'sans-serif'],
          heading: ['"DM Sans"', 'system-ui', 'sans-serif'],
          body: ['"DM Sans"', 'system-ui', 'sans-serif'],
          label: ['"DM Sans"', 'system-ui', 'sans-serif'],
          georgia: ['Georgia', 'serif'],
          arial: ['Arial', 'sans-serif'],
        },
        boxShadow: {
          panel: '0 1px 2px oklch(0.25 0.04 230 / 0.06), 0 12px 32px -18px oklch(0.25 0.04 230 / 0.22)',
        },
        fontSize: {
          'xs': ['0.8125rem', { lineHeight: '1.5' }],
          'sm': ['0.9375rem', { lineHeight: '1.55' }],
          'base': ['1.0625rem', { lineHeight: '1.6' }],
          'lg': ['1.1875rem', { lineHeight: '1.5' }],
          'xl': ['1.375rem', { lineHeight: '1.35' }],
          '2xl': ['1.625rem', { lineHeight: '1.3' }],
          '3xl': ['2rem', { lineHeight: '1.25' }],
          '4xl': ['2.5rem', { lineHeight: '1.2' }],
        },
        keyframes: {
          'celebrate-glow': {
            '0%, 100%': { boxShadow: '0 0 4px 0 rgba(16, 185, 129, 0.2)' },
            '50%': { boxShadow: '0 0 20px 4px rgba(16, 185, 129, 0.45)' },
          },
          'bar-grow': {
            '0%': { height: '0%' },
            '100%': { height: 'var(--bar-height, 12%)' },
          },
          // A background refresh is running: the list on screen is still the
          // real one, so it stays put and this bar carries the "there is more
          // coming" signal instead of a spinner that blanks the page.
          'entity-refresh': {
            '0%': { transform: 'translateX(-100%)' },
            '100%': { transform: 'translateX(400%)' },
          },
          // The row a save just wrote, so the eye finds it in a long list.
          // Progress rings draw in from their start (see AnimatedProgressCircle).
          'progress-ring-offset': {
            from: { strokeDashoffset: 'var(--ring-start-offset)' },
          },
          'progress-ring-dash': {
            from: { strokeDasharray: '0 9999' },
          },
          'inclusion-breathe': {
            '0%, 100%': { opacity: '.3' },
            '50%': { opacity: '1' },
          },
          'row-flash': {
            '0%, 55%': { backgroundColor: 'oklch(var(--primary-100) / 0.9)' },
            '100%': { backgroundColor: 'oklch(var(--primary-100) / 0)' },
          },
        },
        animation: {
          'celebrate-glow': 'celebrate-glow 2s ease-in-out infinite',
          'bar-grow': 'bar-grow 0.8s ease-out forwards',
          'entity-refresh': 'entity-refresh 1.1s ease-in-out infinite',
          'row-flash': 'row-flash 2.6s ease-out forwards',
          'progress-ring-offset': 'progress-ring-offset 900ms cubic-bezier(.22, 1, .36, 1) both',
          'progress-ring-dash': 'progress-ring-dash 900ms cubic-bezier(.22, 1, .36, 1) both',
          // Three staggered loading dots.
          'inclusion-breathe': 'inclusion-breathe 1.8s ease-in-out infinite',
          'inclusion-breathe-2': 'inclusion-breathe 1.8s ease-in-out .2s infinite',
          'inclusion-breathe-3': 'inclusion-breathe 1.8s ease-in-out .4s infinite',
        },
      },
    },
    plugins: [],
  }
