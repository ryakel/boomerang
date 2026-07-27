import { useState, useEffect, useCallback } from 'react'
import {
  ShoppingCart, Plus, Trash2, ChevronRight, ArrowLeft, RefreshCw,
  Link2, AlertTriangle, Check, X,
} from 'lucide-react'
import ModalShell from './ModalShell'
import EmptyState from './EmptyState'
import { useListItems } from '../hooks/useLists'
import {
  fetchTrelloBoards, fetchTrelloBoardLists, fetchTrelloListCards, fetchTrelloCardChecklists,
} from '../api'
import './ListsModal.css'

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
    setCardId(id); setChecklists(null)
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

  return (
    <div className="v2-lists-link">
      <p className="v2-lists-link-intro">Pick the Trello card whose checklist this list should mirror.</p>
      {error && <div className="v2-lists-link-warn"><AlertTriangle size={14} strokeWidth={2} /><span>{error}</span></div>}

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
function ListDetail({ list, onBack, onEditList, onDeleteList }) {
  const { items, loading, error, addItems, toggleItem, removeItem, syncNow, reload } = useListItems(list.id)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
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
          <ul className="v2-lists-items">
            {remaining.map(item => (
              <li key={item.id} className="v2-lists-item">
                <button className="v2-lists-check" onClick={() => toggleItem(item.id, true)} title="Got it">
                  <span className="v2-lists-box" />
                </button>
                <span className="v2-lists-item-name">{item.name}</span>
                <button className="v2-lists-icon-btn v2-lists-item-del" onClick={() => removeItem(item.id)} title="Remove">
                  <X size={14} strokeWidth={2} />
                </button>
              </li>
            ))}
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
export default function ListsModal({ open, onClose, lists, loading, onAdd, onEdit, onDelete }) {
  const [openId, setOpenId] = useState(null)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)

  const current = lists.find(l => l.id === openId) || null

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

          {loading && !lists.length ? (
            <p className="v2-lists-loading">Loading…</p>
          ) : !lists.length ? (
            <EmptyState
              icon={ShoppingCart}
              title="No lists yet"
              body="Make one above, then link it to a Trello card to share it."
            />
          ) : (
            <ul className="v2-lists-index-rows">
              {lists.map(l => (
                <li key={l.id}>
                  <button className="v2-lists-index-row" onClick={() => setOpenId(l.id)}>
                    <div className="v2-lists-index-main">
                      <strong>{l.name}</strong>
                      <span>
                        {l.unchecked_count} to get
                        {l.trello_card_id ? ` · synced ${fmtWhen(l.last_synced_at)}` : ' · not shared'}
                      </span>
                    </div>
                    {l.last_sync_error && <AlertTriangle size={14} strokeWidth={2} className="v2-lists-index-warn" />}
                    <ChevronRight size={16} strokeWidth={2} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </ModalShell>
  )
}
