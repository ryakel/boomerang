// Shared toggle switch — was locally defined inside NotificationsPanel and
// hand-copied at ~10 other call sites across IntegrationsPanel/General, then
// lifted out of SettingsModal so the calendar-rules editor could use it too.
// One definition so a future visual tweak doesn't need a find-and-replace.
export default function Toggle({ checked, onChange, disabled }) {
  return (
    <label className={`v2-settings-toggle${disabled ? ' v2-settings-toggle-disabled' : ''}`}>
      <input type="checkbox" checked={!!checked} onChange={onChange} disabled={disabled} />
      <span className="v2-settings-toggle-track"><span className="v2-settings-toggle-thumb" /></span>
    </label>
  )
}
