import test from 'node:test'
import assert from 'node:assert/strict'
import {
  planChatSweep, archiveChat, restoreChat, isArchived,
  CHAT_TTL_MS, MAX_ARCHIVED_CHATS,
} from '../server/chatArchive.js'

// These pin the one rule that matters here: the sweep must never destroy a
// conversation. Before 2026-08-09 a chat untouched for 30 days was DELETED —
// the transcript that explains half the tasks in the app, gone on a timer.

const NOW = Date.UTC(2026, 7, 9, 12)
const DAY = 86400000

const chat = (over = {}) => ({
  id: 'c1',
  title: 'A chat',
  messages: [{ role: 'user', content: 'hi' }],
  starred: false,
  archived: false,
  archivedAt: null,
  createdAt: NOW - 40 * DAY,
  updatedAt: NOW - 31 * DAY,
  expiresAt: NOW - DAY, // expired yesterday
  ...over,
})

test('an expired chat is archived, not deleted', () => {
  const { chats, archived, evicted, changed } = planChatSweep({ chats: [chat()], now: NOW })
  assert.equal(chats.length, 1, 'the chat still exists')
  assert.equal(chats[0].archived, true)
  assert.equal(chats[0].archivedAt, NOW)
  assert.equal(chats[0].expiresAt, null, 'archived is terminal, not another countdown')
  assert.deepEqual(chats[0].messages, [{ role: 'user', content: 'hi' }], 'contents survive')
  assert.deepEqual(archived, ['c1'])
  assert.deepEqual(evicted, [])
  assert.equal(changed, true)
})

test('a live chat inside its window is untouched', () => {
  const c = chat({ expiresAt: NOW + 5 * DAY })
  const { chats, changed } = planChatSweep({ chats: [c], now: NOW })
  assert.equal(chats[0], c, 'same object — nothing rewritten')
  assert.equal(changed, false)
})

test('nothing changed means changed:false so the caller skips the write', () => {
  // The blob is read and rewritten on every list request; churning it once a
  // poll for no change is the thing this flag exists to prevent.
  const { changed } = planChatSweep({ chats: [chat({ expiresAt: null })], now: NOW })
  assert.equal(changed, false)
})

test('a starred chat never archives, even carrying a stale expiry', () => {
  const c = chat({ starred: true, expiresAt: NOW - 100 * DAY })
  const { chats, changed } = planChatSweep({ chats: [c], now: NOW })
  assert.equal(chats[0].archived, false)
  assert.equal(changed, false)
})

test('a chat with no expiry is left alone', () => {
  const { chats, changed } = planChatSweep({ chats: [chat({ expiresAt: null })], now: NOW })
  assert.equal(chats[0].archived, false)
  assert.equal(changed, false)
})

test('an already-archived chat is not re-stamped every sweep', () => {
  const c = chat({ archived: true, archivedAt: NOW - 10 * DAY, expiresAt: null })
  const { chats, changed } = planChatSweep({ chats: [c], now: NOW })
  assert.equal(chats[0].archivedAt, NOW - 10 * DAY, 'original archive date preserved')
  assert.equal(changed, false)
})

test('the boundary is inclusive — expiring exactly now archives', () => {
  const { chats } = planChatSweep({ chats: [chat({ expiresAt: NOW })], now: NOW })
  assert.equal(chats[0].archived, true)
})

test('a mixed list only moves the ones that are due', () => {
  const live = chat({ id: 'live', expiresAt: NOW + DAY })
  const due = chat({ id: 'due', expiresAt: NOW - DAY })
  const star = chat({ id: 'star', starred: true, expiresAt: null })
  const old = chat({ id: 'old', archived: true, archivedAt: NOW - 90 * DAY, expiresAt: null })
  const { chats, archived } = planChatSweep({ chats: [live, due, star, old], now: NOW })
  assert.equal(chats.length, 4, 'nothing left the list')
  assert.deepEqual(archived, ['due'])
  assert.deepEqual(chats.filter(isArchived).map(c => c.id).sort(), ['due', 'old'])
})

