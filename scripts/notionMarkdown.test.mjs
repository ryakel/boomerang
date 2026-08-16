import test from 'node:test'
import assert from 'node:assert/strict'
import { markdownToBlocks, parseInline } from '../server/notionMarkdown.js'

// Reported 2026-08-16: "Quokka is not rendering entirely valid Notion
// markdown." A page came out with literal `### `, `> `, `---`, `**bold**` and
// `*italic*` visible as characters.
//
// The old converter handled five cases (blank, `# `, `## `, `- [ ] `, `- `)
// and dropped everything else into a paragraph holding ONE PLAIN rich_text
// run. Fetching such a page back returns the text backslash-escaped
// (`\*\*bold\*\*`) — Notion round-tripping literal text, which looks like
// something escaped our input but is the symptom, not the cause.
//
// Content now goes through MCP replace_content (Notion's own parser); this
// converter is the no-MCP fallback and must not mangle what it does handle.

const typesOf = (blocks) => blocks.map(b => b.type)
const plain = (rt) => rt.map(r => r.text.content).join('')

test('THE REGRESSION: heading 3 is a heading, not literal "### Details"', () => {
  const [b] = markdownToBlocks('### Details')
  assert.equal(b.type, 'heading_3')
  assert.equal(plain(b.heading_3.rich_text), 'Details')
})

test('THE REGRESSION: a quote is a quote, not literal "> Goal: ..."', () => {
  const [b] = markdownToBlocks('> Goal: Replace sash lifter')
  assert.equal(b.type, 'quote')
  assert.equal(plain(b.quote.rich_text), 'Goal: Replace sash lifter')
})

test('THE REGRESSION: --- is a divider, not literal text', () => {
  assert.deepEqual(typesOf(markdownToBlocks('---')), ['divider'])
  assert.deepEqual(typesOf(markdownToBlocks('***')), ['divider'])
})

test('THE REGRESSION: **bold** becomes an annotated run, not literal asterisks', () => {
  const runs = parseInline('Scope: **home double-hung window sash lifters** — not a car issue.')
  assert.equal(runs.length, 3)
  assert.equal(runs[0].text.content, 'Scope: ')
  assert.equal(runs[1].text.content, 'home double-hung window sash lifters')
  assert.deepEqual(runs[1].annotations, { bold: true })
  assert.equal(runs[2].text.content, ' — not a car issue.')
  // The whole point: no asterisk survives into the rendered text.
  assert.ok(!plain(runs).includes('*'))
})

test('italic, strikethrough, code and links all annotate', () => {
  assert.deepEqual(parseInline('*just enough*')[0].annotations, { italic: true })
  assert.deepEqual(parseInline('~~gone~~')[0].annotations, { strikethrough: true })
  assert.deepEqual(parseInline('`code`')[0].annotations, { code: true })
  const [l] = parseInline('[Marvin](https://marvin.com)')
  assert.equal(l.text.content, 'Marvin')
  assert.equal(l.text.link.url, 'https://marvin.com')
})

test('bold wins over italic on the same asterisks', () => {
  // A naive single-* rule turns **x** into an italic run wrapping *x*.
  const runs = parseInline('**Last Updated:** 8/16/2026')
  assert.deepEqual(runs[0].annotations, { bold: true })
  assert.equal(runs[0].text.content, 'Last Updated:')
  assert.equal(runs[1].text.content, ' 8/16/2026')
})

test('inline constructs come out in reading order, not rule order', () => {
  const runs = parseInline('see [docs](http://x) and **this**')
  assert.deepEqual(runs.map(r => r.text.content), ['see ', 'docs', ' and ', 'this'])
  assert.equal(runs[1].text.link.url, 'http://x')
  assert.deepEqual(runs[3].annotations, { bold: true })
})

test('code spans keep their contents literal', () => {
  const runs = parseInline('`const a = **not bold**`')
  assert.equal(runs.length, 1)
  assert.equal(runs[0].text.content, 'const a = **not bold**')
  assert.deepEqual(runs[0].annotations, { code: true })
})

test('to-do beats bullet, and checked state is read', () => {
  const blocks = markdownToBlocks('- [ ] open\n- [x] done\n- plain')
  assert.deepEqual(typesOf(blocks), ['to_do', 'to_do', 'bulleted_list_item'])
  assert.equal(blocks[0].to_do.checked, false)
  assert.equal(blocks[1].to_do.checked, true)
  assert.equal(plain(blocks[0].to_do.rich_text), 'open')
})

test('numbered lists are numbered lists', () => {
  assert.deepEqual(typesOf(markdownToBlocks('1. first\n2) second')),
    ['numbered_list_item', 'numbered_list_item'])
})

test('headings deeper than 3 clamp to heading_3 (REST has no heading_4)', () => {
  assert.deepEqual(typesOf(markdownToBlocks('#### deep\n##### deeper')),
    ['heading_3', 'heading_3'])
})

test('fenced code becomes one code block with its language', () => {
  const blocks = markdownToBlocks('```js\nconst a = 1\nconst b = 2\n```')
  assert.deepEqual(typesOf(blocks), ['code'])
  assert.equal(blocks[0].code.language, 'js')
  assert.equal(plain(blocks[0].code.rich_text), 'const a = 1\nconst b = 2')
})

test('an unclosed fence does not swallow the rest as one block silently losing structure', () => {
  const blocks = markdownToBlocks('```\nunterminated')
  assert.deepEqual(typesOf(blocks), ['code'])
  assert.equal(plain(blocks[0].code.rich_text), 'unterminated')
})

test('the whole reported page shape converts to real blocks', () => {
  const md = [
    '## Overview',
    '> Goal: Replace sash lifter (Marvin calls these **balance tubes**) hardware.',
    '',
    '### Details',
    '- **Last Updated:** 8/16/2026',
    '',
    '## Action Items',
    '- [ ] Confirm part numbers',
    '',
    '---',
    '## Reference',
  ].join('\n')
  assert.deepEqual(typesOf(markdownToBlocks(md)), [
    'heading_2', 'quote', 'paragraph',
    'heading_3', 'bulleted_list_item', 'paragraph',
    'heading_2', 'to_do', 'paragraph',
    'divider', 'heading_2',
  ])
  // and nothing anywhere still carries raw markdown punctuation
  const all = markdownToBlocks(md)
    .flatMap(b => b[b.type].rich_text || [])
    .map(r => r.text.content).join(' ')
  assert.ok(!all.includes('**'), 'no literal bold markers survive')
  assert.ok(!all.includes('###'), 'no literal heading markers survive')
})

test('empty and malformed input do not throw', () => {
  assert.deepEqual(markdownToBlocks(''), [])
  assert.deepEqual(markdownToBlocks(null), [])
  assert.deepEqual(parseInline(null), [])
  assert.deepEqual(parseInline(''), [])
})

test('a blank line is an empty paragraph, and empty runs are dropped', () => {
  const [b] = markdownToBlocks('   ')
  assert.equal(b.type, 'paragraph')
  assert.deepEqual(b.paragraph.rich_text, [])
})
