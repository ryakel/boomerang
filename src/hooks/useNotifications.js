import { useEffect, useRef } from 'react'
import { loadSettings, isStale, isOverdue, logNotification, AVOIDANCE_ENERGY_TYPES } from '../store'

const FALLBACK_NUDGES = [
  "Got 2 minutes? Even one tiny thing counts.",
  "Pick the easiest thing on your list. Just that one.",
  "You don't have to finish anything — just open one task.",
  "Future you will be glad you looked. Just a peek.",
  "One small thing off the list = momentum.",
  "No pressure. But you've got stuff you'll feel good finishing.",
  "What's the smallest possible next step? Start there.",
  "You're not behind. Let's just see what's up.",
  "Brains like ours forget stuff. That's why this is here.",
  "Not a drill — just a friendly tap on the shoulder.",
  "You wanted to remember this stuff. Here's your reminder.",
  "The hardest part is opening the app. You're almost there.",
]

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)]
}

async function getAINudge(taskCount) {
  try {
    const { custom_instructions } = loadSettings()
    if (!custom_instructions?.trim()) return pickRandom(FALLBACK_NUDGES)

    const settings2 = loadSettings()
    const headers = { 'Content-Type': 'application/json' }
    if (settings2.anthropic_api_key) headers['x-anthropic-key'] = settings2.anthropic_api_key

    const res = await fetch('/api/messages', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 100,
        system: `You write short push notification messages (under 80 chars) to nudge someone back into their task manager app. ADHD-friendly: low pressure, warm, not preachy. One message only, no quotes.\n\nThe user has provided these custom instructions:\n---\n${custom_instructions.trim()}\n---`,
        messages: [{ role: 'user', content: `They have ${taskCount} open tasks. Write one nudge message.` }],
      }),
    })

    if (!res.ok) return pickRandom(FALLBACK_NUDGES)
    const data = await res.json()
    return data.content[0].text.trim().replace(/^["']|["']$/g, '')
  } catch {
    return pickRandom(FALLBACK_NUDGES)
  }
}

function isInQuietHours(settings) {
  if (!settings.quiet_hours_enabled) return false
  const now = new Date()
  const currentMins = now.getHours() * 60 + now.getMinutes()
  const [startH, startM] = (settings.quiet_hours_start || '22:00').split(':').map(Number)
  const [endH, endM] = (settings.quiet_hours_end || '08:00').split(':').map(Number)
  const startMins = startH * 60 + startM
  const endMins = endH * 60 + endM

  if (startMins <= endMins) {
    return currentMins >= startMins && currentMins < endMins
  }
  // Wraps midnight (e.g. 22:00 - 08:00)
  return currentMins >= startMins || currentMins < endMins
}

function sendNotification(type, title, body, tag) {
  new Notification(title, { body, icon: '/icon-192.png', tag })
  logNotification(type, title, body)
}

function getFreqMs(settings, key, fallback) {
  const val = settings[key]
  return (val != null ? val : (settings.notif_frequency || fallback)) * 60 * 1000
}

function getHighPriorityFreqMs(task) {
  if (!task.due_date) return 24 * 60 * 60 * 1000 // daily if no due date
  const now = new Date()
  const due = new Date(task.due_date + 'T00:00:00')
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate())
  const diffDays = Math.round((dueDay - today) / 86400000)

  if (diffDays > 0) return 24 * 60 * 60 * 1000 // daily before due date
  if (diffDays === 0) return 60 * 60 * 1000 // hourly on due date
  return 30 * 60 * 1000 // every 30 min when overdue
}

// Avoidance boost: tasks with confrontation/errand energy get nagged more frequently.
// Avoidance-prone type: 1.3x more frequent (interval / 1.3)
// High drain (level 3): additional 1.2x (interval / 1.2)
// Combined max: ~1.56x more frequent for ⚡⚡⚡ confrontation tasks
function applyAvoidanceBoost(freqMs, task) {
  if (!task.energy || !AVOIDANCE_ENERGY_TYPES.includes(task.energy)) return freqMs
  let boost = 1.3
  if (task.energyLevel === 3) boost *= 1.2
  return Math.round(freqMs / boost)
}