test('the archive is capped, evicting the oldest first', () => {
  const many = Array.from({ length: MAX_ARCHIVED_CHATS + 3 }, (_, i) => chat({
    id: `a${i}`,
    archived: true,
    // a0 is the oldest archive, a{n} the newest
    archivedAt: NOW - (MAX_ARCHIVED_CHATS + 3 - i) * DAY,
    expiresAt: null,
  }))
  const { chats, evicted } = planChatSweep({ chats: many, now: NOW })
  assert.deepEqual(evicted, ['a0', 'a1', 'a2'])
  assert.equal(chats.length, MAX_ARCHIVED_CHATS)
  assert.equal(chats.find(c => c.id === 'a3').id, 'a3', 'the next-oldest survived')
})

test('the cap does not count or evict live chats', () => {
  // Only the archive is capped — a live chat must never be dropped by a sweep.
  const live = Array.from({ length: 50 }, (_, i) => chat({ id: `L${i}`, expiresAt: NOW + DAY }))
  const arch = Array.from({ length: 10 }, (_, i) => chat({
    id: `A${i}`, archived: true, archivedAt: NOW - i * DAY, expiresAt: null,
  }))
  const { chats, evicted } = planChatSweep({ chats: [...live, ...arch], now: NOW, maxArchived: 5 })
  assert.equal(evicted.length, 5)
  assert.equal(chats.filter(c => !isArchived(c)).length, 50, 'every live chat survived')
})

test('a starred chat in the archive is exempt from eviction', () => {
  // Star means "never lose this" and the cap is the only path that deletes
  // without being asked. You can star something and still file it away.
  const keep = chat({ id: 'keep', starred: true, archived: true, archivedAt: 0, expiresAt: null })
  const rest = Array.from({ length: 4 }, (_, i) => chat({
    id: `x${i}`, archived: true, archivedAt: NOW - (10 - i) * DAY, expiresAt: null,
  }))
  const { chats, evicted } = planChatSweep({ chats: [keep, ...rest], now: NOW, maxArchived: 2 })
  assert.deepEqual(evicted, ['x0', 'x1'], 'the oldest UNSTARRED two went')
  assert.ok(chats.find(c => c.id === 'keep'), 'the starred one survived despite being oldest')
})

test('an archived chat with no archivedAt sorts by last activity, then goes first', () => {
  const a = chat({ id: 'noStamp', archived: true, archivedAt: null, updatedAt: null, expiresAt: null })
  const b = chat({ id: 'recent', archived: true, archivedAt: NOW - DAY, expiresAt: null })
  const { evicted } = planChatSweep({ chats: [b, a], now: NOW, maxArchived: 1 })
  assert.deepEqual(evicted, ['noStamp'])
})

test('archiveChat and restoreChat round-trip a chat back to a fresh clock', () => {
  const c = chat({ expiresAt: NOW + DAY })
  const gone = archiveChat(c, NOW)
  assert.equal(gone.archived, true)
  assert.equal(gone.expiresAt, null)
  const back = restoreChat(gone, NOW)
  assert.equal(back.archived, false)
  assert.equal(back.archivedAt, null)
  assert.equal(back.expiresAt, NOW + CHAT_TTL_MS, 'full 30 days again, not the remainder')
  assert.deepEqual(back.messages, c.messages)
})

test('restoring a starred chat gives it no expiry at all', () => {
  const back = restoreChat(archiveChat(chat({ starred: true }), NOW), NOW)
  assert.equal(back.expiresAt, null)
})

test('garbage entries pass through rather than throwing', () => {
  // The blob is user data that has survived two schema migrations; a sweep that
  // throws takes the whole chat list down with it.
  const { chats } = planChatSweep({ chats: [null, undefined, 'nope', chat()], now: NOW })
  assert.equal(chats.length, 4)
  assert.equal(chats[3].archived, true)
})

test('an empty or missing list is fine', () => {
  assert.deepEqual(planChatSweep({ chats: [], now: NOW }).chats, [])
  assert.deepEqual(planChatSweep({ chats: null, now: NOW }).chats, [])
})
