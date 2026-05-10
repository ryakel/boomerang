import './EmptyState.css'

export default function EmptyState({ icon: Icon, title, body, cta, ctaOnClick }) {
  return (
    <div className="v2-empty">
      {Icon && (
        <div className="v2-empty-icon">
          <Icon size={28} strokeWidth={1.5} />
        </div>
      )}
      <h2 className="v2-empty-title">{title}</h2>
      {body && <p className="v2-empty-body">{body}</p>}
      {cta && (
        <button className="v2-empty-cta" onClick={ctaOnClick}>
          {cta}
        </button>
      )}
    </div>
  )
}
