// Feather assignment — the one color-identity rule (spec §3): a loop's
// feather comes from its index in the FULL routines list, so the same loop
// keeps its color on every surface and pausing another doesn't reshuffle.
// Mirrors the --bm-f-* tokens in kept/palette.css via var() references so
// each palette tunes the actual hue.
export const FEATHERS = [
  'var(--bm-f-ochre)',
  'var(--bm-f-clay)',
  'var(--bm-f-eucalypt)',
  'var(--bm-f-billabong)',
  'var(--bm-f-ironbark)',
  'var(--bm-f-heath)',
]

export function routineFeathers(routines) {
  const m = {}
  for (let i = 0; i < (routines?.length || 0); i++) {
    m[routines[i].id] = FEATHERS[i % FEATHERS.length]
  }
  return m
}
