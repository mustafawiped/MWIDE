import assert from 'node:assert/strict'
import test from 'node:test'
import type {
  CatalogItem,
  ChatMessage,
  Conversation,
  Project,
  WorkspaceState,
} from '../src/shared/contracts.ts'
import {
  buildContext,
  contextInputBytes,
  parseRecommendations,
  parseSummary,
  summaryBoundary,
  summaryRequest,
} from '../src/core/memory.ts'

const timestamp = '2026-10-22T12:00:00.000Z'

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: 'project-main',
    name: 'Memory test project',
    description: 'Complete project purpose',
    architecture: 'Canonical architecture',
    rules: 'User-authored rules',
    catalogIds: ['skill-selected'],
    createdAt: timestamp,
    ...overrides,
  }
}

function messages(prefix: string, pairs: number): ChatMessage[] {
  return Array.from({ length: pairs * 2 }, (_, index) => ({
    id: `${prefix}-${index}`,
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: `${prefix}_MESSAGE_${index}`,
    createdAt: timestamp,
    status: 'complete',
  }))
}

function conversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: 'chat-current',
    projectId: 'project-main',
    title: 'Current conversation',
    createdAt: timestamp,
    messages: messages('CURRENT', 3),
    summary: '',
    summaryThrough: 0,
    ...overrides,
  }
}

const catalog: CatalogItem[] = [
  {
    id: 'skill-selected',
    kind: 'skill',
    name: 'Selected skill',
    description: 'Useful selected instructions',
    instructions: 'SELECTED_INSTRUCTIONS: preserve complete architecture 🧭',
  },
  {
    id: 'mcp-unselected',
    kind: 'mcp',
    name: 'Unselected MCP',
    description: 'Not selected for this project',
    instructions: 'UNSELECTED_INSTRUCTIONS_MUST_NOT_APPEAR',
  },
]

function workspace(
  main: Project,
  conversations: Conversation[],
  otherProjects: Project[] = [],
): WorkspaceState {
  return {
    settings: {
      defaultProvider: 'ollama',
      codexModel: '',
      ollamaUrl: 'http://localhost:11434',
      ollamaModel: 'test-model',
    },
    catalog: structuredClone(catalog),
    projects: [main, ...otherProjects],
    conversations,
  }
}

function contextText(context: ReturnType<typeof buildContext>): string {
  return [context.instructions, ...context.messages.map((item) => item.content)].join('\n')
}

test('every context preserves complete long Unicode canonical fields and selected instructions', () => {
  const main = project({
    description: `PURPOSE_START\n${'İstanbul 中文 🧭 complete purpose\n'.repeat(180)}PURPOSE_END`,
    architecture: `ARCH_START\n${'Boundary → adapter → storage\n'.repeat(100)}ARCH_END`,
    rules: `RULES_START\n${'Never shorten user-authored canonical records.\n'.repeat(60)}RULES_END`,
  })
  const current = conversation()
  const state = workspace(main, [current])
  const snapshot = structuredClone(state)

  const context = buildContext(state, current)

  for (const canonical of [
    main.description,
    main.architecture,
    main.rules,
    catalog[0].instructions,
  ]) {
    assert.ok(
      context.instructions.includes(canonical),
      'canonical content must be included verbatim',
    )
  }
  assert.ok(!contextText(context).includes(catalog[1].instructions))
  assert.deepEqual(state, snapshot, 'context construction must not modify persisted input')
})

test('input budgets count UTF-8 bytes and escaped JSON framing rather than character length', () => {
  const context = {
    instructions: 'Canonical 中文 🧭 "quoted" \\path\nnext',
    messages: [{ role: 'user' as const, content: 'İstanbul 🧭\n"continue"' }],
  }
  const envelope = JSON.stringify([
    { role: 'system', content: context.instructions },
    ...context.messages,
  ])
  assert.ok(Buffer.byteLength(envelope, 'utf8') > envelope.length)
  assert.equal(contextInputBytes(context), Buffer.byteLength(envelope, 'utf8') + 64 + 512)
})

