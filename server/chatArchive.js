// chatArchive.js — the lifecycle of a Quokka chat once you stop talking to it.
// Pure: no db, no network, the clock is passed in. Tested in
// scripts/chatArchive.test.mjs.
//
// WHY THIS EXISTS
//
// The 30-day TTL used to DELETE. A chat you hadn't touched in a month was
// silently gone — no warning past the last 7 days, no way back. That is the
// exact shape CLAUDE.md warns about: a user-visible thing (a conversation you
// had, decisions you talked through) destroyed by a background sweep, with the
// only recovery being "you should have starred it". Quokka chats are the
// reasoning behind half the tasks in the app; the transcript outlives the tasks.
//
// So the sweep now ARCHIVES. Nothing on the auto path deletes any more — the
// only way a chat leaves the database is the user pressing Delete, or the
// archive exceeding its cap (which is loud, see MAX_ARCHIVED_CHATS).
//
// The state machine, in full:
//
//   live, unstarred   --- expiresAt passes ---> archived
//   live, starred     --- never expires --------> (stays live)
//   starred -> unstar --- 7-day grace ----------> archived
//   archived          --- activate / new msg ---> live (fresh 30d clock)
//   any               --- explicit delete ------> gone
//
// INVARIANT: the active chat is never archived. Activating an archived chat
// restores it. Without that, the chat list has to show a chat that isn't in
// either section, and the expiry banner has nothing coherent to say.

export const CHAT_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days rolling from last activity
export const UNSTAR_GRACE_MS = 7 * 24 * 60 * 60 * 1000 // 7-day grace after unstar

// The archive lives in ONE app_data JSON blob that is read and rewritten on
// every chat list request, so it cannot grow without bound. At ~40 messages a
// chat this is already a few MB; past it the blob starts costing real time on
// every poll. Eviction is oldest-archived-first and is LOGGED by the caller —
// silent truncation would read as "the archive keeps everything" when it
// doesn't. At a couple of chats a week this is several years of history.
export const MAX_ARCHIVED_CHATS = 200

export const isArchived = (chat) => !!chat?.archived

/** Move a chat into the archive. Clears the expiry clock — archived is terminal
 *  until the user comes back to it, not another countdown. */
export function archiveChat(chat, now) {
  return { ...chat, archived: true, archivedAt: now, expiresAt: null }
}

/** Bring a chat back to the live list with a fresh TTL. Starred chats come back
 *  with no expiry at all, same as they went in. */
export function restoreChat(chat, now, ttlMs = CHAT_TTL_MS) {
  return {
    ...chat,
    archived: false,
    archivedAt: null,
    expiresAt: chat?.starred ? null : now + ttlMs,
  }
}

/**
 * Decide what the sweep should do, given every chat and the current time.
 *
 * Returns the next array plus the ids it touched, so the caller can skip the
 * write when nothing moved (`changed === false`) rather than rewriting the blob
 * on every list request.
 *
 * @param {object[]} chats     every chat, live and archived
 * @param {number}   now       ms epoch
 * @param {number}   maxArchived cap before oldest-first eviction
 */
export function planChatSweep({ chats, now, maxArchived = MAX_ARCHIVED_CHATS }) {
  const all = Array.isArray(chats) ? chats : []
  const archivedIds = []

  let next = all.map(c => {
    if (!c || typeof c !== 'object') return c
    if (isArchived(c)) return c
    // Starred is a promise: no clock runs on it at all. Belt-and-braces
    // alongside star() nulling expiresAt — a chat that somehow carries both
    // must not be swept out from under the star.
    if (c.starred) return c
    if (c.expiresAt == null) return c
    if (now < c.expiresAt) return c
    archivedIds.push(c.id)
    return archiveChat(c, now)
  })

  // Cap the archive. Oldest first, by when it was archived; a chat with no
  // archivedAt (migrated in from an older shape) falls back to its last
  // activity, and then to 0 so the unknowable ones go first.
  //
  // Starred chats are exempt and don't count toward the cap. Star means "never
  // lose this", and that promise has to survive the one code path that deletes
  // without being asked — you can star something and file it away.
  const evictedIds = []
  const archivedNow = next.filter(c => isArchived(c) && !c.starred)
  if (archivedNow.length > maxArchived) {
    const age = (c) => c.archivedAt ?? c.updatedAt ?? 0
    const doomed = new Set(
      [...archivedNow]
        .sort((a, b) => age(a) - age(b))
        .slice(0, archivedNow.length - maxArchived)
        .map(c => c.id),
    )
    next = next.filter(c => {
      if (!doomed.has(c.id)) return true
      evictedIds.push(c.id)
      return false
    })
  }

  return {
    chats: next,
    archived: archivedIds,
    evicted: evictedIds,
    changed: archivedIds.length > 0 || evictedIds.length > 0,
  }
}
