// notionMarkdown.js — markdown → Notion REST block objects. Pure: no db, no
// network. Tested in scripts/notionMarkdown.test.mjs.
//
// THIS IS THE FALLBACK, NOT THE PRIMARY PATH.
//
// Content now goes through MCP `notion-update-page` with
// `command: "replace_content"`, which hands the markdown to NOTION'S OWN
// parser — the reference implementation of Notion-flavored Markdown, covering
// tables, callouts, toggles, columns, mentions and every inline annotation.
// Anything hand-rolled here will always lag it.
//
// This converter only runs when MCP is unavailable and a REST token is set.
// It exists because an MCP-only-or-REST-only install must still work
// (CLAUDE.md), and because a fallback that silently mangles content is how the
// original bug survived.
//
// WHAT WENT WRONG (2026-08-16, "Quokka is not rendering entirely valid Notion
// markdown"). The old version handled exactly five cases — blank, `# `, `## `,
// `- [ ] `, `- ` — and dropped every other line into a paragraph holding ONE
// PLAIN rich_text run. So a page written through it showed literal `### `,
// `> `, `---`, `**bold**` and `*italic*` as visible characters. Fetching that
// page back returns them backslash-escaped (`\*\*bold\*\*`), which is Notion
// faithfully round-tripping text it was told was literal — not, as it first
// appears, something escaping our input.
//
// Every construct below is from the spec at `notion://docs/enhanced-markdown-spec`,
// read live rather than remembered (CLAUDE.md: never guess Notion syntax).

const text = (content, annotations) => ({
  type: 'text',
  text: { content },
  ...(annotations ? { annotations } : {}),
})

const link = (content, url) => ({
  type: 'text',
  text: { content, link: { url } },
})

// Inline rich text. Notion stores annotations on runs, so `**bold**` has to
// become a run with `{bold:true}` rather than literal asterisks.
//
// Ordered so the greedier delimiters win: `**` before `*`, `~~` before
// anything, and code spans before everything (their contents are literal).
const INLINE = [
  { re: /`([^`]+)`/, ann: { code: true } },
  { re: /\*\*([^*]+)\*\*/, ann: { bold: true } },
  { re: /__([^_]+)__/, ann: { bold: true } },
  { re: /~~([^~]+)~~/, ann: { strikethrough: true } },
  { re: /\*([^*]+)\*/, ann: { italic: true } },
]
const LINK_RE = /\[([^\]]+)\]\(([^)\s]+)\)/

/**
 * Split a line into Notion rich_text runs, honouring inline markdown.
 * Unmatched text passes through as plain runs, so worst case is the old
 * behaviour for that fragment rather than a thrown error.
 */
export function parseInline(line) {
  const src = String(line ?? '')
  if (!src) return []
  const runs = []

  const walk = (s) => {
    if (!s) return
    // Find whichever construct appears earliest, so `a **b** [c](d)` splits in
    // reading order rather than by rule order.
    let best = null
    const l = LINK_RE.exec(s)
    if (l) best = { index: l.index, len: l[0].length, run: link(l[1], l[2]) }
    for (const { re, ann } of INLINE) {
      const m = re.exec(s)
      if (!m) continue
      if (!best || m.index < best.index) {
        best = { index: m.index, len: m[0].length, run: text(m[1], ann) }
      }
    }
    if (!best) { runs.push(text(s)); return }
    if (best.index > 0) runs.push(text(s.slice(0, best.index)))
    runs.push(best.run)
    walk(s.slice(best.index + best.len))
  }

  walk(src)
  // Notion rejects empty content runs.
  return runs.filter(r => r.text.content.length > 0)
}

const block = (type, extra = {}) => ({ object: 'block', type, [type]: extra })

/**
 * Markdown → an array of Notion REST block objects.
 *
 * Block coverage matches what the app actually emits. Anything richer (tables,
 * callouts, toggles, columns) is why the MCP path is primary.
 */
export function markdownToBlocks(md) {
  if (!md) return []
  const out = []
  const lines = String(md).split('\n')

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()

    if (!trimmed) { out.push(block('paragraph', { rich_text: [] })); continue }

    // Fenced code: consume through the closing fence. Contents are literal —
    // running the inline parser over code would eat the user's asterisks.
    const fence = /^```(\w*)\s*$/.exec(trimmed)
    if (fence) {
      const body = []
      i++
      while (i < lines.length && !/^```\s*$/.test(lines[i].trim())) { body.push(lines[i]); i++ }
      out.push(block('code', {
        rich_text: [text(body.join('\n'))],
        language: fence[1] || 'plain text',
      }))
      continue
    }

    // Divider: --- / *** / ___ on their own line.
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) { out.push(block('divider', {})); continue }

    // Headings. Notion has 1–3; the spec says 4 is supported and 5–6 collapse
    // to 4, but the REST block types stop at heading_3, so clamp there.
    const h = /^(#{1,6})\s+(.*)$/.exec(trimmed)
    if (h) {
      const level = Math.min(h[1].length, 3)
      out.push(block(`heading_${level}`, { rich_text: parseInline(h[2]) }))
      continue
    }

    // To-do before plain bullets — `- [ ] x` also matches `- `.
    const todo = /^[-*]\s+\[([ xX])\]\s+(.*)$/.exec(trimmed)
    if (todo) {
      out.push(block('to_do', {
        rich_text: parseInline(todo[2]),
        checked: todo[1].toLowerCase() === 'x',
      }))
      continue
    }

    const bullet = /^[-*+]\s+(.*)$/.exec(trimmed)
    if (bullet) {
      out.push(block('bulleted_list_item', { rich_text: parseInline(bullet[1]) }))
      continue
    }

    const numbered = /^\d+[.)]\s+(.*)$/.exec(trimmed)
    if (numbered) {
      out.push(block('numbered_list_item', { rich_text: parseInline(numbered[1]) }))
      continue
    }

    const quote = /^>\s?(.*)$/.exec(trimmed)
    if (quote) {
      out.push(block('quote', { rich_text: parseInline(quote[1]) }))
      continue
    }

    out.push(block('paragraph', { rich_text: parseInline(trimmed) }))
  }

  return out
}
