// The Kept brand mark — "arc into catch": the returning boomerang (gold arc
// landing as a dot) above the open catch-curve (canvas ink). See
// wiki/Kept-Design-Language.md §2. The catch-curve follows the theme's text
// ink via --v2-text so the mark reads on every canvas.
export default function Logo({ size = 28 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none">
      <path
        d="M 22 52 C 30 18, 70 18, 78 52"
        stroke="#F26640"
        strokeWidth="11"
        strokeLinecap="round"
        fill="none"
      />
      <circle cx="78" cy="52" r="8" fill="#F26640" />
      <path
        d="M 30 70 C 42 82, 58 82, 70 70"
        stroke="var(--v2-text, #1F2A22)"
        strokeWidth="10"
        strokeLinecap="round"
        fill="none"
        opacity="0.85"
      />
    </svg>
  )
}
