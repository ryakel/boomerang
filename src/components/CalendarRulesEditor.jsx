import { useCallback, useEffect, useState } from 'react'
import Toggle from './Toggle'
import { gcalListRules, gcalSaveRule, gcalDeleteRule, gcalPreviewRule, gcalApplyRule } from '../api'

// "When an event like this shows up, make me this task."
//
// The task a rule creates is work the event IMPLIES, not the event itself —
// the flight means the budget spreadsheet needs updating. Everything that
// decides whether a rule matches lives on the server (calendarRules.js); this
// is the editor, plus the tester that shows what a rule would do before it is
// allowed to do anything.

const FIELDS = [
  { value: 'title', label: 'Title' },
  { value: 'location', label: 'Location' },
  { value: 'description', label: 'Description' },
  { value: 'attendees', label: 'Attendees' },
  { value: 'organizer', label: 'Organizer' },
  { value: 'timing', label: 'Timing' },
]

const OPS = [
  { value: 'contains', label: 'contains' },
  { value: 'not_contains', label: "doesn't contain" },
  { value: 'equals', label: 'is exactly' },
  { value: 'matches', label: 'matches regex' },
]

const SIZES = ['XS', 'S', 'M', 'L', 'XL']

const emptyRule = () => ({
  name: '',
  enabled: true,
  conditions: [{ field: 'title', op: 'contains', value: '' }],
  template: { title: '', notes: '', due_offset_days: 0, tags: [], size: null, high_priority: false, nag_allowed: false },
  suppress_event_import: false,
  future_only: false,
})

function describeCondition(c) {
  const field = FIELDS.find(f => f.value === c.field)?.label || c.field
  if (c.field === 'timing') return `${field} is ${c.value === 'all_day' ? 'all-day' : 'timed'}`
  const op = OPS.find(o => o.value === c.op)?.label || c.op
  return `${field} ${op} "${c.value}"`
}

function describeDue(offset) {
  if (offset == null) return 'no due date'
  if (offset === 0) return 'due the day of'
  if (offset === 1) return 'due the day after'
  if (offset === -1) return 'due the day before'
  return offset > 0 ? `due ${offset} days after` : `due ${Math.abs(offset)} days before`
}

