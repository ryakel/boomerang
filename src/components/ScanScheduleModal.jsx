import { useRef, useState } from 'react'
import { Camera, Image as ImageIcon, FileText, ArrowLeft } from 'lucide-react'
import { scanSchedule } from '../api'
import { localYMD } from '../store'
import { processAttachment } from '../utils/imageCompress'
import { entryToTask } from '../scheduleScan'
import ModalShell from './ModalShell'
import './MarkdownImportModal.css'
import './ScanScheduleModal.css'

function fmtDay(ymd) {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}

// Scan a schedule: photo / image / PDF → Claude vision → a preview the user
// edits and ticks → tasks. Nothing is created until Import (see
// src/scheduleScan.js for why that keeps it out of the Review section).
export default function ScanScheduleModal({ open, onImport, onClose }) {
  const [entries, setEntries] = useState(null)
  const [selected, setSelected] = useState(new Set())
  const [remind, setRemind] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState('')
  const cameraRef = useRef(null)
  const imageRef = useRef(null)
  const pdfRef = useRef(null)

  const reset = () => {
    setEntries(null); setSelected(new Set()); setRemind(false); setScanning(false); setError('')
  }
  const handleClose = () => { reset(); onClose() }

  const handleFile = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setScanning(true); setError('')
    try {
      const att = await processAttachment(file)
      const found = await scanSchedule(att, localYMD())
      setEntries(found)
      setSelected(new Set(found.map((x, i) => (x.past ? null : i)).filter(i => i !== null)))
    } catch (err) {
      setError(err.message || 'Scan failed')
    } finally {
      setScanning(false)
    }
  }

  const toggle = (i) => setSelected(prev => {
    const next = new Set(prev)
    if (next.has(i)) next.delete(i); else next.add(i)
    return next
  })
  const rename = (i, title) => setEntries(prev => prev.map((x, j) => (j === i ? { ...x, title } : x)))

  const handleImport = () => {
    const tasks = entries
      .filter((x, i) => selected.has(i) && x.title.trim())
      .map(x => entryToTask({ ...x, title: x.title.trim() }, { remind }))
    onImport(tasks)
    handleClose()
  }

  const hasTimes = entries?.some(x => x.start)

  return (
    <ModalShell open={open} onClose={handleClose} title="Scan schedule" width="narrow">
      {!entries ? (
        <div className="v2-md-import">
          <div className="v2-scan-hero">
            <strong>Point it at your week</strong>
            <span>
              A class timetable, a shift rota, a screenshot of another calendar or the PDF the school sent.
              The file is sent to your AI provider to read it; you pick what becomes a task.
            </span>
          </div>
          {error && <div className="v2-form-error">{error}</div>}
          {scanning ? (
            <div className="v2-scan-busy"><span className="v2-spinner" /> Reading your schedule…</div>
          ) : (
            <div className="v2-scan-actions">
              <button className="v2-md-import-primary" onClick={() => cameraRef.current?.click()}>
                <Camera size={14} strokeWidth={1.75} /> Take a photo
              </button>
              <div className="v2-scan-secondary">
                <button className="v2-settings-btn" onClick={() => imageRef.current?.click()}>
                  <ImageIcon size={13} strokeWidth={1.75} /> Choose an image
                </button>
                <button className="v2-settings-btn" onClick={() => pdfRef.current?.click()}>
                  <FileText size={13} strokeWidth={1.75} /> Choose a PDF
                </button>
              </div>
            </div>
          )}
          <input ref={cameraRef} type="file" accept="image/*" capture="environment" onChange={handleFile} style={{ display: 'none' }} />
          <input ref={imageRef} type="file" accept="image/*" onChange={handleFile} style={{ display: 'none' }} />
          <input ref={pdfRef} type="file" accept="application/pdf" onChange={handleFile} style={{ display: 'none' }} />
        </div>
      ) : (
        <div className="v2-md-import">
          <div className="v2-md-import-summary">
            <span>{entries.length} entr{entries.length === 1 ? 'y' : 'ies'} found · {selected.size} selected</span>
            <span className="v2-md-import-summary-actions">
              <button onClick={() => setSelected(new Set(entries.map((_, i) => i)))}>All</button>
              <span className="v2-md-import-summary-sep">/</span>
              <button onClick={() => setSelected(new Set())}>None</button>
            </span>
          </div>
          <div className="v2-md-import-list-wrap">
            {entries.length === 0 ? (
              <div className="v2-md-import-empty">Couldn't find anything schedule-shaped in that file. Try a sharper or closer shot.</div>
            ) : (
              <ul className="v2-md-import-list">
                {entries.map((x, i) => (
                  <li key={i} className={`v2-md-import-item${x.past ? ' v2-scan-past' : ''}`}>
                    <label>
                      <input type="checkbox" checked={selected.has(i)} onChange={() => toggle(i)} />
                      <span className="v2-md-import-text">
                        <input
                          className="v2-scan-title"
                          value={x.title}
                          onChange={e => rename(i, e.target.value)}
                          onClick={e => e.preventDefault()}
                          aria-label="Task title"
                        />
                        <span className="v2-scan-meta">
                          {fmtDay(x.date)}
                          {x.start && ` · ${x.start}${x.end ? `–${x.end}` : ''}`}
                          {x.location && ` · ${x.location}`}
                          {x.past && ' · already passed'}
                        </span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {hasTimes && (
            <label className="v2-scan-remind">
              <input type="checkbox" checked={remind} onChange={e => setRemind(e.target.checked)} />
              Remind me at each start time
            </label>
          )}
          <div className="v2-md-import-actions">
            <button className="v2-settings-btn" onClick={() => { setEntries(null); setSelected(new Set()) }}>
              <ArrowLeft size={13} strokeWidth={1.75} /> Rescan
            </button>
            <button className="v2-md-import-primary" onClick={handleImport} disabled={selected.size === 0}>
              Add {selected.size} task{selected.size !== 1 ? 's' : ''}
            </button>
          </div>
        </div>
      )}
    </ModalShell>
  )
}