test('context includes every same-project summary and stale tail without leaking another project', () => {
  const main = project()
  const current = conversation({ summary: 'CURRENT_COMPACT_SUMMARY', summaryThrough: 2 })
  const stale = conversation({
    id: 'chat-stale',
    messages: messages('STALE', 2),
    summary: 'OTHER_CHAT_SUMMARY',
    summaryThrough: 2,
  })
  const unsummarized = conversation({
    id: 'chat-unsummarized',
    messages: messages('UNSUMMARIZED', 1),
  })
  const fullySummarized = conversation({
    id: 'chat-fully-summarized',
    messages: messages('FULLY_COVERED', 1),
    summary: 'FULLY_COVERED_SUMMARY',
    summaryThrough: 2,
  })
  const foreignProject = project({
    id: 'project-foreign',
    description: 'FOREIGN_PURPOSE_MUST_NOT_APPEAR',
    architecture: 'FOREIGN_ARCHITECTURE_MUST_NOT_APPEAR',
  })
  const foreign = conversation({
    id: 'chat-foreign',
    projectId: foreignProject.id,
    summary: 'FOREIGN_SUMMARY_MUST_NOT_APPEAR',
    messages: messages('FOREIGN_MESSAGES', 1),
  })
  const state = workspace(
    main,
    [current, stale, unsummarized, fullySummarized, foreign],
    [foreignProject],
  )
  const text = contextText(buildContext(state, current))

  for (const included of [
    current.summary,
    stale.summary,
    fullySummarized.summary,
    ...current.messages.slice(2).map((item) => item.content),
    ...stale.messages.slice(2).map((item) => item.content),
    ...unsummarized.messages.map((item) => item.content),
  ]) {
    assert.ok(text.includes(included), `missing context: ${included}`)
  }
  for (const excluded of [
    current.messages[0].content,
    stale.messages[0].content,
    ...fullySummarized.messages.map((item) => item.content),
    foreignProject.description,
    foreignProject.architecture,
    foreign.summary,
    ...foreign.messages.map((item) => item.content),
  ]) {
    assert.ok(!text.includes(excluded), `unexpected context: ${excluded}`)
  }
})

test('unknown architecture is explicit and failed or interrupted content is marked as incomplete', () => {
  const main = project({ architecture: '' })
  const current = conversation({ messages: messages('PARTIAL_CURRENT', 1) })
  current.messages[1].status = 'interrupted'
  const failed = conversation({ id: 'chat-failed', messages: messages('FAILED_OTHER', 1) })
  failed.messages[1].status = 'failed'
  const context = buildContext(workspace(main, [current, failed]), current)
  const text = contextText(context)

  assert.match(context.instructions, /Not decided/i)
  assert.ok(text.includes(current.messages[1].content))
  assert.ok(text.includes(failed.messages[1].content))
  assert.match(text, /interrupted|partial|incomplete/i)
  assert.match(text, /failed|unsuccessful/i)
})

test('automatic summary boundaries retain the last two complete pairs', () => {
  assert.equal(summaryBoundary(conversation({ messages: [] }), 4), 0)
  assert.equal(summaryBoundary(conversation({ messages: messages('SHORT', 1) }), 4), 0)
  assert.equal(summaryBoundary(conversation({ messages: messages('EXACT', 2) }), 4), 0)
  assert.equal(summaryBoundary(conversation({ messages: messages('THREE', 3) }), 4), 2)
  assert.equal(summaryBoundary(conversation({ messages: messages('FOUR', 4) }), 4), 4)
})

test('full compaction boundaries include complete pairs and exclude a trailing unpaired message', () => {
  const current = conversation({ messages: messages('FULL_COMPACTION', 3) })
  assert.equal(summaryBoundary(current, 0), 6)
  current.messages.push({
    id: 'unpaired-user',
    role: 'user',
    content: 'Still awaiting an assistant response',
    createdAt: timestamp,
    status: 'complete',
  })
  assert.equal(summaryBoundary(current, 0), 6)
})

