// listMatch.js — resolving a spoken list name to an actual list. Pure: no db,
// no network, no clock. Tested in scripts/listMatch.test.mjs.
//
// The fourth pure module in this feature, and the one with the least margin
// for cleverness: this decides where a voice-captured item LANDS. Guessing
// wrong files someone's groceries into the wrong store's list, on a list
// another person reads. So the rule is:
//
//   exact match wins outright -> otherwise prefix -> otherwise substring
//   ties are NOT broken, they are RETURNED, and the caller asks
//
// "Ask when ambiguous" is the owner's explicit call (2026-07-28). We never
// silently pick between two plausible lists, and we never rank by recency to
// dodge a question — a destination that drifts with use is exactly the kind of
// invisible state that makes a shared list untrustworthy.

// Speech gives us punctuation and filler that the stored name never has.
// "the grocery list" and "Grocery" have to match, so both sides normalize.
const FILLER = /\b(the|my|our|a|an|list|lists)\b/g

export function normalize(s) {
  return String(s || '')
    .toLowerCase()
    // Speech and keyboards produce curly quotes; the stored name has straight
    // ones. Escapes rather than literals so the class survives every editor.
    .replace(/[\u2018\u2019\u00B4`]/g, "'")
    .replace(/[^a-z0-9'\s]/g, ' ')
    .replace(FILLER, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Resolve a spoken name against the available lists.
 *
 * @param spoken  what the user said, e.g. "the trader joe's list"
 * @param lists   [{ id, name, trello_card_name, orphaned_at }]
 * @param opts.defaultListId  used ONLY when `spoken` is empty
 * @returns {{ match, candidates, reason }}
 *   `match` is set only when the answer is unambiguous. Otherwise `match` is
 *   null and `candidates` holds what to ask about.
 *   reason: 'exact' | 'prefix' | 'substring' | 'only-one' | 'default'
 *         | 'ambiguous' | 'none' | 'no-lists'
 */
export function matchList(spoken, lists, { defaultListId = null } = {}) {
  // Orphaned lists have lost their Trello checklist — adding to one would
  // write into a container that no longer exists on the other side.
  const pool = (Array.isArray(lists) ? lists : []).filter(l => l && l.id && !l.orphaned_at)
  if (!pool.length) return { match: null, candidates: [], reason: 'no-lists' }

  const q = normalize(spoken)

  if (!q) {
    const dflt = defaultListId && pool.find(l => String(l.id) === String(defaultListId))
    if (dflt) return { match: dflt, candidates: [], reason: 'default' }
    // One list and nothing said: there is nothing to be ambiguous about.
    if (pool.length === 1) return { match: pool[0], candidates: [], reason: 'only-one' }
    return { match: null, candidates: pool, reason: 'ambiguous' }
  }

  // Tiers, strongest first. A tier with exactly one hit resolves; a tier with
  // several is the question we ask — we do NOT fall through to a weaker tier,
  // because a weaker tier can only widen an already-ambiguous set.
  const scored = pool.map(l => ({ l, n: normalize(l.name) }))
  const tiers = [
    scored.filter(x => x.n === q),
    scored.filter(x => x.n !== q && x.n.startsWith(q)),
    scored.filter(x => x.n !== q && !x.n.startsWith(q) && x.n.includes(q)),
    // Last resort: the card the list sits on. "add milk to 2026 groceries"
    // names a CARD, not a checklist, and that is a reasonable thing to say.
    scored.filter(x => !x.n.includes(q) && normalize(x.l.trello_card_name).includes(q)),
  ]

  for (const [i, tier] of tiers.entries()) {
    if (tier.length === 1) {
      return {
        match: tier[0].l,
        candidates: [],
        reason: ['exact', 'prefix', 'substring', 'card'][i],
      }
    }
    if (tier.length > 1) {
      return { match: null, candidates: tier.map(x => x.l), reason: 'ambiguous' }
    }
  }

  return { match: null, candidates: pool, reason: 'none' }
}
