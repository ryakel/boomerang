// Simplified but recognizable carrier logo SVGs
export default function CarrierLogo({ carrier, size = 24 }) {
  const s = size

  switch (carrier) {
    case 'ups':
      return (
        <svg width={s} height={s} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
          {/* Brown shield */}
          <path d="M16 2C16 2 4 6 4 6v12c0 7.2 5.6 11.2 12 14 6.4-2.8 12-6.8 12-14V6S16 2 16 2z" fill="#351C15"/>
          <path d="M16 4.5C16 4.5 6 7.8 6 7.8v10.4c0 6 4.6 9.4 10 11.8 5.4-2.4 10-5.8 10-11.8V7.8S16 4.5 16 4.5z" fill="#FFB500"/>
          {/* UPS text */}
          <text x="16" y="20" textAnchor="middle" fill="#351C15" fontSize="8" fontWeight="900" fontFamily="Arial,sans-serif">UPS</text>
        </svg>
      )

    case 'fedex':
      return (
        <svg width={s} height={s} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect width="32" height="32" rx="4" fill="#fff"/>
          <text x="3" y="21" fill="#4D148C" fontSize="12" fontWeight="900" fontFamily="Arial,sans-serif">Fed</text>
          <text x="19" y="21" fill="#FF6600" fontSize="12" fontWeight="900" fontFamily="Arial,sans-serif">Ex</text>
        </svg>
      )

    case 'usps':
      return (
        <svg width={s} height={s} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect width="32" height="32" rx="4" fill="#004B87"/>
          {/* Eagle wing shape */}
          <path d="M4 18c2-4 6-8 12-10 4-1.2 8-0.5 12 1l-4 2c-3-1-6-0.8-9 0.5C11 13 8 15.5 6 19l-2-1z" fill="#fff"/>
          <text x="16" y="27" textAnchor="middle" fill="#fff" fontSize="6" fontWeight="900" fontFamily="Arial,sans-serif">USPS</text>
        </svg>
      )

    case 'dhl':
      return (
        <svg width={s} height={s} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect width="32" height="32" rx="4" fill="#FFCC00"/>
          <text x="16" y="21" textAnchor="middle" fill="#D40511" fontSize="13" fontWeight="900" fontFamily="Arial,sans-serif">DHL</text>
        </svg>
      )

    case 'amazon':
      return (
        <svg width={s} height={s} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect width="32" height="32" rx="4" fill="#232F3E"/>
          {/* Smile arrow */}
          <path d="M8 20c3 2.5 7 3.5 12 2" stroke="#FF9900" strokeWidth="2" strokeLinecap="round" fill="none"/>
          <path d="M18 19l3 3-3 3" stroke="#FF9900" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
          <text x="16" y="15" textAnchor="middle" fill="#fff" fontSize="6.5" fontWeight="700" fontFamily="Arial,sans-serif">amazon</text>
        </svg>
      )

    case 'ontrac':
      return (
        <svg width={s} height={s} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect width="32" height="32" rx="4" fill="#1B5E20"/>
          <text x="16" y="20" textAnchor="middle" fill="#fff" fontSize="7" fontWeight="800" fontFamily="Arial,sans-serif">OnTrac</text>
        </svg>
      )

    case 'lasership':
      return (
        <svg width={s} height={s} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect width="32" height="32" rx="4" fill="#1A237E"/>
          {/* Laser/bolt shape */}
          <path d="M18 6l-6 10h5l-3 10 8-12h-5l4-8h-3z" fill="#7C4DFF"/>
          <text x="16" y="30" textAnchor="middle" fill="#fff" fontSize="4.5" fontWeight="700" fontFamily="Arial,sans-serif">LaserShip</text>
        </svg>
      )

    default:
      return (
        <svg width={s} height={s} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect width="32" height="32" rx="4" fill="var(--text-dim)" opacity="0.3"/>
          {/* Generic package icon */}
          <path d="M16 4l10 5v14l-10 5-10-5V9l10-5z" stroke="var(--text-muted)" strokeWidth="1.5" fill="none"/>
          <path d="M16 14l10-5M16 14v14M16 14L6 9" stroke="var(--text-muted)" strokeWidth="1.5"/>
        </svg>
      )
  }
}
