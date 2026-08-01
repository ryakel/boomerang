import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  isChatModel, catalogMatch, mergeCatalog, normalizeAnthropic, normalizeOpenAI,
} from '../server/aiModelDiscovery.js'

// A small stand-in catalog so these tests don't move every time the real one
// gains a model.
const CAT = [
  { id: 'claude-sonnet-5', provider: 'anthropic', label: 'Claude Sonnet 5', in: 3, out: 15 },
  { id: 'gpt-5', provider: 'openai', label: 'GPT-5', in: 1.25, out: 10 },
  { id: 'gpt-5-mini', provider: 'openai', label: 'GPT-5 mini', in: 0.25, out: 2 },
]

// --- isChatModel -----------------------------------------------------------

test('OpenAI non-chat models are filtered out of a picker for text completion', () => {
  for (const id of [
    'text-embedding-3-large', 'tts-1', 'whisper-1', 'dall-e-3',
    'gpt-4o-audio-preview', 'gpt-4o-realtime-preview', 'omni-moderation-latest',
    'gpt-4o-transcribe', 'gpt-4o-search-preview',
  ]) {
    assert.equal(isChatModel(id, 'openai'), false, `${id} should not be offered`)
  }
})

test('OpenAI chat models survive the filter, including families not yet released', () => {
  for (const id of ['gpt-5', 'gpt-5.1', 'gpt-6-turbo', 'o3-mini', 'chatgpt-4o-latest']) {
    assert.equal(isChatModel(id, 'openai'), true, `${id} should be offered`)
  }
})

test('every anthropic claude model is a chat model; non-claude ids are not', () => {
  assert.equal(isChatModel('claude-opus-5', 'anthropic'), true)
  assert.equal(isChatModel('claude-fable-5', 'anthropic'), true)
  assert.equal(isChatModel('some-embedding', 'anthropic'), false)
})

test('a missing id is never a model', () => {
  assert.equal(isChatModel('', 'openai'), false)
  assert.equal(isChatModel(null, 'anthropic'), false)
})

// --- catalogMatch ----------------------------------------------------------

test('a dated id prices as the LONGEST matching catalog entry, not the shortest', () => {
  // The trap: 'gpt-5-mini-2025-08-07' starts with 'gpt-5-' too, and pricing it
  // as gpt-5 would overstate cost by 5x.
  assert.equal(catalogMatch('gpt-5-mini-2025-08-07', CAT).id, 'gpt-5-mini')
})

test('an exact id wins over any prefix rule', () => {
  assert.equal(catalogMatch('gpt-5', CAT).id, 'gpt-5')
})

test('an unknown model matches nothing rather than guessing a price', () => {
  assert.equal(catalogMatch('gpt-9-ultra', CAT), null)
})

// --- mergeCatalog ----------------------------------------------------------

test('a newly released model the catalog has never heard of is offered', () => {
  const merged = mergeCatalog([
    { id: 'claude-opus-5', provider: 'anthropic', label: 'Claude Opus 5', created: 3 },
  ], CAT)
  const hit = merged.find(m => m.id === 'claude-opus-5')
  assert.ok(hit, 'the whole point: an unknown model must appear')
  assert.equal(hit.source, 'live')
})

test('an unknown model is offered WITHOUT a made-up price', () => {
  const merged = mergeCatalog([
    { id: 'claude-opus-5', provider: 'anthropic', label: 'Claude Opus 5', created: 3 },
  ], CAT)
  const hit = merged.find(m => m.id === 'claude-opus-5')
  assert.equal(hit.in, undefined)
  assert.equal(hit.out, undefined)
})

test('a catalog model absent from the provider response is KEPT', () => {
  // A filtered response, an outage, or a key without access to one model must
  // not delete a model the user may already have selected.
  const merged = mergeCatalog([{ id: 'gpt-5', provider: 'openai', created: 2 }], CAT)
  assert.ok(merged.find(m => m.id === 'claude-sonnet-5'), 'catalog entry must survive')
  assert.ok(merged.find(m => m.id === 'gpt-5-mini'), 'catalog entry must survive')
})

test('an empty discovery degrades to exactly the catalog, never to nothing', () => {
  const merged = mergeCatalog([], CAT)
  assert.equal(merged.length, CAT.length)
})

test('a discovered model that is also in the catalog keeps the hand-written label and price', () => {
  const merged = mergeCatalog([
    { id: 'gpt-5', provider: 'openai', label: 'gpt-5', created: 2 },
  ], CAT)
  const hit = merged.find(m => m.id === 'gpt-5')
  assert.equal(hit.label, 'GPT-5', 'the catalog label is better than the raw id')
  assert.equal(hit.in, 1.25)
  assert.equal(hit.source, 'both')
})

