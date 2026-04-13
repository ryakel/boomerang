import { useEffect, useCallback, useState } from 'react'

/**
 * Desktop keyboard shortcuts for task management.
 * Only active when isDesktop is true.
 *
 * Shortcuts:
 *   n          — open Add Task modal
 *   /          — focus search
 *   j / ↓      — select next task
 *   k / ↑      — select previous task
 *   Enter / e  — edit selected task
 *   x          — complete selected task
 *   s          — snooze selected task
 *   Escape     — close topmost modal/overlay, or clear selection
 *   ?          — toggle shortcut help
 */
export function useKeyboardShortcuts({
  isDesktop,
  visibleTasks,
  // Actions
  onEdit,
  onComplete,
  onSnooze,
  // Modal toggles
  openAddModal,
  focusSearch,
  // Active modals (for Escape stacking)
  activeModals,
  closeTopModal,
}) {
  const [selectedIndex, setSelectedIndex] = useState(-1)
  const [showHelp, setShowHelp] = useState(false)

  // Reset selection when visible tasks change
  useEffect(() => {
    setSelectedIndex(-1)
  }, [visibleTasks])

  const selectedTask = selectedIndex >= 0 && selectedIndex < visibleTasks.length
    ? visibleTasks[selectedIndex]
    : null

  const handleKeyDown = useCallback((e) => {
    if (!isDesktop) return

    // Skip when typing in inputs
    const tag = e.target.tagName
    const editable = e.target.isContentEditable
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || editable) {
      // Only handle Escape in inputs (to blur/close)
      if (e.key === 'Escape') {
        e.target.blur()
      }
      return
    }

    // Modifier keys — don't hijack browser shortcuts
    if (e.metaKey || e.ctrlKey || e.altKey) return

    switch (e.key) {
      case 'n':
        e.preventDefault()
        openAddModal()
        break

      case '/':
        e.preventDefault()
        focusSearch()
        break

      case 'j':
      case 'ArrowDown':
        e.preventDefault()
        setSelectedIndex(prev => {
          if (visibleTasks.length === 0) return -1
          return Math.min(prev + 1, visibleTasks.length - 1)
        })
        break

      case 'k':
      case 'ArrowUp':
        e.preventDefault()
        setSelectedIndex(prev => {
          if (visibleTasks.length === 0) return -1
          return Math.max(prev - 1, 0)
        })
        break

      case 'Enter':
      case 'e':
        if (selectedTask) {
          e.preventDefault()
          onEdit(selectedTask)
        }
        break

      case 'x':
        if (selectedTask) {
          e.preventDefault()
          onComplete(selectedTask.id)
          // Move selection up if at end, otherwise stay
          setSelectedIndex(prev => Math.min(prev, visibleTasks.length - 2))
        }
        break

      case 's':
        if (selectedTask) {
          e.preventDefault()
          onSnooze(selectedTask)
        }
        break

      case 'Escape':
        e.preventDefault()
        if (activeModals.length > 0) {
          closeTopModal()
        } else if (selectedIndex >= 0) {
          setSelectedIndex(-1)
        }
        break

      case '?':
        e.preventDefault()
        setShowHelp(prev => !prev)
        break

      default:
        break
    }
  }, [isDesktop, visibleTasks, selectedTask, selectedIndex, openAddModal, focusSearch, onEdit, onComplete, onSnooze, activeModals, closeTopModal])

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  // Scroll selected task into view
  useEffect(() => {
    if (selectedIndex < 0 || !selectedTask) return
    const el = document.querySelector(`[data-task-id="${selectedTask.id}"]`)
    if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [selectedIndex, selectedTask])

  return { selectedTaskId: selectedTask?.id ?? null, showHelp, setShowHelp }
}
