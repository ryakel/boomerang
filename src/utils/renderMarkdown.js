// Minimal markdown renderer for Quokka chat bubbles.
// Supports the subset Claude actually emits: headings, bullet + numbered
// lists, bold, italic, inline code, and paragraph breaks.
// No dependencies, no dangerouslySetInnerHTML — returns React nodes.

import { createElement, Fragment } from 'react'

// Inline: **bold**, *italic*, _italic_, `code`, [text](url)
function renderInline(text, keyPrefix) {
  if (!text) return null
  const out = []
  // Token patterns in a single regex with named alternation order — bold
  // must win over italic. Links are matched ahead of any surrounding style.
  const pattern = /\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*|__([^_]+)__|\*([^*]+)\*|_([^_]+)_|`([^`]+)`/g
  let lastIdx = 0
  let m
  let i = 0
  while ((m = pattern.exec(text)) !== null) {
    if (m.index > lastIdx) out.push(text.slice(lastIdx, m.index))
    const key = `${keyPrefix}-i${i++}`
    if (m[1] !== undefined) out.push(createElement('a', { key, href: m[2], target: '_blank', rel: 'noopener noreferrer' }, m[1]))
    else if (m[3] !== undefined) out.push(createElement('strong', { key }, renderInline(m[3], `${key}-s`)))
    else if (m[4] !== undefined) out.push(createElement('strong', { key }, renderInline(m[4], `${key}-s`)))
    else if (m[5] !== undefined) out.push(createElement('em', { key }, renderInline(m[5], `${key}-e`)))
    else if (m[6] !== undefined) out.push(createElement('em', { key }, renderInline(m[6], `${key}-e`)))
    else if (m[7] !== undefined) out.push(createElement('code', { key, className: 'md-code' }, m[7]))
    lastIdx = pattern.lastIndex
  }
  if (lastIdx < text.length) out.push(text.slice(lastIdx))
  return out.length === 1 && typeof out[0] === 'string' ? out[0] : out
}

// Block: split by blank lines into paragraphs, detect lists and headings.
export function renderMarkdown(source) {
  if (!source) return null
  const lines = source.replace(/\r\n/g, '\n').split('\n')
  const blocks = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    // Skip blank lines between blocks
    if (/^\s*$/.test(line)) { i++; continue }

    // Heading (# through ######)
    const h = /^(#{1,6})\s+(.*)$/.exec(line)
    if (h) {
      blocks.push({ type: 'heading', level: Math.min(h[1].length + 2, 6), text: h[2] })
      i++
      continue
    }

    // Bullet list
    if (/^\s*[-*]\s+/.test(line)) {
      const items = []
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ''))
        i++
      }
      blocks.push({ type: 'ul', items })
      continue
    }

    // Numbered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const items = []
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ''))
        i++
      }
      blocks.push({ type: 'ol', items })
      continue
    }

    // Paragraph: consume until blank line or a block-starting line
    const para = [line]
    i++
    while (i < lines.length && !/^\s*$/.test(lines[i]) && !/^(#{1,6})\s+|^\s*[-*]\s+|^\s*\d+\.\s+/.test(lines[i])) {
      para.push(lines[i])
      i++
    }
    blocks.push({ type: 'p', text: para.join('\n') })
  }

  return createElement(
    Fragment,
    null,
    ...blocks.map((b, idx) => {
      const key = `b${idx}`
      if (b.type === 'heading') return createElement(`h${b.level}`, { key, className: 'md-h' }, renderInline(b.text, key))
      if (b.type === 'ul') return createElement('ul', { key, className: 'md-ul' }, b.items.map((it, j) => createElement('li', { key: `${key}-${j}` }, renderInline(it, `${key}-${j}`))))
      if (b.type === 'ol') return createElement('ol', { key, className: 'md-ol' }, b.items.map((it, j) => createElement('li', { key: `${key}-${j}` }, renderInline(it, `${key}-${j}`))))
      return createElement('p', { key, className: 'md-p' }, renderInline(b.text, key))
    })
  )
}
