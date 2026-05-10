#!/usr/bin/env node
// Smoke test for terminal-mode button coverage. Greps every CSS file
// in src/v2/components/ for "button-shaped" class definitions (matching
// the v2-*-{btn,pill,toggle,seg,chip,tab,option,action,row} naming
// convention) and asserts each one is referenced from at least one
// rule inside src/v2/terminal/*.css.
//
// Why: the terminal aesthetic depends on every button-shaped surface
// getting its chrome stripped. New components ship with their own
// custom-class buttons (e.g. `.v2-form-energy-pill`, `.v2-analytics-
// range-btn`), and a generic `.v2-form-seg` override won't catch them.
// This guard catches drift.
//
// Run: `npm run check:terminal-buttons` (or via the pre-push hook).
// Exits 0 on clean, 1 on missing classes.

import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const V2_COMPONENTS = path.join(ROOT, 'src', 'v2', 'components')
const TERMINAL_DIR = path.join(ROOT, 'src', 'v2', 'terminal')

// Class-name suffixes that mark a "tappable" surface. If a CSS class
// matches `.v2-*-{suffix}` it's expected to have a terminal-mode
// override (or be explicitly listed in EXEMPT below).
const BUTTON_SUFFIXES = ['btn', 'pill', 'toggle', 'seg', 'chip', 'tab', 'option', 'action', 'row', 'cta', 'trigger']

// Suffixes-or-classes that don't need a terminal override (containers,
// non-interactive rows, layout helpers). Keep this short.
const EXEMPT = new Set([
  'v2-form-row',           // pure layout container
  'v2-form-segmented',     // covered by .v2-form-seg child rule
  'v2-card-actions',       // container; children covered
  'v2-edit-actions-row',   // container; children covered
  'v2-edit-checklist-row', // pure layout
  'v2-edit-routine-row',   // covered explicitly
  'v2-edit-status-row',    // covered by .v2-form-seg child rule
  'v2-form-pri-action',    // sub-element of priority toggle
  'v2-form-toggle',        // sub-element
  'v2-card-meta-row',      // pure layout
  'v2-card-row',           // alias for swipe-wrap
  'v2-card-swipe-wrap',    // wrapper
  'v2-card-swipe-actions', // container; children covered
  'v2-toolbar-pills',      // container; children covered
  'v2-toolbar-search',     // search input variant
  'v2-toolbar-sort',       // container
  'v2-week-strip-row',     // layout for week strip (PR H)
  'v2-fc-card-add',        // FAB card variant
  'v2-fc-card-whatnow',    // FAB card variant
  'v2-activity-meta-row',  // layout sub-row inside an activity entry
  'v2-edit-research-row',  // layout container; children (.v2-form-input + .v2-edit-research-go) covered
  'v2-integrations-row',   // section container; children covered
  'v2-settings-row',       // section container; children covered (toggle/btn/segment)
])

async function walk(dir, ext, out = []) {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) await walk(full, ext, out)
    else if (e.isFile() && full.endsWith(ext)) out.push(full)
  }
  return out
}

// Collect all "button-shaped" class definitions across component CSS.
const componentCSS = await walk(V2_COMPONENTS, '.css')
const declaredClasses = new Set()
const suffixRe = new RegExp(`\\.(v2-[a-z0-9-]+-(?:${BUTTON_SUFFIXES.join('|')}))\\b`, 'g')

for (const file of componentCSS) {
  const src = await fs.readFile(file, 'utf8')
  let m
  while ((m = suffixRe.exec(src)) !== null) {
    const cls = m[1]
    if (!EXEMPT.has(cls)) declaredClasses.add(cls)
  }
}

// Collect terminal-mode overrides. Scan src/v2/terminal/*.css (the
// canonical location) AND any selector inside src/v2/components/*.css
// that includes `[data-theme^="terminal"]` — some components (e.g.
// DateField) ship their terminal overrides alongside their base CSS.
const coveredClasses = new Set()
const allCss = [...(await walk(TERMINAL_DIR, '.css')), ...componentCSS]
const classRe = /\.(v2-[a-z0-9-]+)/g
for (const file of allCss) {
  const src = await fs.readFile(file, 'utf8')
  // Only count class refs inside rules gated on terminal mode.
  const inTerminalDir = file.startsWith(TERMINAL_DIR)
  if (inTerminalDir) {
    let m
    while ((m = classRe.exec(src)) !== null) coveredClasses.add(m[1])
    continue
  }
  // Component CSS — only count classes that appear after a terminal-
  // gated selector on the same line.
  const lines = src.split('\n')
  for (const line of lines) {
    if (!line.includes('[data-theme^="terminal"]')) continue
    let m
    while ((m = classRe.exec(line)) !== null) coveredClasses.add(m[1])
  }
}

const missed = []
for (const cls of declaredClasses) {
  if (!coveredClasses.has(cls)) missed.push(cls)
}
missed.sort()

if (missed.length === 0) {
  console.log(`OK — every button-shaped v2 class has a terminal-mode rule (${declaredClasses.size} classes checked).`)
  process.exit(0)
}

console.error(`FAIL — ${missed.length} button-shaped v2 class(es) missing terminal-mode overrides:`)
for (const cls of missed) console.error(`  .${cls}`)
console.error('\nEither add an override under [data-theme^="terminal"] in src/v2/terminal/init.css')
console.error('(or another terminal CSS file), or add the class to EXEMPT in this script if it is')
console.error('a non-interactive container. See CLAUDE.md → "Terminal Theme Stress Test".')
process.exit(1)
