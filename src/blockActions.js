import { gcalCreateEvent, gcalBlockRequest } from './api'
import { blockEvent, blockFields, NO_BLOCK, CALENDAR_CHANGED } from './blockModel'

// Giving a task a block, moving it, removing it (BOOM-57). Each is one
// deliberate tap: the calendar call happens first, then the task records it
// through the normal per-record sync. Nothing here runs on its own, and nothing
// else in the app creates a calendar event for a task (BOOM-58).
//
// The calendar call goes first so a failure leaves the task unchanged: a task
// that says "blocked" with no event behind it is the worse lie. The reverse
// (an event whose task update didn't land) carries "Managed by Boomerang", so
// Settings' clean-up can find it.

const announce = () => window.dispatchEvent(new Event(CALENDAR_CHANGED))

export async function setTaskBlock(task, { startMs, minutes }, { calendarId = 'primary', timeZone, updateTask }) {
  const zone = timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone
  const event = blockEvent(task, { startMs, minutes, timeZone: zone })
  let eventId = task.block_event_id || null
  let cal = task.block_calendar_id || calendarId
  if (eventId) {
    // Moving: the same event, so the calendar keeps one block per task. If it
    // was deleted on Google meanwhile, make a fresh one.
    const moved = await gcalBlockRequest('PATCH', eventId, cal, event)
    if (moved?.gone) eventId = null
  }
  if (!eventId) {
    cal = calendarId
    const made = await gcalCreateEvent(cal, event)
    if (!made?.eventId) throw new Error('Google Calendar did not return the new block')
    eventId = made.eventId
  }
  updateTask(task.id, blockFields({ eventId, calendarId: cal, startMs, minutes }))
  announce()
}

export async function removeTaskBlock(task, { updateTask }) {
  if (task.block_event_id) {
    // Only this task's own event; gone already counts as removed.
    await gcalBlockRequest('DELETE', task.block_event_id, task.block_calendar_id || 'primary')
  }
  updateTask(task.id, NO_BLOCK)
  announce()
}
