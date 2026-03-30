import { useEffect, useRef } from 'react'
import { loadSettings, isStale, isOverdue } from '../store'

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

export function useNotifications(tasks) {
  const lastCheck = useRef(Date.now())

  useEffect(() => {
    const settings = loadSettings()
    if (!settings.notifications_enabled) return
    if (!('Notification' in window) || Notification.permission !== 'granted') return

    const frequencyMs = (settings.notif_frequency || 30) * 60 * 1000

    const check = async () => {
      const now = Date.now()
      if (now - lastCheck.current < frequencyMs) return
      lastCheck.current = now

      const openTasks = tasks.filter(t => t.status === 'open')
      const nonSnoozed = openTasks.filter(t => !t.snoozed_until || new Date(t.snoozed_until) <= new Date())

      // Check for too many open tasks
      if (settings.max_open_tasks && nonSnoozed.length > settings.max_open_tasks) {
        new Notification('Too many open tasks', {
          body: `You have ${nonSnoozed.length} open tasks (limit: ${settings.max_open_tasks}). Can you knock one out?`,
          icon: '/icon-192.png',
          tag: 'too-many',
        })
        return
      }

      // Check for overdue tasks
      if (settings.notif_overdue !== false) {
        const overdueTasks = openTasks.filter(isOverdue)
        if (overdueTasks.length > 0) {
          const names = overdueTasks.slice(0, 2).map(t => `"${t.title}"`).join(', ')
          const extra = overdueTasks.length > 2 ? ` and ${overdueTasks.length - 2} more` : ''
          new Notification('Overdue tasks', {
            body: `${names}${extra} — past due date`,
            icon: '/icon-192.png',
            tag: 'overdue',
          })
          return
        }
      }

      // Check for stale tasks
      if (settings.notif_stale !== false) {
        const staleTasks = openTasks.filter(isStale)
        if (staleTasks.length > 0) {
          const names = staleTasks.slice(0, 2).map(t => `"${t.title}"`).join(', ')
          const extra = staleTasks.length > 2 ? ` and ${staleTasks.length - 2} more` : ''
          new Notification('Tasks going stale', {
            body: `${names}${extra} — haven't been touched in a while`,
            icon: '/icon-192.png',
            tag: 'stale',
          })
          return
        }
      }

      // General nudge
      if (settings.notif_nudge !== false && openTasks.length > 0) {
        const message = await getAINudge(openTasks.length)
        new Notification('Boomerang', {
          body: message,
          icon: '/icon-192.png',
          tag: 'nudge',
        })
      }
    }

    check()
    const interval = setInterval(check, frequencyMs)
    return () => clearInterval(interval)
  }, [tasks])
}
