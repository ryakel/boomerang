import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  ShoppingCart, Plus, Trash2, ChevronRight, ArrowLeft, RefreshCw,
  Link2, AlertTriangle, Check, X, GripVertical,
} from 'lucide-react'
import ModalShell from './ModalShell'
import EmptyState from './EmptyState'
import { safeSetItem } from '../store'
import { useListItems } from '../hooks/useLists'
import {
  fetchTrelloBoards, fetchTrelloBoardLists, fetchTrelloListCards, fetchTrelloCardChecklists,
  fetchTrelloCard, parseTrelloCardRef,
} from '../api'
import './ListsModal.css'

// Sort is a VIEW preference and never writes. This matters more than it looks:
// `position` (items) and `sort_order` (lists) are ordering columns, and a sort
// mode that "applied" itself by renumbering one of them would turn choosing a
// dropdown into a data mutation — at item level that would push a full reorder
// of someone else's Trello checklist every time the dropdown changed. Only a
// drag writes, and only in Manual mode.
//
// Per-device by design: which order you like looking at is not something to
// send through the settings blob (last-writer-wins, and it has eaten data
// twice — see CLAUDE.md).
const SORT_KEY = 'boom_lists_sort_v1'
const SORT_MODES = [
  { value: 'manual', label: 'Manual' },
  { value: 'name', label: 'Name' },
  { value: 'recent', label: 'Recent' },
]

function loadSortMode() {
  try {
    const v = localStorage.getItem(SORT_KEY)
    return SORT_MODES.some(m => m.value === v) ? v : 'manual'
  } catch { return 'manual' }
}