function isInHighPriNotifWindow(task) {
  const hour = new Date().getHours()
  if (!task.due_date) return hour >= 8 && hour < 22 // daily: 8am-10pm
  const now = new Date()
  const due = new Date(task.due_date + 'T00:00:00')
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate())
  const diffDays = Math.round((dueDay - today) / 86400000)

  if (diffDays > 0) return hour >= 8 && hour < 22 // daily: 8am-10pm
  if (diffDays === 0) return hour >= 8 && hour < 22 // due date: 8am-10pm
  return hour >= 6 && hour < 22 // overdue: 6am-10pm
}

export function useNotifications(tasks) {
  const lastChecks = useRef({
    overdue: 0,
    stale: 0,
    nudge: 0,
    size: 0,
    pileup: 0,
  })
  const highPriLastChecks = useRef({}) // per-task last check times

  useEffect(() => {
    const settings = loadSettings()
    if (!settings.notifications_enabled) return
    if (!('Notification' in window) || Notification.permission !== 'granted') return

    // Compute per-type frequencies
    const freqs = {
      overdue: getFreqMs(settings, 'notif_freq_overdue', 30),
      stale: getFreqMs(settings, 'notif_freq_stale', 30),
      nudge: getFreqMs(settings, 'notif_freq_nudge', 60),
      size: getFreqMs(settings, 'notif_freq_size', 60),
      pileup: getFreqMs(settings, 'notif_freq_pileup', 120),
    }

    // Tick at the shortest frequency so we don't miss any
    const tickMs = Math.min(...Object.values(freqs), 60 * 1000) // at least every minute for high-priority

    const check = async () => {
      if (isInQuietHours(settings)) return

      const now = Date.now()
      const lc = lastChecks.current

      // High-priority notifications — independent per-task timers
      const activeTasks = tasks.filter(t => t.status !== 'done' && t.status !== 'backlog')
      const highPriTasks = activeTasks.filter(t => t.high_priority && (!t.snoozed_until || new Date(t.snoozed_until) <= new Date()))
      const hpLc = highPriLastChecks.current
      let hpNotifCount = 0

      for (const task of highPriTasks) {
        if (hpNotifCount >= 3) break // cap per cycle
        if (!isInHighPriNotifWindow(task)) continue

        const freq = applyAvoidanceBoost(getHighPriorityFreqMs(task), task)
        const lastCheck = hpLc[task.id] || 0

        if (now - lastCheck >= freq) {
          hpLc[task.id] = now
          const dueDate = task.due_date ? new Date(task.due_date + 'T00:00:00') : null
          const today = new Date()
          today.setHours(0, 0, 0, 0)

          let body
          if (dueDate) {
            const diffDays = Math.round((dueDate - today) / 86400000)
            if (diffDays < 0) {
              body = `"${task.title}" is ${Math.abs(diffDays)} day${Math.abs(diffDays) > 1 ? 's' : ''} overdue`
            } else if (diffDays === 0) {
              body = `"${task.title}" is due today — don't miss it`
            } else if (diffDays === 1) {
              body = `"${task.title}" is due tomorrow`
            } else {
              body = `"${task.title}" is due in ${diffDays} days`
            }
          } else {
            body = `"${task.title}" is marked high priority`
          }

          sendNotification('high_priority', 'HIGH PRIORITY', body, `high-pri-${task.id.slice(0, 8)}`)
          hpNotifCount++
        }
      }

      // Clean up old entries for tasks that are no longer high priority
      for (const id of Object.keys(hpLc)) {
        if (!highPriTasks.some(t => t.id === id)) delete hpLc[id]
      }

      const openTasks = tasks.filter(t => t.status === 'open')
      const nonSnoozed = openTasks.filter(t => !t.snoozed_until || new Date(t.snoozed_until) <= new Date())

      // Check for too many open tasks (pile-up)
      if (now - lc.pileup >= freqs.pileup) {
        lc.pileup = now

        if (settings.max_open_tasks && nonSnoozed.length > settings.max_open_tasks) {
          sendNotification('pileup', 'Too many open tasks', `You have ${nonSnoozed.length} open tasks (limit: ${settings.max_open_tasks}). Can you knock one out?`, 'too-many')
        }

        // Check for high percentage of old tasks
        if (settings.stale_warn_pct > 0) {
          const oldTasks = openTasks.filter(t => {
            const age = (Date.now() - new Date(t.created_at).getTime()) / 86400000
            return age > (settings.stale_warn_days || 7)
          })
          const pct = openTasks.length > 0 ? Math.round(oldTasks.length / openTasks.length * 100) : 0
          if (pct >= settings.stale_warn_pct) {
            sendNotification('pileup', 'Tasks piling up', `${pct}% of your tasks have been open for ${settings.stale_warn_days}+ days`, 'stale-warn')
          }
        }
      }

      // Size-based upcoming reminders
      if (now - lc.size >= freqs.size) {
        lc.size = now

        const sizeLeadDays = { XL: 3, L: 2, M: 1 }
        const upcomingBySize = openTasks.filter(t => {
          if (!t.size || !t.due_date || !sizeLeadDays[t.size]) return false
          const dueDate = new Date(t.due_date)
          const daysUntilDue = Math.ceil((dueDate.getTime() - Date.now()) / 86400000)
          return daysUntilDue > 0 && daysUntilDue <= sizeLeadDays[t.size]
        })

        if (upcomingBySize.length > 0) {
          const t = upcomingBySize[0]
          const daysLeft = Math.ceil((new Date(t.due_date).getTime() - Date.now()) / 86400000)
          sendNotification('size', `${t.size} task due soon`, `"${t.title}" is due in ${daysLeft} day${daysLeft > 1 ? 's' : ''} — it's a ${t.size}, start planning`, 'size-reminder')
        }
      }

      // Check for overdue tasks
      if (settings.notif_overdue !== false && now - lc.overdue >= freqs.overdue) {
        lc.overdue = now

        const overdueTasks = openTasks.filter(isOverdue)
        if (overdueTasks.length > 0) {
          const names = overdueTasks.slice(0, 2).map(t => `"${t.title}"`).join(', ')
          const extra = overdueTasks.length > 2 ? ` and ${overdueTasks.length - 2} more` : ''
          sendNotification('overdue', 'Overdue tasks', `${names}${extra} — past due date`, 'overdue')
        }
      }

      // Check for stale tasks
      if (settings.notif_stale !== false && now - lc.stale >= freqs.stale) {
        lc.stale = now

        const staleTasks = openTasks.filter(isStale)
        if (staleTasks.length > 0) {
          const names = staleTasks.slice(0, 2).map(t => `"${t.title}"`).join(', ')
          const extra = staleTasks.length > 2 ? ` and ${staleTasks.length - 2} more` : ''
          sendNotification('stale', 'Tasks going stale', `${names}${extra} — haven't been touched in a while`, 'stale')
        }
      }

      // General nudge
      if (settings.notif_nudge !== false && now - lc.nudge >= freqs.nudge && openTasks.length > 0) {
        lc.nudge = now

        // Check for quick wins first
        const smallTasks = openTasks.filter(t => t.size === 'XS' || t.size === 'S')
        if (smallTasks.length > 0) {
          const pick = smallTasks[Math.floor(Math.random() * smallTasks.length)]
          sendNotification('nudge', 'Quick win available', `Got 5 min? Try: "${pick.title}" (${pick.size})`, 'nudge')
        } else {
          // Fall back to AI or generic nudge
          const message = await getAINudge(openTasks.length)
          sendNotification('nudge', 'Boomerang', message, 'nudge')
        }
      }
    }

    check()
    const interval = setInterval(check, tickMs)
    return () => clearInterval(interval)
  }, [tasks])
}
