import assert from 'node:assert/strict'
import test from 'node:test'
import { parseCodeGraphQuery } from '../src/main/codegraph-query.ts'

test('code query bridge accepts bounded literal searches and graph walks only', () => {
  assert.deepEqual(parseCodeGraphQuery({ type: 'search', query: 'x%_' }), {
    type: 'search',
    query: 'x%_',
    limit: 20,
    offset: 0,
  })
  assert.deepEqual(
    parseCodeGraphQuery({ type: 'trace', symbolId: 'a::x', direction: 'both', depth: 2, limit: 8 }),
    { type: 'trace', symbolId: 'a::x', direction: 'both', depth: 2, limit: 8 },
  )
  for (const value of [
    null,
    [],
    { type: 'sql', query: 'DELETE' },
    { type: 'search', query: 'x', limit: 101 },
    { type: 'search', query: 'x', offset: -1 },
    { type: 'search', query: 'x'.repeat(257) },
    { type: 'trace', symbolId: 'x', direction: 'all' },
    { type: 'trace', symbolId: 'x', direction: 'inbound', depth: 11 },
    { type: 'trace', symbolId: 'x', direction: 'both', limit: 501 },
  ])
    assert.throws(() => parseCodeGraphQuery(value))
})
