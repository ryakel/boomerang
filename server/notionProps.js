// notionProps.js — the argument shapes the hosted Notion MCP tools actually
// accept. Pure: no db, no network, no MCP client. Tested in
// scripts/notionProps.test.mjs.
//
// WHY THIS IS ITS OWN MODULE
//
// `notion-create-pages` and `notion-update-page` take the SAME property
// shape — a flat JSON map of property names to "SQLite values"
// (string | number | string[] | null) — and they have drifted apart twice.
// The create path was converted to flat values on 2026-05-24; the update path
// was not, and kept building Notion REST property OBJECTS
// ({title:[{text:{content}}]}, {select:{name}}, {multi_select:[…]}) while also
// omitting the REQUIRED `command` field. Every property update in the app
// failed validation for ~3 months with:
//
//   command: Invalid option: expected one of "update_properties"|…,
//   properties.Name: Invalid input
//
// reported from Quokka on 2026-08-11. Both callers now build their arguments
// here, so a future schema change lands in one place and the two cannot
// disagree again.
//
// CLAUDE.md rule: never guess these. The shapes below were read off the live
// hosted tool schemas at mcp.notion.com, not inferred.

/** The `command` values `notion-update-page` accepts, per its live schema. */
export const UPDATE_COMMANDS = [
  'update_properties', 'update_content', 'replace_content',
  'insert_content', 'apply_template', 'update_verification',
]

/**
 * "Name: value" lines → a flat property map.
 * The line format is what knowledgeSync and the /api/notion/pages route speak.
 */
export function textToPlainProperties(text) {
  const props = {}
  for (const line of String(text || '').split('\n')) {
    const idx = line.indexOf(':')
    if (idx < 0) continue
    const key = line.slice(0, idx).trim()
    const val = line.slice(idx + 1).trim()
    if (!key || !val) continue
    props[key] = val
  }
  return props
}

/**
 * Any property map → flat SQLite values.
 *
 * Accepts already-flat values untouched and unwraps Notion REST property
 * objects, because callers have handed us both shapes for years and a
 * silently-wrong payload is exactly what this module exists to prevent.
 */
export function flattenToPlainValues(map) {
  const props = {}
  for (const [key, val] of Object.entries(map || {})) {
    if (val === undefined || val === null) continue
    if (typeof val === 'string' || typeof val === 'number') { props[key] = val; continue }
    if (Array.isArray(val)) { props[key] = val.map(v => String(v)); continue }
    if (val?.title?.[0]?.text?.content) { props[key] = val.title[0].text.content; continue }
    if (val?.select?.name) { props[key] = val.select.name; continue }
    if (val?.multi_select) { props[key] = val.multi_select.map(s => s.name).join(', '); continue }
    if (val?.rich_text?.[0]?.text?.content) { props[key] = val.rich_text[0].text.content; continue }
    props[key] = String(val)
  }
  return props
}

/** Normalize either accepted input shape to a flat map. */
export function toPlainProperties(properties) {
  if (properties == null) return null
  return typeof properties === 'string'
    ? textToPlainProperties(properties)
    : flattenToPlainValues(properties)
}

/**
 * Arguments for `notion-update-page`, or null when there is nothing to send.
 *
 * Returns null for an empty property map rather than an argument object:
 * `properties` is REQUIRED by the update_properties command, so a
 * content-only update must not issue the command at all — sending it bare
 * fails validation for the mirror-image reason the old code failed.
 */
export function buildUpdatePageArgs({ pageId, properties }) {
  const props = toPlainProperties(properties)
  if (!props || Object.keys(props).length === 0) return null
  return { page_id: pageId, command: 'update_properties', properties: props }
}
