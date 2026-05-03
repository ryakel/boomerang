import { useCallback, useEffect, useState } from 'react'
import { ListChecks } from 'lucide-react'
import Header from './components/Header'
import ModalShell from './components/ModalShell'
import EmptyState from './components/EmptyState'
import SectionLabel from './components/SectionLabel'
import TaskCard from './components/TaskCard'
import { useTasks } from '../hooks/useTasks'
import { useRoutines, enhanceSpawnedTasks } from '../hooks/useRoutines'
import { useNotifications } from '../hooks/useNotifications'
import { useServerSync } from '../hooks/useServerSync'
import { useExternalSync } from '../hooks/useExternalSync'
import { useSizeAutoInfer } from '../hooks/useSizeAutoInfer'
import { saveSettings, saveLabels, sortTasks } from '../store'
import './AppV2.css'

const STORAGE_KEY = 'ui_version'

// Header-icon and unported-modal placeholder copy. Each entry is a v2
// surface that hasn't shipped yet; tapping the icon opens a ModalShell
// that explains what's coming and lets the user flip back to v1.
const PLACEHOLDER_COPY = {
  adviser: {
    title: 'Quokka',
    body: 'The v2 Quokka adviser lands in a later release. Pop back to v1 to chat with Quokka in the meantime.',
  },
  packages: {
    title: 'Packages',
    body: 'Package tracking ports to v2 in a later release. v1 still works — flip back to use it.',
  },
  menu: {
    title: 'More',
    body: 'Settings, Projects, Analytics, and Activity Log will land here as v2 surfaces ship. The Beta toggle lives in v1 → Settings → Beta for now.',
  },
  edit: {
    title: 'Edit task',
    body: 'The v2 EditTaskModal lands in the next release. Use v1 to edit details for now.',
  },
  snooze: {
    title: 'Snooze',
    body: 'The v2 SnoozeModal lands in the next release. Use v1 to snooze for now.',
  },
}

export default function AppV2() {
  const [openModal, setOpenModal] = useState(null)
  const [expandedTaskId, setExpandedTaskId] = useState(null)

  // Mark the document so v2-namespaced tokens activate.
  useEffect(() => {
    document.documentElement.setAttribute('data-ui', 'v2')
    return () => { document.documentElement.removeAttribute('data-ui') }
  }, [])

  // Shared task + routine state — same hooks v1 uses, no fork.
  const {
    tasks, addSpawnedTasks, completeTask, updateTask,
    staleTasks, snoozedTasks, waitingTasks, doingTasks, upNextTasks, hydrateTasks,
  } = useTasks()
  const {
    routines, spawnDueTasks, hydrateRoutines,
  } = useRoutines()

  // Background work that must keep running even when v2 is the active shell:
  // notifications, AI inference, external (Trello/Notion) outbound sync.
  useNotifications(tasks)
  useExternalSync(tasks, updateTask)
  useSizeAutoInfer(tasks, updateTask)

  // Server hydration + cross-client sync. Mirror v1's hydrateFromServer so
  // settings + labels stay in localStorage when other clients update them.
  const hydrateFromServer = useCallback((data) => {
    if (data.tasks) hydrateTasks(data.tasks)
    if (data.routines) hydrateRoutines(data.routines)
    if (data.settings) saveSettings(data.settings)
    if (data.labels) saveLabels(data.labels)
  }, [hydrateTasks, hydrateRoutines])

  useServerSync(tasks, routines, hydrateFromServer, () => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then(regs => {
        for (const r of regs) r.unregister()
      })
    }
    setTimeout(() => window.location.reload(), 1000)
  })

  // Spawn due routine tasks on load + when routines change.
  useEffect(() => {
    const spawned = spawnDueTasks(tasks)
    if (spawned.length > 0) {
      addSpawnedTasks(spawned)
      enhanceSpawnedTasks(spawned, routines).then(enhanced => {
        for (const t of enhanced) {
          if (t.due_date) updateTask(t.id, { due_date: t.due_date })
        }
      }).catch(() => {})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routines])

  const switchToV1 = () => {
    localStorage.setItem(STORAGE_KEY, 'v1')
    window.location.reload()
  }

  // Sorted views — v2 currently uses a fixed 'age' sort. Sort UI ports later.
  const sortedDoing = sortTasks(doingTasks, 'age')
  const sortedStale = sortTasks(staleTasks, 'age')
  const sortedUpNext = sortTasks(upNextTasks, 'age')
  const sortedWaiting = sortTasks(waitingTasks, 'age')
  const sortedSnoozed = sortTasks(snoozedTasks, 'age')
  const totalActive = sortedDoing.length + sortedStale.length + sortedUpNext.length + sortedWaiting.length

  const handleComplete = useCallback((id) => {
    completeTask(id)
    // NOTE: routine completion + Trello status push are wired in PR4 alongside
    // the v2 modals. v2 currently completes the local task only; v1 still
    // does the full chain when used.
  }, [completeTask])

  const handleEdit = useCallback(() => setOpenModal('edit'), [])
  const handleSnooze = useCallback(() => setOpenModal('snooze'), [])

  const placeholderMeta = openModal ? PLACEHOLDER_COPY[openModal] : null

  const renderSection = (label, list) => list.length > 0 && (
    <>
      <SectionLabel count={list.length}>{label}</SectionLabel>
      {list.map(t => (
        <TaskCard
          key={t.id}
          task={t}
          expanded={expandedTaskId === t.id}
          onToggleExpand={setExpandedTaskId}
          onComplete={handleComplete}
          onEdit={handleEdit}
          onSnooze={handleSnooze}
        />
      ))}
    </>
  )

  return (
    <div className="v2-app">
      <Header
        onOpenAdviser={() => setOpenModal('adviser')}
        onOpenPackages={() => setOpenModal('packages')}
        onOpenMenu={() => setOpenModal('menu')}
      />
      <main className="v2-main">
        {totalActive === 0 && sortedSnoozed.length === 0 ? (
          <EmptyState
            icon={ListChecks}
            title="Nothing on your plate"
            body="No active tasks right now. Add one in v1 — quick-add UI lands in a later v2 release."
            cta="Back to v1"
            ctaOnClick={switchToV1}
          />
        ) : (
          <div className="v2-list">
            {renderSection('Doing', sortedDoing)}
            {renderSection('Stale', sortedStale)}
            {renderSection('Up next', sortedUpNext)}
            {renderSection('Waiting', sortedWaiting)}
            {renderSection('Snoozed', sortedSnoozed)}
          </div>
        )}
      </main>

      <ModalShell
        open={!!openModal}
        onClose={() => setOpenModal(null)}
        title={placeholderMeta?.title || ''}
        subtitle="Coming soon in v2"
      >
        <EmptyState
          title="Not yet ported"
          body={placeholderMeta?.body || ''}
          cta="Use v1 for this"
          ctaOnClick={switchToV1}
        />
      </ModalShell>
    </div>
  )
}
