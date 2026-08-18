// Who the Notion pull's AI task extractor is allowed to read.
//
// These pin the 2026-08-17 incident: Quokka rewrote a reference page because
// it was asked to, the pull saw last_edited move, and the extractor turned the
// prose Boomerang had just written into five live tasks. The rule is
// provenance-first, and the reason it is pure and tested is that getting it
// wrong doesn't throw — it fills someone's Today with work they never asked for.

import test from 'node:test'
import assert from 'node:assert/strict'
import { partitionPagesForAnalysis, summarizeSkips, SKIP } from '../src/notionMining.js'

const page = (id, title = `Page ${id}`) => ({ id, title })
const reasonFor = (res, id) => res.skipped.find(s => s.page.id === id)?.reason

test('a page Boomerang wrote is never a task source', () => {
  const res = partitionPagesForAnalysis([page('kb')], { authored: new Set(['kb']) })
  assert.equal(res.analyze.length, 0)
  assert.equal(reasonFor(res, 'kb'), SKIP.AUTHORED)
})

test('provenance protects a long reference page that is NOT a knowledge-database row', () => {
  // The incident page: Quokka wrote it, and `get_knowledge` reported
  // "Knowledge item not found" for it. Keying protection off knowledge_index
  // membership would have missed it and mined it anyway — which is the whole
  // reason the guard is provenance rather than shape.
  const incident = page('3bed3826c48e81358cd6cbd9b6317fbf', 'Window lifters')
  const viaIndex = partitionPagesForAnalysis([incident], { knowledge: new Set() })
  assert.equal(viaIndex.analyze.length, 1, 'index membership alone does not protect it')

  const viaProvenance = partitionPagesForAnalysis([incident], {
    authored: new Set([incident.id]), knowledge: new Set(),
  })
  assert.equal(viaProvenance.analyze.length, 0)
  assert.equal(reasonFor(viaProvenance, incident.id), SKIP.AUTHORED)
})

test('an authored page stays excluded no matter how often it is edited', () => {
  // There is no last_edited input any more, by design. Re-running the same
  // partition is the test: an edit cannot move a page back into `analyze`.
  const sets = { authored: new Set(['kb']) }
  for (let edit = 0; edit < 5; edit++) {
    assert.equal(partitionPagesForAnalysis([page('kb')], sets).analyze.length, 0)
  }
})

test('a page gets exactly one look, and an edit does not buy it another', () => {
  const first = partitionPagesForAnalysis([page('p1')], { analyzed: new Set() })
  assert.equal(first.analyze.length, 1)
  const second = partitionPagesForAnalysis([page('p1')], { analyzed: new Set(['p1']) })
  assert.equal(second.analyze.length, 0)
  assert.equal(reasonFor(second, 'p1'), SKIP.ANALYZED)
})

test('knowledge-index membership still excludes, as backfill for pre-stamp pages', () => {
  const res = partitionPagesForAnalysis([page('old-kb')], { knowledge: new Set(['old-kb']) })
  assert.equal(res.analyze.length, 0)
  assert.equal(reasonFor(res, 'old-kb'), SKIP.KNOWLEDGE)
})

test('a tombstoned page is never reconsidered, and reports as tombstoned', () => {
  const res = partitionPagesForAnalysis([page('gone')], {
    buried: new Set(['gone']), authored: new Set(['gone']),
  })
  assert.equal(res.analyze.length, 0)
  assert.equal(reasonFor(res, 'gone'), SKIP.BURIED, 'deleted-on-purpose is the most specific thing the user said')
})

test('untitled pages are skipped rather than becoming a task with no name', () => {
  const res = partitionPagesForAnalysis([{ id: 'u1', title: '   ' }, { id: 'u2' }])
  assert.equal(res.analyze.length, 0)
  assert.equal(reasonFor(res, 'u1'), SKIP.UNTITLED)
  assert.equal(reasonFor(res, 'u2'), SKIP.UNTITLED)
})

test('a hand-written page the user just created still gets through', () => {
  // The other half of the contract: over-excluding would mean Notion pages
  // never import again, which is the failure mode opposite to the flood.
  const res = partitionPagesForAnalysis([page('mine', 'Garage cleanout')], {
    authored: new Set(['kb']), analyzed: new Set(['old']), knowledge: new Set(['ref']),
  })
  assert.deepEqual(res.analyze.map(p => p.id), ['mine'])
})

test('mixed batch: only the genuinely new hand-written pages survive', () => {
  const pages = ['authored', 'seen', 'kb', 'dead', 'fresh'].map(id => page(id))
  const res = partitionPagesForAnalysis(pages, {
    authored: new Set(['authored']),
    analyzed: new Set(['seen']),
    knowledge: new Set(['kb']),
    buried: new Set(['dead']),
  })
  assert.deepEqual(res.analyze.map(p => p.id), ['fresh'])
  assert.deepEqual(summarizeSkips(res.skipped), {
    [SKIP.AUTHORED]: 1, [SKIP.ANALYZED]: 1, [SKIP.KNOWLEDGE]: 1, [SKIP.BURIED]: 1,
  })
})

test('empty and malformed input does not throw', () => {
  assert.deepEqual(partitionPagesForAnalysis([]).analyze, [])
  assert.deepEqual(partitionPagesForAnalysis(null).analyze, [])
  assert.deepEqual(partitionPagesForAnalysis([null, { title: 'no id' }]).analyze, [])
})
