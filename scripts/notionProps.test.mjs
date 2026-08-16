import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildUpdatePageArgs, toPlainProperties,
  textToPlainProperties, flattenToPlainValues, UPDATE_COMMANDS,
} from '../server/notionProps.js'

// The bug these pin (2026-08-11, reported from Quokka):
//
//   Input validation error: Invalid arguments for tool notion-update-page:
//   command: Invalid option: expected one of "update_properties"|…,
//   properties.Name: Invalid input
//
// updatePage() sent no `command` (it is REQUIRED) and Notion REST property
// OBJECTS where the tool wants flat "SQLite values". The create path had been
// converted to flat values in May; the update path never was. Both now build
// their args here so they cannot drift apart a third time.
//
// Shapes below were read off the LIVE hosted tool schema at mcp.notion.com,
// per CLAUDE.md's "never guess Notion params" rule.

// A flat SQLite value: string | number | string[] | null.
const isPlainValue = (v) => (
  typeof v === 'string' || typeof v === 'number' || v === null
  || (Array.isArray(v) && v.every(x => typeof x === 'string'))
)

test('THE REGRESSION: the update args carry a valid command', () => {
  const args = buildUpdatePageArgs({ pageId: 'abc', properties: 'Name: Cinnamon rolls' })
  assert.equal(args.command, 'update_properties')
  assert.ok(UPDATE_COMMANDS.includes(args.command))
})

test('THE REGRESSION: every property value is flat, never a REST object', () => {
  const args = buildUpdatePageArgs({
    pageId: 'abc',
    properties: 'Name: Annie\'s cinnamon rolls\nType: How-to\nTags: baking, family\nConfidence: Certain',
  })
  for (const [k, v] of Object.entries(args.properties)) {
    assert.ok(isPlainValue(v), `${k} must be a flat SQLite value, got ${JSON.stringify(v)}`)
  }
  assert.equal(args.properties.Name, "Annie's cinnamon rolls")
  assert.equal(args.properties.Type, 'How-to')
})

test('a Notion REST property object is unwrapped, not passed through', () => {
  // The exact shape the old code built and the tool rejected.
  const args = buildUpdatePageArgs({
    pageId: 'abc',
    properties: {
      Name: { title: [{ text: { content: 'Thermostat schedule' } }] },
      Type: { select: { name: 'How-to' } },
      Tags: { multi_select: [{ name: 'hvac' }, { name: 'winter' }] },
      Notes: { rich_text: [{ text: { content: 'hold at 68' } }] },
    },
  })
  assert.deepEqual(args.properties, {
    Name: 'Thermostat schedule',
    Type: 'How-to',
    Tags: 'hvac, winter',
    Notes: 'hold at 68',
  })
  for (const v of Object.values(args.properties)) assert.ok(isPlainValue(v))
})

test('page_id is passed through as given', () => {
  assert.equal(buildUpdatePageArgs({ pageId: 'p-1', properties: 'Name: x' }).page_id, 'p-1')
})

test('nothing to update returns null so no bare command is sent', () => {
  // `properties` is REQUIRED by update_properties, so a content-only edit must
  // not issue the command at all — sending it bare fails validation for the
  // mirror image of the original reason.
  assert.equal(buildUpdatePageArgs({ pageId: 'abc', properties: undefined }), null)
  assert.equal(buildUpdatePageArgs({ pageId: 'abc', properties: null }), null)
  assert.equal(buildUpdatePageArgs({ pageId: 'abc', properties: '' }), null)
  assert.equal(buildUpdatePageArgs({ pageId: 'abc', properties: {} }), null)
  // Lines with no value contribute nothing, so they must not mint an empty call.
  assert.equal(buildUpdatePageArgs({ pageId: 'abc', properties: 'Name:\nType:' }), null)
})

test('numbers stay numbers and arrays stay string arrays', () => {
  // The schema accepts both; stringifying a number would be a silent type change.
  const props = flattenToPlainValues({ Count: 3, Tags: ['a', 'b'] })
  assert.equal(props.Count, 3)
  assert.deepEqual(props.Tags, ['a', 'b'])
  assert.ok(isPlainValue(props.Count) && isPlainValue(props.Tags))
})

test('null and undefined values are dropped rather than sent as "null"', () => {
  assert.deepEqual(flattenToPlainValues({ A: null, B: undefined, C: 'keep' }), { C: 'keep' })
})

test('the text form keeps colons inside the value', () => {
  // "Name: Repair: the deck" must not lose everything after the second colon.
  assert.deepEqual(textToPlainProperties('Name: Repair: the deck'), { Name: 'Repair: the deck' })
})

test('the text form ignores blank and malformed lines', () => {
  assert.deepEqual(textToPlainProperties('Name: x\n\nnocolon\nType: y'), { Name: 'x', Type: 'y' })
})

test('toPlainProperties accepts both shapes and null', () => {
  assert.deepEqual(toPlainProperties('Name: x'), { Name: 'x' })
  assert.deepEqual(toPlainProperties({ Name: 'x' }), { Name: 'x' })
  assert.equal(toPlainProperties(null), null)
})

test('malformed input does not throw', () => {
  assert.deepEqual(flattenToPlainValues(null), {})
  assert.deepEqual(textToPlainProperties(null), {})
})
