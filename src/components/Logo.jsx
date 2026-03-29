export default function Logo({ size = 28 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 80 80" fill="none">
      <path
        d="M 13 27 C 18 13, 34 42, 40 57 C 46 42, 60 13, 67 27"
        stroke="#F26640"
        strokeWidth="13"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M 13 27 C 18 13, 30 38, 35 51"
        stroke="#FF8060"
        strokeWidth="3.5"
        strokeLinecap="round"
        fill="none"
        opacity="0.5"
      />
    </svg>
  )
}