test('automatic boundaries never move behind already committed memory', () => {
  const current = conversation({
    messages: messages('ALREADY_SUMMARIZED', 4),
    summary: 'Committed memory',
    summaryThrough: 6,
  })
  assert.equal(summaryBoundary(current, 4), 6)
})

test('summary requests include the requested prefix and preserve canonical input', () => {
  const main = project({ description: 'Exact purpose 中文 🧭', architecture: 'Exact architecture' })
  const current = conversation({ messages: messages('PREFIX', 4) })
  const snapshot = structuredClone({ main, current })
  const request = summaryRequest(main, current, 4)
  const text = [request.instructions, ...request.messages.map((item) => item.content)].join('\n')

  for (const canonical of [main.description, main.architecture, main.rules]) {
    assert.ok(request.instructions.includes(canonical))
  }
  for (const item of current.messages.slice(0, 4)) assert.ok(text.includes(item.content))
  for (const item of current.messages.slice(4)) assert.ok(!text.includes(item.content))
  assert.deepEqual({ main, current }, snapshot)
})

test('incremental summary requests merge committed memory with only the uncovered prefix', () => {
  const main = project()
  const current = conversation({
    messages: messages('INCREMENTAL', 4),
    summary: 'Previously rejected option must remain rejected.',
    summaryThrough: 2,
  })
  current.messages[3].status = 'failed'
  const request = summaryRequest(main, current, 4)
  const text = [request.instructions, ...request.messages.map((item) => item.content)].join('\n')

  assert.ok(text.includes(current.summary))
  assert.ok(text.includes(current.messages[2].content))
  assert.ok(text.includes(current.messages[3].content))
  assert.match(text, /failed/)
  assert.ok(!text.includes(current.messages[0].content))
  assert.ok(!text.includes(current.messages[4].content))
  for (const through of [-1, 1, 2.5, 9]) {
    assert.throws(() => summaryRequest(main, current, through))
  }
})

test('summary parsing trims valid text and rejects empty or oversized output without truncation', () => {
  assert.equal(parseSummary('  A compact decision summary 🧭\n'), 'A compact decision summary 🧭')
  assert.equal(parseSummary('x'.repeat(1600)), 'x'.repeat(1600))
  assert.throws(() => parseSummary(''))
  assert.throws(() => parseSummary(' \n\t '))
  assert.throws(() => parseSummary('x'.repeat(1601)))
})

test('summary limits conservatively count UTF-16 characters without cutting Unicode output', () => {
  const valid = '🧭'.repeat(800)
  assert.equal(valid.length, 1600)
  assert.equal(parseSummary(valid), valid)
  assert.throws(() => parseSummary('🧭'.repeat(801)))
})

test('recommendation parsing accepts only catalog IDs in a JSON array or fenced JSON array', () => {
  const expected = [{ id: catalog[0].id, reason: 'Relevant to the project architecture.' }]
  assert.deepEqual(parseRecommendations(JSON.stringify(expected), catalog), expected)
  assert.deepEqual(
    parseRecommendations(`\n\`\`\`json\n${JSON.stringify(expected)}\n\`\`\`\n`, catalog),
    expected,
  )
  assert.deepEqual(parseRecommendations('[]', catalog), [])
  assert.throws(() => parseRecommendations('not JSON', catalog))
  assert.throws(() => parseRecommendations('{"recommendations":[]}', catalog))
  assert.throws(() => parseRecommendations('Here is my answer: []', catalog))
  assert.throws(() =>
    parseRecommendations('[{"id":"unknown-id","reason":"Looks useful"}]', catalog),
  )
  assert.throws(() => parseRecommendations(JSON.stringify([...expected, ...expected]), catalog))
})

test('recommendation reasons must contain between one and 320 meaningful characters', () => {
  for (const reason of ['', '   ', 'x'.repeat(321), null, 42]) {
    assert.throws(() =>
      parseRecommendations(JSON.stringify([{ id: catalog[0].id, reason }]), catalog),
    )
  }
  const maximum = [{ id: catalog[0].id, reason: 'x'.repeat(320) }]
  assert.deepEqual(parseRecommendations(JSON.stringify(maximum), catalog), maximum)
})