export default function CalendarRulesEditor() {
  const [rules, setRules] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [draft, setDraft] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState(null)
  const [notice, setNotice] = useState(null)

  const reload = useCallback(async () => {
    try {
      setRules(await gcalListRules())
      setLoadError(null)
    } catch (err) {
      // Failed and empty must not look the same: with no rules loaded this
      // panel would otherwise read as "you have no rules", and the obvious
      // next move is to create a duplicate of one that already exists.
      setLoadError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { reload() }, [reload])

  const editDraft = (patch) => setDraft(d => ({ ...d, ...patch }))
  const editTemplate = (patch) => setDraft(d => ({ ...d, template: { ...d.template, ...patch } }))
  const editCondition = (i, patch) => setDraft(d => ({
    ...d,
    conditions: d.conditions.map((c, idx) => (idx === i ? { ...c, ...patch } : c)),
  }))

  const openNew = () => { setDraft(emptyRule()); setPreview(null); setError(null); setNotice(null) }
  const openEdit = (rule) => { setDraft(JSON.parse(JSON.stringify(rule))); setPreview(null); setError(null); setNotice(null) }
  const closeDraft = () => { setDraft(null); setPreview(null); setError(null) }

  const handleTest = async () => {
    setBusy(true); setError(null)
    try {
      setPreview(await gcalPreviewRule(draft))
    } catch (err) {
      setError(err.message); setPreview(null)
    } finally {
      setBusy(false)
    }
  }

  const handleSave = async () => {
    setBusy(true); setError(null)
    try {
      const { baselined } = await gcalSaveRule(draft)
      await reload()
      closeDraft()
      // Saying this out loud matters: a rule that silently created nothing
      // reads as broken, when in fact it deliberately left the calendar alone.
      setNotice(baselined > 0
        ? `Saved. ${baselined} event${baselined === 1 ? '' : 's'} already on your calendar match — no tasks were created for them. Use "Apply to existing" if you want them.`
        : 'Saved. It will fire on matching events from now on.')
    } catch (err) {
      // A rule that couldn't be baselined is SAVED and disabled, so the list
      // has to refresh even though this looks like a failure — otherwise the
      // rule is invisible until the panel is reopened, and the obvious next
      // move is to create it a second time.
      await reload()
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const handleDelete = async (rule) => {
    setBusy(true); setError(null)
    try {
      await gcalDeleteRule(rule.id)
      await reload()
      setNotice(`Deleted "${rule.name}". Tasks it already created are untouched.`)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const handleApply = async (rule) => {
    setBusy(true); setError(null)
    try {
      const { created } = await gcalApplyRule(rule.id)
      await reload()
      setNotice(`Created ${created} task${created === 1 ? '' : 's'} from events already on your calendar.`)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const toggleEnabled = async (rule, enabled) => {
    setError(null)
    try {
      await gcalSaveRule({ ...rule, enabled })
      await reload()
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <div className="v2-integrations-sub-settings">
      <div className="v2-integrations-hint">
        Rules turn an event into work it implies. A flight on the calendar can create
        “update the flight budget spreadsheet” — the flight itself stays an event.
      </div>

      {loading && <div className="v2-integrations-hint">Loading rules…</div>}
      {loadError && <div className="v2-integrations-hint">Couldn’t load rules: {loadError}</div>}
      {notice && <div className="v2-integrations-hint">{notice}</div>}
      {error && !draft && <div className="v2-integrations-hint">{error}</div>}

      {!loading && !loadError && rules.length === 0 && !draft && (
        <div className="v2-integrations-hint">No rules yet.</div>
      )}

      {rules.map(rule => (
        <div key={rule.id} className="v2-integrations-rule">
          <div className="v2-integrations-toggle-row">
            <span>{rule.name}</span>
            <Toggle checked={rule.enabled} onChange={e => toggleEnabled(rule, e.target.checked)} />
          </div>
          <div className="v2-integrations-hint">
            {rule.conditions.map(describeCondition).join(' and ')} → “{rule.template.title}”, {describeDue(rule.template.due_offset_days)}
            {rule.future_only ? ' · upcoming events only' : ''}
            {rule.suppress_event_import ? ' · event not imported' : ''}
          </div>
          <div className="v2-integrations-actions">
            <button type="button" className="v2-settings-btn" onClick={() => openEdit(rule)}>Edit</button>
            {rule.baselined > 0 && (
              <button type="button" className="v2-settings-btn" disabled={busy} onClick={() => handleApply(rule)}>
                Apply to {rule.baselined} existing
              </button>
            )}
            <button type="button" className="v2-settings-btn v2-settings-btn-danger" disabled={busy} onClick={() => handleDelete(rule)}>Delete</button>
          </div>
        </div>
      ))}

      {!draft && (
        <button type="button" className="v2-settings-btn" onClick={openNew}>New rule</button>
      )}

      {draft && (
        <div className="v2-integrations-rule">
          <label className="v2-form-label">Rule name</label>
          <input
            className="v2-form-input"
            placeholder="e.g. Flight → update budget"
            value={draft.name}
            onChange={e => editDraft({ name: e.target.value })}
          />

          <label className="v2-form-label">When an event…</label>
          {draft.conditions.map((c, i) => (
            <div key={i} className="v2-integrations-row-compact">
              <select className="v2-form-input v2-settings-compact-input" value={c.field} onChange={e => {
                const field = e.target.value
                // Timing is the one field with its own vocabulary; swapping to
                // it with a stale op/value would only fail at save time.
                editCondition(i, field === 'timing'
                  ? { field, op: 'is', value: 'timed' }
                  : { field, op: c.op === 'is' ? 'contains' : c.op, value: c.field === 'timing' ? '' : c.value })
              }}>
                {FIELDS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>
              {c.field === 'timing' ? (
                <select className="v2-form-input" value={c.value} onChange={e => editCondition(i, { value: e.target.value })}>
                  <option value="timed">is timed</option>
                  <option value="all_day">is all-day</option>
                </select>
              ) : (
                <>
                  <select className="v2-form-input v2-settings-compact-input" value={c.op} onChange={e => editCondition(i, { op: e.target.value })}>
                    {OPS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                  <input
                    className="v2-form-input"
                    placeholder={c.op === 'matches' ? 'N\\d{4}[A-Z]' : 'e.g. N5274S'}
                    value={c.value}
                    onChange={e => editCondition(i, { value: e.target.value })}
                  />
                </>
              )}
              {draft.conditions.length > 1 && (
                <button type="button" className="v2-settings-btn" onClick={() => editDraft({ conditions: draft.conditions.filter((_, idx) => idx !== i) })}>−</button>
              )}
            </div>
          ))}
          <button type="button" className="v2-settings-btn" onClick={() => editDraft({ conditions: [...draft.conditions, { field: 'title', op: 'contains', value: '' }] })}>
            Add condition
          </button>

          <label className="v2-form-label">…create this task</label>
          <input
            className="v2-form-input"
            placeholder="Update the flight budget spreadsheet"
            value={draft.template.title}
            onChange={e => editTemplate({ title: e.target.value })}
          />
          <input
            className="v2-form-input"
            placeholder="Notes (optional) — {{event.title}}, {{event.date}}, {{match.1}}"
            value={draft.template.notes || ''}
            onChange={e => editTemplate({ notes: e.target.value })}
          />
          <div className="v2-integrations-row-compact">
            <label className="v2-integrations-hint">Due (days from event)</label>
            <input
              type="number"
              className="v2-form-input v2-settings-compact-input"
              min={-365}
              max={365}
              value={draft.template.due_offset_days ?? ''}
              onChange={e => editTemplate({ due_offset_days: e.target.value === '' ? null : parseInt(e.target.value, 10) })}
            />
            <label className="v2-integrations-hint">Size</label>
            <select
              className="v2-form-input v2-settings-compact-input"
              value={draft.template.size || ''}
              onChange={e => editTemplate({ size: e.target.value || null })}
            >
              <option value="">—</option>
              {SIZES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <input
            className="v2-form-input"
            placeholder="Tags, comma separated"
            value={(draft.template.tags || []).join(', ')}
            onChange={e => editTemplate({ tags: e.target.value.split(',').map(t => t.trim()).filter(Boolean) })}
          />
          <div className="v2-integrations-toggle-row">
            <span>High priority</span>
            <Toggle checked={draft.template.high_priority} onChange={e => editTemplate({ high_priority: e.target.checked })} />
          </div>
          <div className="v2-integrations-toggle-row">
            <span>Allow reminders to nag</span>
            <Toggle checked={draft.template.nag_allowed} onChange={e => editTemplate({ nag_allowed: e.target.checked })} />
          </div>
          <div className="v2-integrations-toggle-row">
            <span>Only events that haven’t started yet</span>
            <Toggle checked={draft.future_only} onChange={e => editDraft({ future_only: e.target.checked })} />
          </div>
          <div className="v2-integrations-toggle-row">
            <span>Don’t also import the event as its own task</span>
            <Toggle checked={draft.suppress_event_import} onChange={e => editDraft({ suppress_event_import: e.target.checked })} />
          </div>

          {error && <div className="v2-integrations-hint">{error}</div>}

          {preview && (
            <div className="v2-integrations-hint">
              Scanned {preview.scanned} event{preview.scanned === 1 ? '' : 's'} in the next {preview.window_days} days · {preview.matches.length} match{preview.matches.length === 1 ? '' : 'es'}
              {preview.matches.some(m => m.withheld_as_past) && (
                <div>{preview.matches.filter(m => m.withheld_as_past).length} already under way — skipped by “only events that haven’t started yet”</div>
              )}
              {preview.matches.slice(0, 10).map(m => (
                <div key={m.event_id}>
                  · {m.event_title} → “{m.task.title}”{m.task.due_date ? ` (due ${m.task.due_date})` : ''}
                  {m.withheld_as_past ? ' — already under way, skipped' : m.already_fired ? ' — already handled' : ''}
                </div>
              ))}
              {preview.matches.length > 10 && <div>· …and {preview.matches.length - 10} more</div>}
            </div>
          )}

          <div className="v2-integrations-actions">
            <button type="button" className="v2-settings-btn" disabled={busy} onClick={handleTest}>
              {busy ? 'Working…' : 'Test'}
            </button>
            <button type="button" className="v2-settings-btn" disabled={busy} onClick={handleSave}>Save</button>
            <button type="button" className="v2-settings-btn" onClick={closeDraft}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}
