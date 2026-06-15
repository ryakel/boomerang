// Kept motion vocabulary (spec §8) — the three signature interaction moments,
// wired into the real handlers. WAAPI-driven (animations persist across the
// brief window before React reconciles), all gated on prefers-reduced-motion.
//
// catch  — completing a task: the gold boomerang dot arcs back into the check
//          as it fills, the title strikes through, the row settles. The brand
//          thesis made physical: completion IS the boomerang returning.
// throw  — capture: the freshly-created row drops into the list on a soft arc.
// return — throw it back (snooze): the row flies off to the right on an
//          upward arc before it leaves the active list.

export const reduceMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

const SPRING = 'cubic-bezier(.3,1.4,.4,1)'
const esc = (v) => (typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(String(v)) : String(v))
const rowFor = (taskId) =>
  taskId ? document.querySelector(`.bm-row[data-task-id="${esc(taskId)}"]`) : null

// Catch — play on the tapped check element, then commit the completion. The
// commit is delayed ~300ms so the motion lands on the live row before React
// removes it (caught tasks leave the active list). Guarded against double-fire.
export function catchThenComplete(chkEl, commit) {
  if (!chkEl || reduceMotion()) { commit(); return }
  if (chkEl.dataset.catching) return
  chkEl.dataset.catching = '1'
  const row = chkEl.closest('.bm-row')

  // the check fills (WAAPI fill:forwards holds the state through the window)
  chkEl.animate(
    [{ background: 'transparent' }, { background: 'var(--bm-ember)' }],
    { duration: 200, easing: 'ease-out', fill: 'forwards' },
  )

  // the gold dot arcs up-and-back INTO the check — the return
  const dot = document.createElement('span')
  dot.className = 'bm-catch-dot'
  chkEl.appendChild(dot)
  dot.animate([
    { transform: 'translate(22px,-26px) scale(.5)', opacity: 0, offset: 0 },
    { opacity: 1, offset: 0.25 },
    { transform: 'translate(9px,-11px) scale(.95)', opacity: 1, offset: 0.6 },
    { transform: 'translate(0,0) scale(1)', opacity: 1, offset: 1 },
  ], { duration: 300, easing: 'cubic-bezier(.3,1.05,.3,1)', fill: 'forwards' })

  // strike the title + settle the row
  const title = row && row.querySelector('.bm-row-title')
  if (title) {
    const s = document.createElement('span')
    s.className = 'bm-catch-strike'
    title.appendChild(s)
    s.animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }],
      { duration: 260, easing: 'ease-out', fill: 'forwards' })
  }
  if (row) {
    row.animate([{ transform: 'translateY(0)' }, { transform: 'translateY(2px)' }, { transform: 'translateY(0)' }],
      { duration: 280, easing: 'ease-out' })
  }
  setTimeout(commit, 300)
}

// Throw — the new row drops into the list on a soft spring arc. Looked up by
// task id after React has mounted it (two rAFs); a no-op if it isn't on screen.
export function playThrowIn(taskId) {
  if (reduceMotion() || !taskId) return
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const el = rowFor(taskId)
    if (!el) return
    el.animate([
      { transform: 'translateY(-18px) rotate(-2deg)', opacity: 0, offset: 0 },
      { transform: 'translateY(3px)', opacity: 1, offset: 0.7 },
      { transform: 'translateY(0) rotate(0)', opacity: 1, offset: 1 },
    ], { duration: 400, easing: SPRING })
  }))
}

// Return — fly the row off to the right (upward arc + fade) before committing
// the snooze. Commits immediately if the row isn't visible (e.g. behind a modal).
export function returnThenCommit(taskId, commit) {
  if (reduceMotion()) { commit(); return }
  const el = rowFor(taskId)
  if (!el) { commit(); return }
  el.animate([
    { transform: 'translate(0,0)', opacity: 1, offset: 0 },
    { transform: 'translate(14px,-6px)', opacity: 1, offset: 0.3 },
    { transform: 'translate(120px,2px)', opacity: 0, offset: 1 },
  ], { duration: 340, easing: 'cubic-bezier(.4,0,.5,1)', fill: 'forwards' })
  setTimeout(commit, 300)
}
