import type { CodeGraphQuery } from '../shared/codegraph.ts'

/** Narrow, bounded queries only; no query language or filesystem primitive crosses IPC. */
export function parseCodeGraphQuery(input: unknown): CodeGraphQuery {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('Invalid code query.')
  const query = input as Record<string, unknown>
  const integer = (name: string, fallback: number, maximum: number, minimum = 1): number => {
    const value = query[name] ?? fallback
    if (
      typeof value !== 'number' ||
      !Number.isSafeInteger(value) ||
      value < minimum ||
      value > maximum
    )
      throw new Error(`Invalid code query ${name}.`)
    return value
  }
  if (query.type === 'search') {
    if (typeof query.query !== 'string' || query.query.length > 256)
      throw new Error('Search up to 256 characters.')
    return {
      type: 'search',
      query: query.query,
      limit: integer('limit', 20, 100),
      offset: integer('offset', 0, 100_000, 0),
    }
  }
  if (query.type === 'trace') {
    if (
      typeof query.symbolId !== 'string' ||
      !query.symbolId ||
      query.symbolId.length > 32_768 ||
      !['inbound', 'outbound', 'both'].includes(String(query.direction))
    )
      throw new Error('Choose a symbol and call direction.')
    return {
      type: 'trace',
      symbolId: query.symbolId,
      direction: query.direction as 'inbound' | 'outbound' | 'both',
      depth: integer('depth', 1, 10),
      limit: integer('limit', 100, 500),
    }
  }
  throw new Error('Unknown code query.')
}
