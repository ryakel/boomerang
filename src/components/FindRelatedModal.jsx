import { useState, useEffect } from 'react'
import { suggestNotionLink, generateNotionContent, notionCreatePage } from '../api'

export default function FindRelatedModal({ task, onLink, onClose }) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)
  const [creating, setCreating] = useState(false)

  const doSearch = () => {
    setLoading(true)
    setError(null)
    suggestNotionLink(task.title, task.notes)
      .then(data => {
        setResult(data)
        setLoading(false)
      })
      .catch(err => {
        setError(err.message || 'Search failed')
        setLoading(false)
      })
  }

  useEffect(() => {
    doSearch()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleCreateNew = async () => {
    setCreating(true)
    try {
      const content = await generateNotionContent(task.title, task.notes)
      const page = await notionCreatePage(task.title, content)
      onLink(task.id, page)
      onClose()
    } catch (err) {
      setError(err.message || 'Failed to create page')
      setCreating(false)
    }
  }

  const handleSelectPage = (page) => {
    onLink(task.id, page)
    onClose()
  }

  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div className="sheet" onClick={e => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="sheet-title">Find Related</div>
        <div className="sheet-subtitle">Searching Notion for pages related to &ldquo;{task.title}&rdquo;</div>

        {loading && (
          <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--text-muted)', fontSize: 14 }}>
            <span className="spinner" />
            Searching Notion...
          </div>
        )}

        {error && (
          <div style={{ textAlign: 'center', padding: '24px 0' }}>
            <div style={{ color: '#FF3B30', fontSize: 14, marginBottom: 12 }}>{error}</div>
            <button className="submit-btn" onClick={doSearch}>Retry</button>
          </div>
        )}

        {!loading && !error && result && (
          <>
            {result.reason && (
              <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16, lineHeight: 1.5 }}>
                {result.reason}
              </div>
            )}

            {result.pages && result.pages.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                {result.pages.map(page => (
                  <button
                    key={page.id}
                    className="related-result"
                    onClick={() => handleSelectPage(page)}
                  >
                    {page.title}
                  </button>
                ))}
              </div>
            )}

            <button
              className="submit-btn"
              onClick={handleCreateNew}
              disabled={creating}
              style={{ marginTop: 8 }}
            >
              {creating ? <><span className="spinner" />Creating...</> : 'Create new page'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
