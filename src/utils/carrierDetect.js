const CARRIERS = [
  {
    code: 'usps',
    name: 'USPS',
    icon: '\u{1F4EE}',
    trackUrl: 'https://tools.usps.com/go/TrackConfirmAction?tLabels=',
    patterns: [/^9[2345]\d{20,26}$/, /^[A-Z]{2}\d{9}US$/, /^(420\d{5,9})?9[2345]\d{20,26}$/],
  },
  {
    code: 'ups',
    name: 'UPS',
    icon: '\u{1F4E6}',
    trackUrl: 'https://www.ups.com/track?tracknum=',
    patterns: [/^1Z[A-Z0-9]{16}$/i, /^T\d{10}$/],
  },
  {
    code: 'fedex',
    name: 'FedEx',
    icon: '\u2708\uFE0F',
    trackUrl: 'https://www.fedex.com/fedextrack/?trknbr=',
    patterns: [/^\d{12}$/, /^\d{15}$/, /^\d{20}$/, /^\d{22}$/],
  },
  {
    code: 'amazon',
    name: 'Amazon',
    icon: '\u{1F4E6}',
    trackUrl: 'https://track.amazon.com/tracking/',
    patterns: [/^TBA\d{12,}$/i],
  },
  {
    code: 'dhl',
    name: 'DHL',
    icon: '\u{1F7E1}',
    trackUrl: 'https://www.dhl.com/us-en/home/tracking/tracking-parcel.html?submit=1&tracking-id=',
    patterns: [/^\d{10}$/, /^\d{11}$/, /^[A-Z]{3}\d{7,}$/],
  },
  {
    code: 'ontrac',
    name: 'OnTrac',
    icon: '\u{1F69A}',
    trackUrl: 'https://www.ontrac.com/tracking/?number=',
    patterns: [/^C\d{14}$/],
  },
  {
    code: 'lasership',
    name: 'LaserShip',
    icon: '\u26A1',
    trackUrl: 'https://www.lasership.com/track/',
    patterns: [/^L[A-Z]\d{8,}$/i],
  },
]

export function detectCarrier(trackingNumber) {
  if (!trackingNumber) return null
  const cleaned = trackingNumber.trim().replace(/\s/g, '')
  for (const carrier of CARRIERS) {
    for (const pattern of carrier.patterns) {
      if (pattern.test(cleaned)) {
        return { code: carrier.code, name: carrier.name, icon: carrier.icon, trackUrl: carrier.trackUrl }
      }
    }
  }
  return null
}

export function getTrackingUrl(carrierCode, trackingNumber) {
  const carrier = CARRIERS.find(c => c.code === carrierCode)
  if (!carrier) return null
  return carrier.trackUrl + encodeURIComponent(trackingNumber.trim())
}

export function getAllCarriers() {
  return CARRIERS.map(c => ({ code: c.code, name: c.name, icon: c.icon }))
}