function fmtWhen(iso) {
  if (!iso) return 'never'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'never'
  const mins = Math.round((Date.now() - d.getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  if (mins < 24 * 60) return `${Math.round(mins / 60)}h ago`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// ---------------------------------------------------------------
// Trello link picker — board → list → card → checklist, cascading.
// Exists so a card can be chosen without ever opening Trello, which is the
// entire point of the feature. Each step only loads once its parent is picked.
// ---------------------------------------------------------------
function TrelloLinkPanel({ list, onLink, onUnlink, busy }) {
  const [boards, setBoards] = useState(null)
  const [boardId, setBoardId] = useState('')
  const [tLists, setTLists] = useState(null)
  const [tListId, setTListId] = useState('')
  const [cards, setCards] = useState(null)
  const [cardId, setCardId] = useState('')
  const [checklists, setChecklists] = useState(null)
  const [error, setError] = useState(null)
  const [paste, setPaste] = useState('')
  const [pastedName, setPastedName] = useState(null)

  const load = useCallback(async (fn, set) => {
    setError(null)
    try { set(await fn()) } catch (err) { setError(err.message); set([]) }
  }, [])

  useEffect(() => { if (boards === null) load(fetchTrelloBoards, setBoards) }, [boards, load])

  const pickBoard = (id) => {
    setBoardId(id); setTLists(null); setTListId(''); setCards(null); setCardId(''); setChecklists(null)
    if (id) load(() => fetchTrelloBoardLists(id), setTLists)
  }
  const pickList = (id) => {
    setTListId(id); setCards(null); setCardId(''); setChecklists(null)
    if (id) load(() => fetchTrelloListCards(id), setCards)
  }
  const pickCard = (id) => {
    setCardId(id); setChecklists(null); setPastedName(null)
    if (id) load(() => fetchTrelloCardChecklists(id), setChecklists)
  }

  if (list.trello_card_id) {
    return (
      <div className="v2-lists-link">
        <div className="v2-lists-link-status">
          <Link2 size={14} strokeWidth={2} />
          <span>Linked to a Trello checklist · synced {fmtWhen(list.last_synced_at)}</span>
        </div>
        {list.last_sync_error && (
          <div className="v2-lists-link-warn">
            <AlertTriangle size={14} strokeWidth={2} />
            <span>{list.last_sync_error}</span>
          </div>
        )}
        <button className="v2-lists-link-unlink" onClick={onUnlink} disabled={busy}>
          Unlink from Trello
        </button>
        <p className="v2-lists-link-note">
          Unlinking only stops syncing. Nothing is removed from the Trello card.
        </p>
      </div>
    )
  }

  const findCard = async () => {
    const ref = parseTrelloCardRef(paste)
    if (!ref) { setError("That doesn't look like a Trello card link."); return }
    setError(null)
    try {
      const card = await fetchTrelloCard(ref)
      setCardId(card.id) // canonical id, not the short link
      setChecklists(await fetchTrelloCardChecklists(card.id))
      setPastedName(card.name)
    } catch (err) {
      setError(err.message)
      setChecklists(null)
    }
  }

  return (
    <div className="v2-lists-link">
      <p className="v2-lists-link-intro">Pick the Trello card whose checklist this list should mirror.</p>
      {error && <div className="v2-lists-link-warn"><AlertTriangle size={14} strokeWidth={2} /><span>{error}</span></div>}

      {/* Paste-a-link first: it is both faster and the ONLY route to a card on
          a board you are not a member of — which is the normal shape of a list
          someone else owns and shared with you. */}
      <label className="v2-lists-link-field">
        <span>Paste a card link</span>
        <div className="v2-lists-link-paste">
          <input
            value={paste}
            onChange={e => setPaste(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); findCard() } }}
            placeholder="https://trello.com/c/…"
          />
          <button type="button" onClick={findCard} disabled={!paste.trim()}>Find</button>
        </div>
      </label>
      {pastedName && <p className="v2-lists-link-note">Found: <strong>{pastedName}</strong></p>}

      <p className="v2-lists-link-or">or browse your boards</p>

      <label className="v2-lists-link-field">
        <span>Board</span>
        <select value={boardId} onChange={e => pickBoard(e.target.value)} disabled={!boards}>
          <option value="">{boards ? 'Choose a board…' : 'Loading…'}</option>
          {(boards || []).map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </label>

      {boardId && (
        <label className="v2-lists-link-field">
          <span>List</span>
          <select value={tListId} onChange={e => pickList(e.target.value)} disabled={!tLists}>
            <option value="">{tLists ? 'Choose a list…' : 'Loading…'}</option>
            {(tLists || []).map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </label>
      )}

      {tListId && (
        <label className="v2-lists-link-field">
          <span>Card</span>
          <select value={cardId} onChange={e => pickCard(e.target.value)} disabled={!cards}>
            <option value="">{cards ? 'Choose a card…' : 'Loading…'}</option>
            {(cards || []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
      )}

      {cardId && checklists && (
        checklists.length === 0 ? (
          <div className="v2-lists-link-warn">
            <AlertTriangle size={14} strokeWidth={2} />
            <span>That card has no checklists. Add one in Trello first — this syncs a checklist, not the card.</span>
          </div>
        ) : (
          <div className="v2-lists-link-checklists">
            {checklists.map(cl => (
              <button
                key={cl.id}
                className="v2-lists-link-choice"
                disabled={busy}
                onClick={() => onLink({ trello_card_id: cardId, trello_checklist_id: cl.id })}
              >
                <span>{cl.name}</span>
                <span className="v2-lists-link-count">{(cl.checkItems || []).length} items</span>
              </button>
            ))}
          </div>
        )
      )}
    </div>
  )
}

// ---------------------------------------------------------------
// One list: its items, plus the add field
// ---------------------------------------------------------------
function ListDetail({ list: indexList, onBack, onEditList, onDeleteList }) {
  const { list: fetchedList, items, loading, error, addItems, toggleItem, removeItem, moveItem, syncNow, reload } = useListItems(indexList.id)
  // The index copy is only as fresh as the last hydrate; the items fetch
  // returns the list alongside them and reload() runs after every sync, so
  // sync state (last_synced_at, last_sync_error) must come from that one or a
  // just-resolved error would not appear until the next round-trip.
  const list = fetchedList ? { ...indexList, ...fetchedList } : indexList
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [itemDragId, setItemDragId] = useState(null)
  const [itemDropId, setItemDropId] = useState(null)
  const [syncMsg, setSyncMsg] = useState(null)
  const [showSettings, setShowSettings] = useState(false)

  const remaining = items.filter(i => !i.checked)
  const done = items.filter(i => i.checked)

  const submit = async (e) => {
    e?.preventDefault()
    const raw = draft.trim()
    if (!raw || busy) return
    setBusy(true)
    try {
      await addItems(raw)
      setDraft('')
    } catch (err) {
      setSyncMsg(err.message)
    } finally { setBusy(false) }
  }

  const doSync = async () => {
    setBusy(true); setSyncMsg(null)
    try {
      const r = await syncNow()
      setSyncMsg(r?.warnings?.length ? r.warnings.join('; ') : `Synced · ${r?.changed || 0} change${r?.changed === 1 ? '' : 's'}`)
    } catch (err) {
      setSyncMsg(err.message)
    } finally { setBusy(false) }
  }

  // A drag is the ONLY thing in this feature that reorders someone else's
  // checklist, so it is deliberately explicit: drop on a row to land before
  // it, or on the trailing target to go to the end. The server owns the
  // resulting order — it computes the position and hands the items back, so
  // the UI can never show an order Trello disagrees with.
  const dropItem = async (beforeId) => {
    const moved = itemDragId
    setItemDragId(null); setItemDropId(null)
    if (!moved || moved === beforeId) return
    try {
      const r = await moveItem(moved, beforeId)
      // A held write is not an error, but it must not pass silently either:
      // from in here a reorder that never reached Trello looks identical to
      // one that did.
      if (r?.heldWrites) setSyncMsg('Reordered here — not sent to Trello (this server is read-only)')
    } catch (err) {
      setSyncMsg(err.message)
    }
  }

  const clearChecked = async () => {
    setBusy(true)
    try { for (const item of done) await removeItem(item.id) } finally { setBusy(false) }
  }

  return (
    <div className="v2-lists-detail">
      <div className="v2-lists-detail-bar">
        <button className="v2-lists-icon-btn" onClick={onBack} title="All lists">
          <ArrowLeft size={16} strokeWidth={2} />
        </button>
        <div className="v2-lists-detail-title">
          <strong>{list.name}</strong>
          <span>{remaining.length} to get{done.length ? ` · ${done.length} done` : ''}</span>
        </div>
        {list.trello_card_id && (
          <button className="v2-lists-icon-btn" onClick={doSync} disabled={busy} title="Sync now">
            <RefreshCw size={16} strokeWidth={2} className={busy ? 'v2-lists-spin' : ''} />
          </button>
        )}
        <button className="v2-lists-icon-btn" onClick={() => setShowSettings(s => !s)} title="List settings">
          <Link2 size={16} strokeWidth={2} />
        </button>
      </div>

      {syncMsg && <div className="v2-lists-msg" onClick={() => setSyncMsg(null)}>{syncMsg}</div>}

      {/* Passive sync trouble, shown without having to open settings or press
          Sync. A list that silently stops reaching Trello looks identical to
          one that is working, which is the worst possible failure for a list
          someone else is relying on. */}
      {!syncMsg && list.last_sync_error && (
        <div className="v2-lists-link-warn v2-lists-detail-warn">
          <AlertTriangle size={14} strokeWidth={2} />
          <span>{list.last_sync_error}</span>
        </div>
      )}

      <form className="v2-lists-add" onSubmit={submit}>
        <input
          className="v2-lists-add-input"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          placeholder="Add items — separate with commas or new lines"
          disabled={busy}
        />
        <button className="v2-lists-add-btn" type="submit" disabled={busy || !draft.trim()}>
          <Plus size={16} strokeWidth={2} />
        </button>
      </form>

      {showSettings && (
        <div className="v2-lists-settings">
          <TrelloLinkPanel
            list={list}
            busy={busy}
            onLink={async (fields) => {
              setBusy(true)
              try { await onEditList(list.id, fields); await reload() } finally { setBusy(false) }
            }}
            onUnlink={async () => {
              setBusy(true)
              try { await onEditList(list.id, { trello_card_id: null }); await reload() } finally { setBusy(false) }
            }}
          />
          <button className="v2-lists-danger" onClick={() => onDeleteList(list.id)} disabled={busy}>
            <Trash2 size={14} strokeWidth={2} /> Delete this list
          </button>
        </div>
      )}

      {loading && !items.length ? (
        <p className="v2-lists-loading">Loading…</p>
      ) : error ? (
        <div className="v2-lists-link-warn"><AlertTriangle size={14} strokeWidth={2} /><span>{error}</span></div>
      ) : !items.length ? (
        <EmptyState icon={ShoppingCart} title="Nothing on this list" body="Add something above, or ask Quokka." />
      ) : (
        <>
          {/* Only the still-to-get items are draggable. Reordering the "Got"
              pile is busywork, and every drag here is a real write to a
              checklist someone else reads. */}
          <ul className="v2-lists-items">
            {remaining.map(item => (
              <li
                key={item.id}
                className={`v2-lists-item${itemDragId === item.id ? ' v2-lists-dragging' : ''}${itemDropId === item.id ? ' v2-lists-dropinto' : ''}`}
                onDragOver={remaining.length > 1 ? (e) => { e.preventDefault(); setItemDropId(item.id) } : undefined}
                onDrop={remaining.length > 1 ? (e) => { e.preventDefault(); dropItem(item.id) } : undefined}
              >
                {remaining.length > 1 && (
                  <span
                    className="v2-lists-grip v2-lists-item-grip"
                    draggable
                    onDragStart={() => setItemDragId(item.id)}
                    onDragEnd={() => { setItemDragId(null); setItemDropId(null) }}
                    aria-hidden="true"
                  >
                    <GripVertical size={14} strokeWidth={2} />
                  </span>
                )}
                <button className="v2-lists-check" onClick={() => toggleItem(item.id, true)} title="Got it">
                  <span className="v2-lists-box" />
                </button>
                <span className="v2-lists-item-name">{item.name}</span>
                <button className="v2-lists-icon-btn v2-lists-item-del" onClick={() => removeItem(item.id)} title="Remove">
                  <X size={14} strokeWidth={2} />
                </button>
              </li>
            ))}
            {/* A drop target past the last row. Without it there is no way to
                drag something to the bottom — every other target means
                "before this one". */}
            {remaining.length > 1 && itemDragId && (
              <li
                className={`v2-lists-item-end${itemDropId === '__end__' ? ' v2-lists-dropinto' : ''}`}
                onDragOver={(e) => { e.preventDefault(); setItemDropId('__end__') }}
                onDrop={(e) => { e.preventDefault(); dropItem(null) }}
              >
                Move to the end
              </li>
            )}
          </ul>

          {done.length > 0 && (
            <>
              <div className="v2-lists-done-head">
                <span>Got</span>
                <button className="v2-lists-clear" onClick={clearChecked} disabled={busy}>Clear</button>
              </div>
              <ul className="v2-lists-items">
                {done.map(item => (
                  <li key={item.id} className="v2-lists-item v2-lists-item-done">
                    <button className="v2-lists-check" onClick={() => toggleItem(item.id, false)} title="Put it back">
                      <span className="v2-lists-box v2-lists-box-checked"><Check size={12} strokeWidth={3} /></span>
                    </button>
                    <span className="v2-lists-item-name">{item.name}</span>
                    <button className="v2-lists-icon-btn v2-lists-item-del" onClick={() => removeItem(item.id)} title="Remove">
                      <X size={14} strokeWidth={2} />
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------
// Link a whole CARD or COLUMN, rather than one checklist at a time.
//
// The reason this beats picking a checklist: auto-discovery. A checklist she
// adds to the card — or, at column scope, a whole new store card — becomes a
// list here on its own. Picking one checklist by hand can never do that, and
// before this the addition was simply never seen.
// ---------------------------------------------------------------
function SourcesPanel({ sources, onAddSource, onExpand, onRemoveSource, busy, setBusy }) {
  const [boards, setBoards] = useState(null)
  const [boardId, setBoardId] = useState('')
  const [cols, setCols] = useState(null)
  const [colId, setColId] = useState('')
  const [cards, setCards] = useState(null)
  const [error, setError] = useState(null)
  const [msg, setMsg] = useState(null)

  const load = useCallback(async (fn, set) => {
    setError(null)
    try { set(await fn()) } catch (err) { setError(err.message); set([]) }
  }, [])

  useEffect(() => { if (boards === null) load(fetchTrelloBoards, setBoards) }, [boards, load])

  const pickBoard = (id) => {
    setBoardId(id); setCols(null); setColId(''); setCards(null)
    if (id) load(() => fetchTrelloBoardLists(id), setCols)
  }
  const pickCol = (id) => {
    setColId(id); setCards(null)
    if (id) load(() => fetchTrelloListCards(id), setCards)
  }

  const link = async (scope, trelloId, name) => {
    setBusy(true); setError(null); setMsg(null)
    try {
      const data = await onAddSource({ scope, trello_id: trelloId, name, trello_board_id: boardId || null })
      const r = data?.result
      setMsg(r ? `Linked — ${r.created} list${r.created === 1 ? '' : 's'} found` : 'Linked')
    } catch (err) {
      setError(err.message)
    } finally { setBusy(false) }
  }

  return (
    <div className="v2-lists-sources">
      {sources.length > 0 && (
        <ul className="v2-lists-source-rows">
          {sources.map(s => (
            <li key={s.id} className="v2-lists-source-row">
              <div className="v2-lists-index-main">
                <strong>{s.name || s.trello_id}</strong>
                <span>
                  {s.scope === 'column' ? 'Whole column' : 'Whole card'}
                  {' · '}{s.list_count} list{s.list_count === 1 ? '' : 's'}
                  {' · checked '}{fmtWhen(s.last_expanded_at)}
                </span>
              </div>
              <button
                className="v2-lists-icon-btn"
                title="Check for new lists now"
                disabled={busy}
                onClick={async () => {
                  setBusy(true); setMsg(null); setError(null)
                  try {
                    const r = await onExpand(s.id)
                    setMsg(r.created ? `${r.created} new list${r.created === 1 ? '' : 's'}` : 'Nothing new')
                  } catch (err) { setError(err.message) } finally { setBusy(false) }
                }}
              >
                <RefreshCw size={15} strokeWidth={2} />
              </button>
              <button
                className="v2-lists-icon-btn"
                title="Unlink (keeps the lists)"
                disabled={busy}
                onClick={async () => {
                  setBusy(true)
                  try { await onRemoveSource(s.id) } finally { setBusy(false) }
                }}
              >
                <X size={15} strokeWidth={2} />
              </button>
              {s.last_expand_error && (
                <AlertTriangle size={14} strokeWidth={2} className="v2-lists-index-warn" title={s.last_expand_error} />
              )}
            </li>
          ))}
        </ul>
      )}

      {sources.length > 0 && (
        <p className="v2-lists-link-note">
          Unlinking only stops the auto-discovery. Every list stays, with its items.
        </p>
      )}

      <div className="v2-lists-link-picker">
        <select className="v2-form-input" value={boardId} onChange={e => pickBoard(e.target.value)} disabled={busy}>
          <option value="">Board…</option>
          {(boards || []).map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>

        {boardId && (
          <div className="v2-lists-link-step">
            <select className="v2-form-input" value={colId} onChange={e => pickCol(e.target.value)} disabled={busy}>
              <option value="">Column…</option>
              {(cols || []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            {colId && (
              // Column scope is offered but not defaulted: a new list inside a
              // column-linked column would mean creating a CARD on her board,
              // which shows up in her board view. Card scope is the quieter
              // choice, so it is the one presented per-card below.
              <button
                className="v2-lists-link-whole"
                disabled={busy}
                onClick={() => link('column', colId, (cols || []).find(c => c.id === colId)?.name)}
              >
                Link this whole column — every card in it
              </button>
            )}
          </div>
        )}

        {colId && (
          <ul className="v2-lists-card-rows">
            {(cards || []).map(c => (
              <li key={c.id}>
                <button
                  className="v2-lists-card-row"
                  disabled={busy}
                  onClick={() => link('card', c.id, c.name)}
                >
                  <Link2 size={14} strokeWidth={2} />
                  <span>{c.name}</span>
                </button>
              </li>
            ))}
            {cards && !cards.length && <li className="v2-lists-loading">No cards in that column.</li>}
          </ul>
        )}
      </div>

      {msg && <div className="v2-lists-msg" onClick={() => setMsg(null)}>{msg}</div>}
      {error && (
        <div className="v2-lists-link-warn">
          <AlertTriangle size={14} strokeWidth={2} /><span>{error}</span>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------
export default function ListsModal({
  open, onClose, lists, sources = [], loading,
  onAdd, onEdit, onDelete, onReorder, onAddSource, onExpandSource, onRemoveSource,
}) {
  const [openId, setOpenId] = useState(null)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const [sortMode, setSortMode] = useState(loadSortMode)
  const [dragId, setDragId] = useState(null)
  const [dropId, setDropId] = useState(null)
  const [showSources, setShowSources] = useState(false)
  const [sourceBusy, setSourceBusy] = useState(false)

  const current = lists.find(l => l.id === openId) || null

  const setSort = (mode) => {
    setSortMode(mode)
    safeSetItem(SORT_KEY, mode)
  }

  // The server already returns lists in `sort_order, name` order, so 'manual'
  // is simply "don't re-sort". The other two are pure derivations of what is
  // already in memory — nothing here mutates a list.
  const sorted = useMemo(() => {
    if (sortMode === 'name') {
      return [...lists].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
    }
    if (sortMode === 'recent') {
      // Newest first. A list that has never synced and has no items sorts last
      // rather than first — an empty string would win a descending compare.
      return [...lists].sort((a, b) => (b.last_activity_at || '').localeCompare(a.last_activity_at || ''))
    }
    return lists
  }, [lists, sortMode])

  // Group by CARD — the level the structure is actually organised at ("2026
  // Groceries" holding Grocery/Target/Walmart, sibling to "Costco"). The
  // column name rides along as a caption when there is one.
  //
  // Orphans get their own trailing group rather than an inline badge: their
  // checklist is gone from Trello, they still hold items, and the decision
  // (delete, or relink) is one a person has to make. Mixed in among working
  // lists they are easy to miss, which is how a list quietly stops mattering.
  const groups = useMemo(() => {
    const live = sorted.filter(l => !l.orphaned_at)
    const orphans = sorted.filter(l => l.orphaned_at)
    const byCard = new Map()
    const loose = []

    for (const l of live) {
      if (!l.trello_card_id || !l.trello_card_name) { loose.push(l); continue }
      if (!byCard.has(l.trello_card_id)) {
        byCard.set(l.trello_card_id, {
          key: l.trello_card_id,
          cardName: l.trello_card_name,
          columnName: l.trello_column_name || '',
          lists: [],
        })
      }
      byCard.get(l.trello_card_id).lists.push(l)
    }

    const out = [...byCard.values()]
    // A card holding exactly one checklist is not a group worth a heading —
    // it is just a list. Flattening those keeps the common case (one card,
    // one checklist) looking exactly as it did before nesting existed.
    const realGroups = out.filter(g => g.lists.length > 1)
    const singletons = out.filter(g => g.lists.length === 1).flatMap(g => g.lists)

    if (loose.length || singletons.length) {
      realGroups.push({ key: '__loose__', cardName: '', columnName: '', lists: [...singletons, ...loose] })
    }
    if (orphans.length) {
      realGroups.push({ key: '__orphans__', cardName: 'No longer on Trello', columnName: '', lists: orphans, orphaned: true })
    }
    return realGroups
  }, [sorted])

  const canDrag = sortMode === 'manual' && sorted.length > 1

  // Drop BEFORE the row being hovered, and only WITHIN a group. Dragging a
  // list into another card's group would mean moving her checklist to a
  // different card on Trello — a structural write to someone else's board that
  // expansion deliberately never makes. Refusing the cross-group drop is
  // honest; doing it locally would silently diverge from Trello instead.
  const handleDrop = async (targetId) => {
    const from = sorted.findIndex(l => l.id === dragId)
    const to = sorted.findIndex(l => l.id === targetId)
    setDragId(null); setDropId(null)
    if (from < 0 || to < 0 || from === to) return
    const g = (id) => groups.find(gr => gr.lists.some(l => l.id === id))?.key
    if (g(dragId) !== g(targetId)) return
    const next = [...sorted]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    try { await onReorder(next.map(l => l.id)) } catch { /* hook reloads + logs */ }
  }

  const create = async (e) => {
    e.preventDefault()
    const name = newName.trim()
    if (!name || creating) return
    setCreating(true)
    try {
      const list = await onAdd({ name })
      setNewName('')
      setOpenId(list.id) // straight into the new list; linking happens there
    } finally { setCreating(false) }
  }

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      title="Lists"
      subtitle={current ? undefined : 'Shared lists, synced with Trello'}
      width="narrow"
    >
      {current ? (
        <ListDetail
          list={current}
          onBack={() => setOpenId(null)}
          onEditList={onEdit}
          onDeleteList={async (id) => { await onDelete(id); setOpenId(null) }}
        />
      ) : (
        <div className="v2-lists-index">
          <form className="v2-lists-add" onSubmit={create}>
            <input
              className="v2-lists-add-input"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder="New list name"
              disabled={creating}
            />
            <button className="v2-lists-add-btn" type="submit" disabled={creating || !newName.trim()}>
              <Plus size={16} strokeWidth={2} />
            </button>
          </form>

          <button
            className="v2-lists-sources-toggle"
            onClick={() => setShowSources(s => !s)}
            aria-expanded={showSources}
          >
            <Link2 size={14} strokeWidth={2} />
            <span>
              {sources.length
                ? `Linked from Trello · ${sources.length}`
                : 'Link a Trello card or column'}
            </span>
            <ChevronRight size={15} strokeWidth={2} className={showSources ? 'v2-lists-chev-open' : ''} />
          </button>

          {showSources && (
            <SourcesPanel
              sources={sources}
              onAddSource={onAddSource}
              onExpand={onExpandSource}
              onRemoveSource={onRemoveSource}
              busy={sourceBusy}
              setBusy={setSourceBusy}
            />
          )}

          {loading && !lists.length ? (
            <p className="v2-lists-loading">Loading…</p>
          ) : !lists.length ? (
            <EmptyState
              icon={ShoppingCart}
              title="No lists yet"
              body="Make one above, or link a Trello card and every checklist on it becomes a list."
            />
          ) : (
            <>
              {/* Only worth the room once there is something to order. */}
              {lists.length > 1 && (
                <div className="v2-lists-sort" role="radiogroup" aria-label="Sort lists">
                  {SORT_MODES.map(m => (
                    <button
                      key={m.value}
                      type="button"
                      className={`v2-lists-sort-btn${sortMode === m.value ? ' v2-lists-sort-btn-active' : ''}`}
                      onClick={() => setSort(m.value)}
                      aria-pressed={sortMode === m.value}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              )}

              {groups.map(g => (
                <section key={g.key} className="v2-lists-group">
                  {g.cardName && (
                    <div className={`v2-lists-group-head${g.orphaned ? ' v2-lists-group-head-warn' : ''}`}>
                      <span className="v2-lists-group-name">{g.cardName}</span>
                      {g.columnName && <span className="v2-lists-group-col">{g.columnName}</span>}
                    </div>
                  )}
                  {g.orphaned && (
                    <p className="v2-lists-group-note">
                      The Trello checklist behind {g.lists.length === 1 ? 'this list' : 'these lists'} is gone.
                      Nothing was deleted here — your items are still below.
                    </p>
                  )}
                  <ul className="v2-lists-index-rows">
                    {g.lists.map(l => (
                      <li
                        key={l.id}
                        className={`${dragId === l.id ? 'v2-lists-dragging' : ''}${dropId === l.id ? ' v2-lists-dropinto' : ''}`}
                        onDragOver={canDrag ? (e) => { e.preventDefault(); setDropId(l.id) } : undefined}
                        onDrop={canDrag ? (e) => { e.preventDefault(); handleDrop(l.id) } : undefined}
                      >
                        <button className="v2-lists-index-row" onClick={() => setOpenId(l.id)}>
                          {canDrag && (
                            // The handle is the only draggable element. Making
                            // the whole row draggable would fight the tap that
                            // opens the list — on touch especially, every press
                            // would be a candidate drag.
                            <span
                              className="v2-lists-grip"
                              draggable
                              onDragStart={(e) => { e.stopPropagation(); setDragId(l.id) }}
                              onDragEnd={() => { setDragId(null); setDropId(null) }}
                              onClick={(e) => { e.preventDefault(); e.stopPropagation() }}
                              aria-hidden="true"
                            >
                              <GripVertical size={14} strokeWidth={2} />
                            </span>
                          )}
                          <div className="v2-lists-index-main">
                            <strong>{l.name}</strong>
                            <span>
                              {l.unchecked_count} to get
                              {l.orphaned_at
                                ? ' · not on Trello anymore'
                                : l.trello_card_id ? ` · synced ${fmtWhen(l.last_synced_at)}` : ' · not shared'}
                            </span>
                          </div>
                          {l.last_sync_error && <AlertTriangle size={14} strokeWidth={2} className="v2-lists-index-warn" />}
                          <ChevronRight size={16} strokeWidth={2} />
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </>
          )}
        </div>
      )}
    </ModalShell>
  )
}
