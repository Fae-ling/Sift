/** The Sift mark: a shoot's frames sifted, row by row, down to the keeper. Same drawing as build/icon.svg. */
export function Mark({ size = 22 }: { size?: number }): React.JSX.Element {
  return (
    <svg viewBox="0 0 1024 1024" width={size} height={size} aria-hidden="true">
      <defs>
    <linearGradient id="mark-sea" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stopColor="#2a9d97"/>
      <stop offset="0.38" stopColor="#195f60"/>
      <stop offset="0.72" stopColor="#063f47"/>
      <stop offset="1" stopColor="#071a24"/>
    </linearGradient>
    <radialGradient id="mark-glow" cx="0.5" cy="0.8" r="0.35">
      <stop offset="0" stopColor="#d5f2e6" stopOpacity="0.28"/>
      <stop offset="1" stopColor="#d5f2e6" stopOpacity="0"/>
    </radialGradient>
  </defs>
  <rect x="32" y="32" width="960" height="960" rx="216" fill="url(#mark-sea)"/>
  <rect x="32" y="32" width="960" height="960" rx="216" fill="url(#mark-glow)"/>
  <rect x="33" y="33" width="958" height="958" rx="215" fill="none" stroke="#d5f2e6" strokeOpacity="0.14" strokeWidth="2"/>
  
  <rect x="220" y="236" width="96" height="96" rx="22" fill="#d5f2e6" fillOpacity="0.26"/>
  <rect x="342" y="236" width="96" height="96" rx="22" fill="#d5f2e6" fillOpacity="0.26"/>
  <rect x="464" y="236" width="96" height="96" rx="22" fill="#d5f2e6" fillOpacity="0.26"/>
  <rect x="586" y="236" width="96" height="96" rx="22" fill="#d5f2e6" fillOpacity="0.26"/>
  <rect x="708" y="236" width="96" height="96" rx="22" fill="#d5f2e6" fillOpacity="0.26"/>
  <rect x="302" y="394" width="120" height="120" rx="26" fill="#d5f2e6" fillOpacity="0.55"/>
  <rect x="452" y="394" width="120" height="120" rx="26" fill="#d5f2e6" fillOpacity="0.55"/>
  <rect x="602" y="394" width="120" height="120" rx="26" fill="#d5f2e6" fillOpacity="0.55"/>
  <rect x="417" y="578" width="190" height="190" rx="40" fill="#d5f2e6"/>
    </svg>
  )
}
