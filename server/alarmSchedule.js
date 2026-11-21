// Data-only alarm policy and calendar math. No native side effects or pickup constants.
export const ALARM_HORIZON_DAYS = 28
export function validateAlarmRule(input) {
  const fail = message => { throw new Error(message) }
  if (!input || !['task', 'routine'].includes(input.sourceKind) || typeof input.sourceId !== 'string' || !input.sourceId || input.sourceId.length > 100) fail('Choose a task or routine.')
  if (typeof input.enabled !== 'boolean') fail('Choose whether this rule is enabled.')
  try { new Intl.DateTimeFormat('en', { timeZone: input.timeZone }).format() } catch { fail('Choose an IANA timezone.') }
  if (typeof input.timeZone !== 'string' || input.timeZone.length > 100) fail('Choose a timezone.')
  const clock = value => typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)
  const weekly = input.weekly
  const dates = input.dates
  if (!Array.isArray(weekly) || weekly.length > 7 || !weekly.every(x => Number.isInteger(x.weekday) && x.weekday >= 0 && x.weekday < 7 && clock(x.time)) || new Set(weekly.map(x => x.weekday)).size !== weekly.length) fail('Review weekly times.')
  if (!Array.isArray(dates) || dates.length > 60 || !dates.every(x => validDate(x.date) && (x.time === null || clock(x.time))) || new Set(dates.map(x => x.date)).size !== dates.length) fail('Review dated exceptions. A blank time skips that date.')
  if (!Number.isInteger(input.leadMinutes) || input.leadMinutes < 1 || input.leadMinutes > 120) fail('Early cue must be 1–120 minutes before the target.')
  if (!Number.isInteger(input.snoozeMinutes) || input.snoozeMinutes < 1 || input.snoozeMinutes > 30) fail('Snooze must be 1–30 minutes.')
  if (typeof input.ackLabel !== 'string' || !input.ackLabel.trim() || input.ackLabel.length > 60) fail('Enter an acknowledgment label.')
  // Arriving as done (BOOM-53): an optional saved place. Coordinates only, the
  // ones the owner saved; never a location history.
  const arrival = input.arrival == null ? null : validateArrival(input.arrival, fail)
  return { sourceKind: input.sourceKind, sourceId: input.sourceId, enabled: input.enabled, timeZone: input.timeZone,
    weekly: weekly.map(({weekday,time}) => ({weekday,time})), dates: dates.map(({date,time}) => ({date,time})),
    leadMinutes: input.leadMinutes, snoozeMinutes: input.snoozeMinutes, ackLabel: input.ackLabel.trim(), arrival }
}

export const ARRIVAL_RADIUS_DEFAULT = 150
function validateArrival(a, fail) {
  const num = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi
  if (typeof a !== 'object' || typeof a.enabled !== 'boolean') fail('Choose whether arriving counts as done.')
  if (!num(a.latitude, -90, 90) || !num(a.longitude, -180, 180)) fail('Save the place again: its location is invalid.')
  if (!num(a.radius ?? ARRIVAL_RADIUS_DEFAULT, 50, 1000)) fail('The arrival area must be 50–1000 m.')
  if (typeof a.label !== 'string' || !a.label.trim() || a.label.length > 80) fail('Name the place (up to 80 characters).')
  return { enabled: a.enabled, latitude: a.latitude, longitude: a.longitude, radius: a.radius ?? ARRIVAL_RADIUS_DEFAULT, label: a.label.trim() }
}
export function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value
}
function parts(ms, timeZone) {
  return Object.fromEntries(new Intl.DateTimeFormat('en-CA', {timeZone, year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(ms)).map(x=>[x.type,x.value]))
}
export function dateInZone(ms, timeZone) { const p=parts(ms,timeZone); return `${p.year}-${p.month}-${p.day}` }
export function zonedInstant(date, time, timeZone) {
  const desired = Date.parse(`${date}T${time}:00Z`)
  let candidate = desired
  for (let i=0;i<4;i++) {
    const p=parts(candidate,timeZone)
    const local=Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:00Z`)
    if (local===desired) {
      // Refuse ambiguous fall-back clock times instead of silently choosing an offset.
      for (const delta of [-3600000,3600000]) {
        const q=parts(candidate+delta,timeZone)
        if (`${q.year}-${q.month}-${q.day}T${q.hour}:${q.minute}`===`${date}T${time}`) throw Error('Ambiguous daylight-saving clock time; choose another time.')
      }
      return candidate
    }
    candidate += desired-local
  }
  throw Error('Clock time does not exist in this timezone; choose another time.')
}
export function planAlarmRule(rule, { now=Date.now(), acknowledgments={} }={}) {
  validateAlarmRule(rule)
  const occurrences=[]
  const start=dateInZone(now,rule.timeZone)
  for(let day=0;day<ALARM_HORIZON_DAYS;day++) {
    const d=new Date(`${start}T12:00:00Z`); d.setUTCDate(d.getUTCDate()+day)
    const date=d.toISOString().slice(0,10)
    const override=rule.dates.find(x=>x.date===date)
    const time=override ? override.time : rule.weekly.find(x=>x.weekday===d.getUTCDay())?.time
    const key=`${rule.id}:${date}`
    if (!rule.enabled || !time || acknowledgments[key] || rule.heldDates?.includes(date)) continue
    const target=zonedInstant(date,time,rule.timeZone)
    if(target<=now) continue // Never recreate an already due cue after launch.
    occurrences.push({key,ruleId:rule.id,date,target:new Date(target).toISOString(),early:new Date(target-rule.leadMinutes*60000).toISOString(),
      title:rule.title,timeZone:rule.timeZone,ackLabel:rule.ackLabel,snoozeMinutes:rule.snoozeMinutes,sourceKind:rule.sourceKind,sourceId:rule.sourceId,
      earlyPending:target-rule.leadMinutes*60000>now})
  }
  return {occurrences, through:new Date(Date.parse(`${start}T12:00Z`)+(ALARM_HORIZON_DAYS-1)*86400000).toISOString().slice(0,10)}
}

// A completed/skipped routine occurrence must not keep its own date's alarms.
export function sourceHeldDates(parent, timeZone) {
  const dates=[]
  for(const value of [...(parent?.completed_history || []),...(parent?.skipped_days || [])]) {
    if(validDate(value)) dates.push(value)
    else if(typeof value==='string' && Number.isFinite(Date.parse(value))) dates.push(dateInZone(Date.parse(value),timeZone))
  }
  return [...new Set(dates)]
}
