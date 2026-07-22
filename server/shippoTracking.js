// Shippo Track API — the USPS leg of package tracking.
//
// USPS killed recipient-side third-party tracking on 2026-04-01 (Mailer-ID
// lockdown), and 17track only serves USPS on its paid "Special Carriers"
// add-on. Shippo, a USPS-authorized provider, still returns full
// recipient-side tracking for arbitrary numbers — verified live 2026-07-21
// against an in-transit Ground Advantage parcel. Deliberately polling-only:
// the server is tailnet-private and can't receive Shippo webhooks, and USPS
// is NOT on Shippo's webhook-only carrier list, so GET polling is supported.
// Auth: SHIPPO_API_TOKEN env or the shippo_api_token setting (Settings →
// Integrations → Shippo). Non-Shippo shipments bill per tracking number.

const SHIPPO_STATUS = {
  PRE_TRANSIT: 'pending',
  TRANSIT: 'in_transit',
  DELIVERED: 'delivered',
  RETURNED: 'exception',
  FAILURE: 'exception',
  UNKNOWN: 'pending',
}

export function mapShippoStatus(track) {
  const raw = track?.tracking_status?.status || 'UNKNOWN'
  let status = SHIPPO_STATUS[raw] || 'pending'
  // Shippo folds out-for-delivery into TRANSIT; the substatus carries it.
  if (track?.tracking_status?.substatus?.code === 'out_for_delivery') status = 'out_for_delivery'
  return { status, detail: track?.tracking_status?.status_details || '' }
}

function fmtLocation(loc) {
  if (!loc) return ''
  return [loc.city, loc.state].filter(Boolean).join(', ')
}

// GET /tracks/{carrier}/{number} → the normalized poll-result shape
// applyTrackingResult() in server.js consumes, or null on any failure
// (callers stamp last_polled themselves so a flaky Shippo can't hot-loop
// the poller).
export async function shippoGetTrack(carrier, trackingNumber, token) {
  try {
    const res = await fetch(
      `https://api.goshippo.com/tracks/${encodeURIComponent(carrier)}/${encodeURIComponent(trackingNumber)}`,
      {
        headers: { Authorization: `ShippoToken ${token}` },
        signal: AbortSignal.timeout(15_000),
      },
    )
    if (!res.ok) {
      console.warn(`[Shippo] track ${trackingNumber}: HTTP ${res.status}`)
      return null
    }
    const track = await res.json()
    // Shippo history is oldest-first; the app renders events newest-first
    // (events[0] drives last_location + the "latest" row treatment).
    const events = (track.tracking_history || [])
      .map((e) => ({
        timestamp: e.status_date || '',
        location: fmtLocation(e.location),
        description: e.status_details || '',
        status: e.status || '',
      }))
      .reverse()
    const { status, detail } = mapShippoStatus(track)
    return { number: trackingNumber, newStatus: status, detail, events, eta: track.eta || null }
  } catch (e) {
    console.warn(`[Shippo] track ${trackingNumber} failed:`, e.message)
    return null
  }
}

// Free auth probe for the integrations health check: the mock "shippo"
// carrier's test numbers resolve on any valid token without billing a real
// tracking number. 401/403 = bad token; 200 = live.
export async function shippoProbe(token) {
  const res = await fetch('https://api.goshippo.com/tracks/shippo/SHIPPO_DELIVERED', {
    headers: { Authorization: `ShippoToken ${token}` },
    signal: AbortSignal.timeout(8_000),
  })
  return { ok: res.ok, status: res.status }
}
