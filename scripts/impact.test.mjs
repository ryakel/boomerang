// Unit tests for impactRank() in src/scoring.js — the single scorer behind
// Today ordering, the Tasks "Impact" sort, and the Next-up toast.
// Run via `npm test` (node --test).
import test from 'node:test'
import assert from 'node:assert/strict'
import { impactRank, CRISIS_RANK } from '../src/scoring.js'

const TODAY = '2026-07-14'
const ctx = (extra = {}) => ({ todayYmd: TODAY, nowMs: Date.UTC(2026, 6, 14, 12), ...extra })
const task = (extra = {}) => ({ title: 't', tags: [], created_at: '2026-07-10T00:00:00.000Z', ...extra })

test('crisis always outranks everything', () => {
  const crisisCtx = ctx({ isCrisis: t => (t.tags || []).includes('prio') })
  const loaded = task({ impact: 3, due_date: '2026-07-10', tags: [] })
  const crisis = task({ tags: ['prio'], impact: 1 })
  assert.equal(impactRank(crisis, crisisCtx), CRISIS_RANK)
  assert.ok(impactRank(crisis, crisisCtx) > impactRank(loaded, crisisCtx))
})

test('null impact scores as the 2 baseline (lazy backfill)', () => {
  assert.equal(impactRank(task({ impact: null }), ctx()), impactRank(task({ impact: 2 }), ctx()))
})

test('higher impact wins at equal urgency', () => {
  const c = ctx()
  assert.ok(impactRank(task({ impact: 3 }), c) > impactRank(task({ impact: 2 }), c))
  assert.ok(impactRank(task({ impact: 2 }), c) > impactRank(task({ impact: 1 }), c))
})

test('due proximity ladder: overdue > today > tomorrow > this week > later', () => {
  const c = ctx()
  const at = due => impactRank(task({ impact: 2, due_date: due }), c)
  assert.ok(at('2026-07-13') > at('2026-07-14'))
  assert.ok(at('2026-07-14') > at('2026-07-15'))
  assert.ok(at('2026-07-15') > at('2026-07-18'))
  assert.ok(at('2026-07-18') > at('2026-08-14'))
})

test('due-today impact-1 does not beat undated impact-3 (impact dominates urgency ties)', () => {
  const c = ctx()
  assert.ok(impactRank(task({ impact: 3 }), c) > impactRank(task({ impact: 1, due_date: TODAY }), c))
})

test('weather window boosts only outdoor tasks and only when active', () => {
  const outdoorCtx = ctx({ weatherWindowActive: true, isOutdoor: t => t.energy === 'physical' })
  const mow = task({ impact: 2, energy: 'physical' })
  const bills = task({ impact: 2, energy: 'desk' })
  assert.equal(impactRank(mow, outdoorCtx) - impactRank(bills, outdoorCtx), 50)
  const inactiveCtx = ctx({ weatherWindowActive: false, isOutdoor: t => t.energy === 'physical' })
  assert.equal(impactRank(mow, inactiveCtx), impactRank(bills, inactiveCtx))
})

test('event proximity ramps up as the date approaches and expires after it', () => {
  const ev = { date: '2026-07-24', lead_days: 10, tag: 'xmas' }
  const tagged = task({ impact: 2, tags: ['xmas'] })
  const far = impactRank(tagged, ctx({ impactDates: [ev], todayYmd: '2026-07-14' }))
  const near = impactRank(tagged, ctx({ impactDates: [ev], todayYmd: '2026-07-22' }))
  const onDay = impactRank(tagged, ctx({ impactDates: [ev], todayYmd: '2026-07-24' }))
  const after = impactRank(tagged, ctx({ impactDates: [ev], todayYmd: '2026-07-25' }))
  const none = impactRank(task({ impact: 2 }), ctx({ impactDates: [ev] }))
  assert.ok(near > far)
  assert.ok(onDay > near)
  assert.equal(onDay - none, 50)
  assert.equal(after, none)
})

test('event boost requires the shared tag', () => {
  const ev = { date: '2026-07-16', lead_days: 10, tag: 'xmas' }
  const untagged = task({ impact: 2, tags: ['other'] })
  assert.equal(impactRank(untagged, ctx({ impactDates: [ev] })), impactRank(task({ impact: 2 }), ctx()))
})

test('stale decay caps at -15 and only starts past 14 days', () => {
  const fresh = task({ impact: 2, created_at: '2026-07-01T00:00:00.000Z' })
  const old = task({ impact: 2, created_at: '2026-05-01T00:00:00.000Z' })
  const ancient = task({ impact: 2, created_at: '2024-01-01T00:00:00.000Z' })
  const c = ctx()
  assert.equal(impactRank(fresh, c), 200)
  assert.equal(impactRank(old, c), 185)
  assert.equal(impactRank(old, c), impactRank(ancient, c))
})
