/**
 * Parse markdown text into task objects.
 *
 * Supported patterns:
 *   - [ ] Task title             → unchecked task
 *   - [x] Task title             → skipped (already done)
 *   - Task title                 → bullet list item as task
 *   ## Section Header            → used as tag/group name
 *   (due: Friday)                → natural language due date hint in notes
 *
 * Returns: Array of { title, notes, group }
 */
export function parseMarkdown(text) {
  if (!text || !text.trim()) return []

  const lines = text.split('\n')
  const tasks = []
  let currentGroup = null

  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue

    // Headers become group names
    const headerMatch = line.match(/^#{1,6}\s+(.+)/)
    if (headerMatch) {
      currentGroup = headerMatch[1].trim()
      continue
    }

    // Skip completed checkboxes
    if (/^-\s*\[x\]/i.test(line)) continue

    // Unchecked checkbox → task
    const checkboxMatch = line.match(/^-\s*\[\s?\]\s+(.+)/)
    if (checkboxMatch) {
      tasks.push({
        title: checkboxMatch[1].trim(),
        group: currentGroup,
      })
      continue
    }

    // Bullet or numbered list item → task
    const bulletMatch = line.match(/^[-*+]\s+(.+)/)
    const numberedMatch = !bulletMatch && line.match(/^\d+[.)]\s+(.+)/)
    const match = bulletMatch || numberedMatch
    if (match) {
      tasks.push({
        title: match[1].trim(),
        group: currentGroup,
      })
      continue
    }

    // Plain text lines that aren't headers or list items — skip
    // (paragraphs are not tasks)
  }

  return tasks
}
