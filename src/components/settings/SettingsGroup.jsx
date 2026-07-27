import './settings.css'

// A group of rows under an optional caption (§5).
//
// GROUPS NEVER COLLAPSE. This replaces `SettingsSection`, which collapsed by
// default and hid one-word values behind a tap. Pages are kept short by the
// navigation model instead — a page with ~10 rows in 2–3 groups doesn't need
// folding, and every redesigned page comes in under that.
//
// A caption is earned, not automatic: a page with only one group shows its
// rows bare, because the page title already names them. The caption is also
// non-interactive by design — the uppercase treatment used to be the tappable
// row label, which is precisely how the hierarchy ended up inverted.
export default function SettingsGroup({ caption, children }) {
  return (
    <section className="v2-set-group">
      {caption && <h3 className="v2-set-group-caption">{caption}</h3>}
      <div className="v2-set-group-rows">{children}</div>
    </section>
  )
}
