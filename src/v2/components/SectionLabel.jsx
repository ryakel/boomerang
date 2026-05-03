import './SectionLabel.css'

export default function SectionLabel({ children, count }) {
  return (
    <div className="v2-section-label">
      <span className="v2-section-label-bullet" aria-hidden="true">✦</span>
      <span className="v2-section-label-text">{children}</span>
      {typeof count === 'number' && count > 0 && (
        <span className="v2-section-label-count">{count}</span>
      )}
    </div>
  )
}
