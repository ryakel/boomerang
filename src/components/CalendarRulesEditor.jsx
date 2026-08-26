import { useCallback, useEffect, useMemo, useState } from 'react'
import Toggle from './Toggle'
import { gcalListRules, gcalSaveRule, gcalDeleteRule, gcalPreviewRule, gcalApplyRule, gcalListCalendars } from '../api'
// The same grouping the server matches with — imported rather than reimplemented
// so the sentence shown here can never drift from the one being evaluated.
import { groupConditions } from '../../server/calendarRules.js'

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
  calendar_id: null,
  conditions: [{ field: 'title', op: 'contains', value: '', group: 0 }],
  template: { title: '', notes: '', due_offset_days: 0, tags: [], size: null, high_priority: false, nag_allowed: false },
  suppress_event_import: false,
  future_only: false,
  on_repeat: 'stack',
})

function describeCondition(c) {
  const field = FIELDS.find(f => f.value === c.field)?.label || c.field
  if (c.field === 'timing') return `${field} is ${c.value === 'all_day' ? 'all-day' : 'timed'}`
  const op = OPS.find(o => o.value === c.op)?.label || c.op
  return `${field} ${op} "${c.value}"`
}

// "(Title contains "N5274S" or Title contains "N12345") and Location contains …"
// Parenthesised only where a group holds more than one, so a plain all-ANDed
// rule reads exactly as it always did.
function describeConditions(conditions) {
  return groupConditions(conditions)
    .map(g => (g.length === 1 ? describeCondition(g[0]) : `(${g.map(describeCondition).join(' or ')})`))
    .join(' and ')
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
  const [calendars, setCalendars] = useState([])

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

  // For the per-rule calendar override. Failing quietly is fine here: the
  // select falls back to "the calendar in Settings", which is the default
  // anyway.
  useEffect(() => {
    let cancelled = false
    gcalListCalendars()
      .then(cals => { if (!cancelled) setCalendars(Array.isArray(cals) ? cals : []) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  // Conditions laid out as the matcher sees them: OR within a group, AND
  // across groups. A condition with no group index is its own group — that is
  // what keeps a rule saved before groups existed meaning what it meant.
  const groups = useMemo(() => {
    if (!draft) return []
    const map = new Map()
    draft.conditions.forEach((c, i) => {
      const g = c.group ?? `solo-${i}`
      if (!map.has(g)) map.set(g, [])
      map.get(g).push({ c, i })
    })
    return [...map.entries()]
  }, [draft])

  const editDraft = (patch) => setDraft(d => ({ ...d, ...patch }))
  const editTemplate = (patch) => setDraft(d => ({ ...d, template: { ...d.template, ...patch } }))
  const editCondition = (i, patch) => setDraft(d => ({
    ...d,
    conditions: d.conditions.map((c, idx) => (idx === i ? { ...c, ...patch } : c)),
  }))
  const newCondition = (group) => ({ field: 'title', op: 'contains', value: '', group })
  // Another alternative inside an existing group (an "or").
  const addAlternative = (group) => setDraft(d => ({
    ...d,
    conditions: [...d.conditions, newCondition(group)],
  }))
  // A new group (an "and"). Numbered past every group in play, including the
  // solo keys a legacy rule produces; normalizeRule renumbers densely on save.
  const addGroup = () => setDraft(d => {
    const used = d.conditions.map(c => (typeof c.group === 'number' ? c.group : -1))
    return { ...d, conditions: [...d.conditions, newCondition(Math.max(-1, ...used) + 1)] }
  })
  const removeCondition = (i) => setDraft(d => ({
    ...d,
    conditions: d.conditions.filter((_, idx) => idx !== i),
  }))

  const openNew = () => { setDraft(emptyRule()); setPreview(null); setError(null); setNotice(null) }
  const openEdit = (rule) => {
    const copy = JSON.parse(JSON.stringify(rule))
    // Stamp explicit group indices on the way in. A rule saved before groups
    // existed has ungrouped conditions, each its own group — and if the editor
    // had to carry that, "+ or" on one of them would create a second group
    // rather than joining it, silently ANDing what the user just asked to OR.
    // Normalising here means every draft condition has a real group number.
    copy.conditions = groupConditions(copy.conditions)
      .flatMap((g, gi) => g.map(c => ({ ...c, group: gi })))
    setDraft(copy)
    setPreview(null); setError(null); setNotice(null)
  }
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
      const { handled, created, absorbed } = await gcalApplyRule(rule.id)
      await reload()
      // Say what was MADE, not how many events were walked. With "reuse the one
      // task" on, eight events produce one task, and reporting eight reads as
      // seven tasks having gone missing.
      const events = `${handled} event${handled === 1 ? '' : 's'}`
      setNotice(absorbed
        ? `${events} handled — ${created} task${created === 1 ? '' : 's'} created, ${absorbed} folded into it.`
        : `${events} handled — ${created} task${created === 1 ? '' : 's'} created.`)
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
            {describeConditions(rule.conditions)} → “{rule.template.title}”, {describeDue(rule.template.due_offset_days)}
            {rule.future_only ? ' · upcoming events only' : ''}
            {rule.on_repeat === 'update' ? ' · reuses one task' : ''}
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

          <label className="v2-form-label">Calendar</label>
          <select
            className="v2-form-input"
            value={draft.calendar_id || ''}
            onChange={e => editDraft({ calendar_id: e.target.value || null })}
          >
            <option value="">Use the calendar set in Settings</option>
            {calendars.map(c => (
              <option key={c.id} value={c.id}>{c.summary}{c.primary ? ' (Primary)' : ''}</option>
            ))}
          </select>

          <label className="v2-form-label">When an event…</label>
          <div className="v2-integrations-hint">
            Conditions inside a box are <strong>or</strong> — any one is enough. Every box must
            match.
          </div>
          {groups.map(([gid, rows], gi) => (
            <div key={gid}>
              {gi > 0 && <div className="v2-rule-join">and</div>}
              <div className="v2-rule-group">
                {rows.map(({ c, i }, ri) => (
                  <div key={i}>
                    {ri > 0 && <div className="v2-rule-join v2-rule-join-or">or</div>}
                    <div className="v2-integrations-row-compact">
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
                        <button type="button" className="v2-settings-btn" onClick={() => removeCondition(i)}>−</button>
                      )}
                    </div>
                  </div>
                ))}
                <button type="button" className="v2-settings-btn" onClick={() => addAlternative(gid)}>
                  + or
                </button>
              </div>
            </div>
          ))}
          <button type="button" className="v2-settings-btn" onClick={addGroup}>
            + and
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
            <span>Reuse the one task instead of adding another</span>
            <Toggle
              checked={draft.on_repeat === 'update'}
              onChange={e => editDraft({ on_repeat: e.target.checked ? 'update' : 'stack' })}
            />
          </div>
          {draft.on_repeat === 'update' && (
            <div className="v2-integrations-hint">
              A repeat rolls the existing task’s due date to the soonest event it covers and notes
              which one — your title, notes and progress are left alone. Once you finish it, the next
              event starts a fresh task.
            </div>
          )}
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
              Scanned {preview.scanned} event{preview.scanned === 1 ? '' : 's'} on{' '}
              <strong>{preview.calendar_id || 'the configured calendar'}</strong> in the next{' '}
              {preview.window_days} days · {preview.matches.length} match{preview.matches.length === 1 ? '' : 'es'}
              {preview.scanned === 0 && <div>Nothing on that calendar at all — check you’ve picked the right one.</div>}
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
