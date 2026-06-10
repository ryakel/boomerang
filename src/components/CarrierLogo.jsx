const CARRIER_LOGOS = {
  ups: '/carriers/ups.svg',
  fedex: '/carriers/fedex.svg',
  usps: '/carriers/usps.svg',
  dhl: '/carriers/dhl.svg',
  amazon: '/carriers/amazon.svg',
  ontrac: '/carriers/ontrac.svg',
  lasership: '/carriers/lasership.svg',
}

export default function CarrierLogo({ carrier, size = 24 }) {
  const src = CARRIER_LOGOS[carrier]

  if (!src) {
    // Generic package icon for unknown carriers
    return (
      <svg width={size} height={size} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="32" height="32" rx="4" fill="var(--text-dim)" opacity="0.3"/>
        <path d="M16 4l10 5v14l-10 5-10-5V9l10-5z" stroke="var(--text-muted)" strokeWidth="1.5" fill="none"/>
        <path d="M16 14l10-5M16 14v14M16 14L6 9" stroke="var(--text-muted)" strokeWidth="1.5"/>
      </svg>
    )
  }

  return (
    <img
      src={src}
      alt={carrier}
      width={size}
      height={size}
      style={{ objectFit: 'contain', borderRadius: 3 }}
    />
  )
}
