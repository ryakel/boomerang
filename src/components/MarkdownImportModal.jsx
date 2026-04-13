import { useState, useRef, useCallback } from 'react'
import { parseMarkdown } from '../utils/markdownImport'

export default function MarkdownImportModal({ onImport, onClose }) {
  const [text, setText] = useState('')
  const [parsed, setParsed] = useState(null)
  const [selected, setSelected] = useState(new Set())
  const fileRef = useRef(null)

  const handleParse = useCallback(() => {
    const tasks = parseMarkdown(text)
    setParsed(tasks)
    setSelected(new Set(tasks.map((_, i) => i)))
  }, [text])

  const handleFileUpload = useCallback((e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const content = ev.target.result
      setText(content)
      const tasks = parseMarkdown(content)
      setParsed(tasks)
      setSelected(new Set(tasks.map((_, i) => i)))
    }
    reader.readAsText(file)
  }, [])

  const toggleTask = (index) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  const handleImport = () => {
    if (!parsed) return
    const tasksToImport = parsed.filter((_, i) => selected.has(i))
    onImport(tasksToImport)
    onClose()
  }

  const selectAll = () => setSelected(new Set(parsed.map((_, i) => i)))
  const selectNone = () => setSelected(new Set())

  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div className="sheet" onClick={e => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <button className="modal-close-btn" onClick={onClose} aria-label="Close">✕</button>
        <div className="sheet-title">Import from Markdown</div>

        {!parsed ? (
          <>
            <textarea
              className="add-input"
              placeholder={'Paste markdown here...\n\n- [ ] Task one\n- [ ] Task two\n- Another task\n\n## Section\n- Task in section'}
              value={text}
              onChange={e => setText(e.target.value)}
              rows={12}
              style={{ width: '100%', resize: 'vertical', fontFamily: 'monospace', fontSize: 13 }}
              autoFocus
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button
                className="add-btn"
                onClick={handleParse}
                disabled={!text.trim()}
                style={{ flex: 1 }}
              >
                Preview Tasks
              </button>
              <button
                className="add-btn"
                onClick={() => fileRef.current?.click()}
                style={{ flex: 0, whiteSpace: 'nowrap', background: 'var(--surface-hover)', color: 'var(--text-primary)' }}
              >
                Upload .md
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".md,.txt,.markdown"
                onChange={handleFileUpload}
                style={{ display: 'none' }}
              />
            </div>
          </>
        ) : (
          <>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 8 }}>
              {parsed.length} task{parsed.length !== 1 ? 's' : ''} found — {selected.size} selected
              <span style={{ float: 'right' }}>
                <button onClick={selectAll} style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 13 }}>All</button>
                {' / '}
                <button onClick={selectNone} style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 13 }}>None</button>
              </span>
            </div>
            <div style={{ maxHeight: '50vh', overflowY: 'auto' }}>
              {parsed.length === 0 ? (
                <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-dim)' }}>
                  No tasks found. Use checkboxes (<code>- [ ]</code>) or bullet lists (<code>- item</code>).
                </div>
              ) : parsed.map((task, i) => (
                <label
                  key={i}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '8px 4px',
                    borderBottom: '1px solid var(--border)', cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selected.has(i)}
                    onChange={() => toggleTask(i)}
                    style={{ width: 18, height: 18 }}
                  />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14 }}>{task.title}</div>
                    {task.group && (
                      <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>{task.group}</div>
                    )}
                  </div>
                </label>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button
                className="add-btn"
                onClick={() => { setParsed(null); setSelected(new Set()) }}
                style={{ flex: 0, background: 'var(--surface-hover)', color: 'var(--text-primary)' }}
              >
                Back
              </button>
              <button
                className="add-btn"
                onClick={handleImport}
                disabled={selected.size === 0}
                style={{ flex: 1 }}
              >
                Import {selected.size} Task{selected.size !== 1 ? 's' : ''}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