test('a surviving dated id still inherits the base model price', () => {
  // A dated id is normally collapsed into its undated alias, so this only
  // arises when the base is absent from the offered list. Pricing by prefix
  // still matters regardless: estimateAiCost sees the DATED id the provider
  // echoes back on every call, whatever the picker shows.
  const noGpt5 = CAT.filter(m => !m.id.startsWith('gpt-5'))
  const merged = mergeCatalog([
    { id: 'gpt-5-mini-2025-08-07', provider: 'openai', created: 5 },
  ], noGpt5)
  const hit = merged.find(m => m.id === 'gpt-5-mini-2025-08-07')
  assert.ok(hit, 'kept, because nothing else reaches this model')
  assert.equal(hit.in, undefined, 'nothing to inherit from means no invented price')

  const withBase = mergeCatalog([{ id: 'gpt-5-mini-2025-08-07', provider: 'openai', created: 5 }], CAT)
  assert.ok(!withBase.map(m => m.id).includes('gpt-5-mini-2025-08-07'), 'collapsed into its alias')
  assert.equal(catalogMatch('gpt-5-mini-2025-08-07', CAT).in, 0.25, 'but still priceable')
})

test('junk entries are skipped rather than poisoning the list', () => {
  const merged = mergeCatalog([null, {}, { id: 'x' }, { provider: 'openai' }], CAT)
  assert.equal(merged.length, CAT.length)
})

test('newest first within a provider, so a fresh release is at the top', () => {
  const merged = mergeCatalog([
    { id: 'claude-old', provider: 'anthropic', label: 'Old', created: 1 },
    { id: 'claude-new', provider: 'anthropic', label: 'New', created: 9 },
  ], CAT)
  const anth = merged.filter(m => m.provider === 'anthropic').map(m => m.id)
  assert.ok(anth.indexOf('claude-new') < anth.indexOf('claude-old'))
})

test('undated catalog entries sort after dated ones instead of jumping the queue', () => {
  const merged = mergeCatalog([
    { id: 'claude-new', provider: 'anthropic', label: 'New', created: 9 },
  ], CAT)
  const anth = merged.filter(m => m.provider === 'anthropic').map(m => m.id)
  assert.equal(anth[0], 'claude-new')
})

test('a dated snapshot is dropped when its undated alias is also offered', () => {
  const merged = mergeCatalog([
    { id: 'gpt-5.5-pro', provider: 'openai', created: 9 },
    { id: 'gpt-5.5-pro-2026-04-23', provider: 'openai', created: 8 },
  ], CAT)
  const ids = merged.map(m => m.id)
  assert.ok(ids.includes('gpt-5.5-pro'))
  assert.ok(!ids.includes('gpt-5.5-pro-2026-04-23'), 'the alias covers it')
})

test('a dated snapshot with no undated alias is KEPT — it is the only way there', () => {
  const merged = mergeCatalog([
    { id: 'gpt-6-preview-2026-09-01', provider: 'openai', created: 9 },
  ], CAT)
  assert.ok(merged.map(m => m.id).includes('gpt-6-preview-2026-09-01'))
})

test("Anthropic's date format is not mistaken for a snapshot suffix", () => {
  const merged = mergeCatalog([
    { id: 'claude-haiku-4-5', provider: 'anthropic', created: 9 },
    { id: 'claude-haiku-4-5-20251001', provider: 'anthropic', created: 8 },
  ], CAT)
  const ids = merged.map(m => m.id)
  assert.ok(ids.includes('claude-haiku-4-5-20251001'), 'must not be collapsed away')
})

test('providers stay grouped, so the picker can render optgroups', () => {
  const merged = mergeCatalog([], CAT)
  const provs = merged.map(m => m.provider)
  assert.deepEqual(provs, [...provs].sort(), 'grouped by provider')
})

// --- normalizers -----------------------------------------------------------

test('the Anthropic response shape becomes display names and ms timestamps', () => {
  const out = normalizeAnthropic({
    data: [{ id: 'claude-opus-5', display_name: 'Claude Opus 5', created_at: '2026-05-01T00:00:00Z' }],
  })
  assert.equal(out.length, 1)
  assert.equal(out[0].label, 'Claude Opus 5')
  assert.equal(out[0].provider, 'anthropic')
  assert.equal(out[0].created, Date.parse('2026-05-01T00:00:00Z'))
})

test("OpenAI's epoch SECONDS become milliseconds", () => {
  const out = normalizeOpenAI({ data: [{ id: 'gpt-5', created: 1_700_000_000 }] })
  assert.equal(out[0].created, 1_700_000_000_000)
})

test('a malformed provider body yields no models rather than throwing', () => {
  assert.deepEqual(normalizeAnthropic(null), [])
  assert.deepEqual(normalizeOpenAI({}), [])
  assert.deepEqual(normalizeOpenAI({ data: 'nonsense' }), [])
})
