// Impact dots chip — ●/●●/●●● in a distinct color next to the energy/tag
// meta (decision D5). Tap to cycle 1 → 2 → 3 → 1, mirroring the energy
// chip's tap-to-cycle; null impact (never inferred) displays as the 2
// baseline. Rendered inside the row-body button, so clicks stop propagation
// instead of opening the task.
export default function ImpactDots({ task, onCycle }) {
  const level = [1, 2, 3].includes(task.impact) ? task.impact : 2
  const label = ['low', 'med', 'high'][level - 1]
  const cycle = (e) => {
    e.stopPropagation()
    e.preventDefault()
    onCycle?.(task)
  }
  return (
    <span
      className={`bm-impact bm-impact-${level}`}
      title={`Impact: ${label}${task.impact == null ? ' (auto)' : ''} — tap to change`}
      onClick={onCycle ? cycle : undefined}
      aria-label={`Impact ${label}`}
    >
      {'●'.repeat(level)}
    </span>
  )
}
