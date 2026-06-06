#!/usr/bin/env node
// Smoke test for the terminal-theme stress-test convention (CLAUDE.md
// "Terminal Theme Stress Test"). Scans every v2 component for
// `<ModalShell` JSX usage and asserts each call site carries a
// `terminalTitle=` prop.
//
// Why: the terminal aesthetic depends on every modal title rendering as
// `$ verb --flag` instead of regular human copy. New modals will silently
// drift to the regular title in terminal mode if the prop is forgotten.
// This script is the guardrail.
//
// Run: `npm run check:terminal-titles` (or `node scripts/check-terminal-titles.js`)
// Exits 0 on clean, 1 on missing props. Suitable for CI / pre-push.

import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const V2_DIR = path.join(ROOT, 'src', 'v2')

async function walk(dir, ext, out = []) {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) await walk(full, ext, out)
    else if (e.isFile() && full.endsWith(ext)) out.push(full)
  }
  return out
}

const offenders = []

// Extract every <ModalShell ...> JSX block by scanning for the open tag
// then walking the source character-by-character with a brace counter so
// we don't mistake `>` inside `{() => ...}` for the closing tag boundary.
function findModalShellTags(src) {
  const out = []
  const startRe = /<ModalShell\b/g
  let m
  while ((m = startRe.exec(src)) !== null) {
    let i = m.index + m[0].length
    let braceDepth = 0
    let inSingle = false
    let inDouble = false
    while (i < src.length) {
      const ch = src[i]
      if (!inSingle && !inDouble) {
        if (ch === '{') braceDepth++
        else if (ch === '}') braceDepth--
        else if (braceDepth === 0 && ch === '>') break
        else if (ch === "'") inSingle = true
        else if (ch === '"') inDouble = true
      } else if (inSingle && ch === "'" && src[i - 1] !== '\\') {
        inSingle = false
      } else if (inDouble && ch === '"' && src[i - 1] !== '\\') {
        inDouble = false
      }
      i++
    }
    out.push({ start: m.index, end: i + 1, body: src.slice(m.index, i + 1) })
  }
  return out
}

const files = await walk(V2_DIR, '.jsx')
for (const file of files) {
  const src = await fs.readFile(file, 'utf8')
  if (file.endsWith('ModalShell.jsx')) continue
  for (const tag of findModalShellTags(src)) {
    if (!/\bterminalTitle\s*=/.test(tag.body)) {
      const line = src.slice(0, tag.start).split('\n').length
      offenders.push({ file: path.relative(ROOT, file), line, snippet: tag.body.slice(0, 80) })
    }
  }
}

if (offenders.length === 0) {
  console.log('OK — every <ModalShell> call site has a terminalTitle prop.')
  process.exit(0)
}

console.error('FAIL — <ModalShell> call sites missing `terminalTitle` prop:')
for (const o of offenders) {
  console.error(`  ${o.file}:${o.line}  ${o.snippet}…`)
}
console.error('\nAdd a `terminalTitle="$ verb --flag"` prop. See CLAUDE.md → "Terminal Theme Stress Test".')
process.exit(1)
