// Structural equality by serialization, used to decide whether a hydrate from
// the server carries anything new.
//
// Why it matters: the server broadcasts on every write, and every connected
// client answers a broadcast with a full `/api/data` fetch. With a desktop
// left open and a phone picked up, that is a steady stream of hydrates whose
// payload is usually IDENTICAL to what the client already holds. Writing it to
// state anyway hands React a new array reference, which re-runs every effect
// keyed on `tasks`/`routines` — the routine spawn pass among them. That churn
// is both the "double syncing" the user sees and the window two clients race
// inside when they create the same derived task (2026-08-31).
//
// JSON.stringify is the right comparison here specifically because it's the
// same one `pushChanges` already uses to decide whether a record changed — if
// the two disagreed, a hydrate could be swallowed here and then re-pushed
// there. Key ORDER matters to it, and that's fine: both sides of every
// comparison come from the same `/api/data` shape.
export function sameJson(a, b) {
  if (a === b) return true
  try {
    return JSON.stringify(a) === JSON.stringify(b)
  } catch {
    return false
  }
}
