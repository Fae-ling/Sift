/** A small set of line icons, drawn inline so nothing is loaded from outside. */
const PATHS: Record<string, string> = {
  brief: 'M7 3h7l4 4v14H7zM14 3v4h4M10 12h5M10 16h5',
  import: 'M12 3v12m0 0-4-4m4 4 4-4M5 17v3h14v-3',
  cull: 'M4 6h16M4 12h10M4 18h6M17 14l2 2 4-4',
  story: 'M4 6h4v12H4zM10 6h4v12h-4zM16 6h4v12h-4z',
  handoff: 'M5 12h11m0 0-4-4m4 4-4 4M19 5v14',
  styles: 'M12 3l2.5 5 5.5.8-4 3.9.9 5.5L12 15.6 7.1 18.2 8 12.7 4 8.8 9.5 8z',
  emotions: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM8.5 14.5s1.2 2 3.5 2 3.5-2 3.5-2M9 9.5h.01M15 9.5h.01',
  training: 'M4 19V9m5 10V5m5 14v-7m5 7V3',
  diagnose: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3M8 11h6M11 8v6',
  look: 'M12 3a9 9 0 1 0 0 18c1 0 1.5-.8 1.5-1.6 0-1.2-1-1.4-1-2.4 0-.9.7-1.5 1.6-1.5H16a5 5 0 0 0 5-5c0-4-4-7.5-9-7.5zM7.5 11h.01M10 7.5h.01M14.5 7.5h.01',
  learn: 'M3 7l9-4 9 4-9 4-9-4zM7 9v5c0 1.5 2.2 3 5 3s5-1.5 5-3V9',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-2.7-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.1-2.7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 2.7-1.1V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1.3z',
  back: 'M15 18l-6-6 6-6',
  projects: 'M3 7h7l2 2h9v10H3z',
  check: 'M5 12l5 5L20 7',
  bolt: 'M13 2 4 14h7l-1 8 9-12h-7z',
  sparkle: 'M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6',
  sliders: 'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4',
  keyboard: 'M3 6h18v12H3zM7 10h.01M11 10h.01M15 10h.01M7 14h10'
}

export function Icon({ name, size = 16 }: { name: keyof typeof PATHS | string; size?: number }): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={PATHS[name] ?? ''} />
    </svg>
  )
}
