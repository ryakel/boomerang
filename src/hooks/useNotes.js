import { useState, useCallback, useEffect } from 'react'
import { fetchNotes, createNoteApi, updateNoteApi, deleteNoteApi } from '../api'

// Notes — free-floating notes with no task semantics (no due date, no status,
// no nagging, no points). Server is the source of truth via dedicated
// /api/notes endpoints; AppV2 calls reload() from hydrateFromServer so a note
// left on another device shows up on the next sync round-trip, same freshness
// tier as everything else.
export function useNotes() {
  const [notes, setNotes] = useState([])
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    try {
      const data = await fetchNotes()
      setNotes(data)
    } catch (err) {
      console.error('[Notes] Load failed:', err)
      // Keep current state on failure — a flaky fetch shouldn't blank the list.
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { reload() }, [reload])

  const addNote = useCallback(async ({ body, pinned = false }) => {
    const note = await createNoteApi({ body, pinned })
    // Server list order is pinned-first then updated_at desc — mirror it.
    setNotes(prev => {
      const next = [note, ...prev.filter(n => n.id !== note.id)]
      return next.sort((a, b) => (b.pinned - a.pinned) || (a.updated_at < b.updated_at ? 1 : -1))
    })
    return note
  }, [])

  const editNote = useCallback(async (id, updates) => {
    const note = await updateNoteApi(id, updates)
    setNotes(prev => prev.map(n => (n.id === id ? note : n))
      .sort((a, b) => (b.pinned - a.pinned) || (a.updated_at < b.updated_at ? 1 : -1)))
    return note
  }, [])

  const removeNote = useCallback(async (id) => {
    await deleteNoteApi(id)
    setNotes(prev => prev.filter(n => n.id !== id))
  }, [])

  return { notes, loading, reload, addNote, editNote, removeNote }
}
