// The settings toggle switch, in its permanent home.
//
// An identical copy currently lives inside SettingsModal.jsx — it was itself
// created to stop ~10 hand-copied duplicates across the panels. This is the
// canonical one for the new row family; the SettingsModal copy is deleted in
// the teardown PR once every panel has converted. Markup and class names are
// unchanged so the existing CSS in SettingsModal.css keeps applying.
export default function Toggle({ checked, onChange, disabled }) {
  return (
    <label className={`v2-settings-toggle${disabled ? ' v2-settings-toggle-disabled' : ''}`}>
      <input type="checkbox" checked={!!checked} onChange={onChange} disabled={disabled} />
      <span className="v2-settings-toggle-track"><span className="v2-settings-toggle-thumb" /></span>
    </label>
  )
}
