// notionMining.js — who the Notion pull's AI task extractor is allowed to read.
//
// Pure: no fetch, no localStorage, no React. The whole point is that the rule
// deciding whether a page can turn into tasks is testable on its own, because
// getting it wrong doesn't throw — it quietly fills someone's Today with work
// they never asked for.
//
// The incident (2026-08-17): Quokka rewrote a Notion reference page because it
// was told to, the pull saw `last_edited` move, and `analyzeNotionPage()`
// ("one page might produce 0-5 tasks") turned the prose Boomerang had just
// written into five live tasks. So the rule is provenance-first.

// Reasons a page is skipped. Exported so callers can log them and tests can
// assert on them by name rather than by string literal.
export const SKIP = {
  AUTHORED: 'authored-by-boomerang',
  ANALYZED: 'already-analyzed',
  KNOWLEDGE: 'knowledge-item',
  BURIED: 'tombstoned',
  UNTITLED: 'untitled',
}

/**
 * Split the candidate pages into the ones the extractor may read and the ones
 * it may not, with a reason for every exclusion.
 *
 * @param {Array<{id: string, title?: string}>} pages  unlinked candidate pages
 * @param {object} sets
 * @param {Set<string>} sets.authored   pages Boomerang wrote or rewrote
 * @param {Set<string>} sets.analyzed   pages the extractor has already seen
 * @param {Set<string>} sets.knowledge  pages in the knowledge index
 * @param {Set<string>} sets.buried     tombstoned pages (deleted on purpose)
 * @returns {{analyze: Array, skipped: Array<{page, reason: string}>}}
 */
export function partitionPagesForAnalysis(pages, sets = {}) {
  const authored = sets.authored || new Set()
  const analyzed = sets.analyzed || new Set()
  const knowledge = sets.knowledge || new Set()
  const buried = sets.buried || new Set()

  const analyze = []
  const skipped = []
  for (const page of pages || []) {
    if (!page?.id) continue
    // Order matters only for which reason gets reported; every branch skips.
    // Tombstone first: "I deleted this on purpose" is the most specific thing
    // the user ever said about a page.
    if (buried.has(page.id)) { skipped.push({ page, reason: SKIP.BURIED }); continue }
    // Provenance beats everything else we know. We do not mine our own output,
    // whatever shape it happens to have.
    if (authored.has(page.id)) { skipped.push({ page, reason: SKIP.AUTHORED }); continue }
    // Backfill for knowledge pages that predate the authored stamp.
    if (knowledge.has(page.id)) { skipped.push({ page, reason: SKIP.KNOWLEDGE }); continue }
    // One look per page, ever. NOT "one look per edit" — an edit to a page that
    // has already been considered is the user maintaining their notes, not a
    // request for tasks, and treating it as one is what made a single Quokka
    // session produce three separate rounds of mining.
    if (analyzed.has(page.id)) { skipped.push({ page, reason: SKIP.ANALYZED }); continue }
    if (!page.title || !String(page.title).trim()) { skipped.push({ page, reason: SKIP.UNTITLED }); continue }
    analyze.push(page)
  }
  return { analyze, skipped }
}

// Count skips by reason, for one log line instead of one per page.
export function summarizeSkips(skipped) {
  const out = {}
  for (const s of skipped || []) out[s.reason] = (out[s.reason] || 0) + 1
  return out
}
