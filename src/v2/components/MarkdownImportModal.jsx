import { useCallback, useRef, useState } from 'react'
import { Upload, ArrowLeft } from 'lucide-react'
import { parseMarkdown } from '../../utils/markdownImport'
import ModalShell from './ModalShell'
import './MarkdownImportModal.css'

// v2 markdown import. Paste markdown OR upload a .md/.txt file → preview the
// parsed task list → toggle which tasks to import → Import.
export default function MarkdownImportModal({ open, onImport, onClose }) {
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

  const selectAll = () => setSelected(new Set(parsed.map((_, i) => i)))
  const selectNone = () => setSelected(new Set())

  const handleClose = () => {
    setText('')
    setParsed(null)
    setSelected(new Set())
    onClose()
  }

  const handleImport = () => {
    if (!parsed) return
    const tasksToImport = parsed.filter((_, i) => selected.has(i))
    onImport(tasksToImport)
    handleClose()
  }

  return (
    <ModalShell open={open} onClose={handleClose} title="Import from Markdown" terminalTitle="$ import --markdown" width="wide">
      {!parsed ? (
        <div className="v2-md-import">
          <div className="v2-md-import-hint">
            Paste markdown below or upload a file. Bullet lists (<code>- item</code>) and checkboxes (<code>- [ ] item</code>) both work; section headings (<code>## Section</code>) become group labels.
          </div>
          <textarea
            className="v2-form-textarea v2-md-import-textarea"
            placeholder={'Paste markdown here…\n\n- [ ] Task one\n- [ ] Task two\n- Another task\n\n## Section\n- Task in section'}
            value={text}
            onChange={e => setText(e.target.value)}
            autoFocus
          />
          <div className="v2-md-import-actions">
            <button
              className="v2-md-import-primary"
              onClick={handleParse}
              disabled={!text.trim()}
            >
              Preview tasks
            </button>
            <button
              className="v2-settings-btn"
              onClick={() => fileRef.current?.click()}
            >
              <Upload size={13} strokeWidth={1.75} /> Upload .md
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".md,.txt,.markdown"
              onChange={handleFileUpload}
              style={{ display: 'none' }}
            />
          </div>
        </div>
      ) : (
        <div className="v2-md-import">
          <div className="v2-md-import-summary">
            <span>
              {parsed.length} task{parsed.length !== 1 ? 's' : ''} found · {selected.size} selected
            </span>
            <span className="v2-md-import-summary-actions">
              <button onClick={selectAll}>All</button>
              <span className="v2-md-import-summary-sep">/</span>
              <button onClick={selectNone}>None</button>
            </span>
          </div>
          <div className="v2-md-import-list-wrap">
            {parsed.length === 0 ? (
              <div className="v2-md-import-empty">
                No tasks found. Use checkboxes (<code>- [ ]</code>) or bullets (<code>- item</code>).
              </div>
            ) : (
              <ul className="v2-md-import-list">
                {parsed.map((task, i) => (
                  <li key={i} className="v2-md-import-item">
                    <label>
                      <input
                        type="checkbox"
                        checked={selected.has(i)}
                        onChange={() => toggleTask(i)}
                      />
                      <span className="v2-md-import-text">
                        <span className="v2-md-import-title">{task.title}</span>
                        {task.group && (
                          <span className="v2-md-import-group">{task.group}</span>
                        )}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="v2-md-import-actions">
            <button
              className="v2-settings-btn"
              onClick={() => { setParsed(null); setSelected(new Set()) }}
            >
              <ArrowLeft size={13} strokeWidth={1.75} /> Back
            </button>
            <button
              className="v2-md-import-primary"
              onClick={handleImport}
              disabled={selected.size === 0}
            >
              Import {selected.size} task{selected.size !== 1 ? 's' : ''}
            </button>
          </div>
        </div>
      )}
    </ModalShell>
  )
}
