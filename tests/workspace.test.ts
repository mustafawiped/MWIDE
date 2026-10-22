import assert from 'node:assert/strict'
import test from 'node:test'
import { WorkspaceService } from '../src/core/workspace.ts'
import type { WorkspaceRepository } from '../src/core/workspace.ts'
import { initialState, assertWorkspaceState } from '../src/core/validation.ts'
import type { GenerationRequest, ModelProvider } from '../src/core/model.ts'
import type { ChatEvent, Conversation, WorkspaceState } from '../src/shared/contracts.ts'
import { contextInputBytes } from '../src/core/memory.ts'

const brief = {
  name: 'MWIDE test',
  description: 'Preserve this entire project purpose 🧭',
  architecture: 'React UI, isolated adapters, canonical context.',
  rules: 'No shortcuts.',
  catalogIds: [],
}

class MemoryStore implements WorkspaceRepository {
  state = initialState()
  snapshot(): WorkspaceState {
    return structuredClone(this.state)
  }
  async update(change: (state: WorkspaceState) => void): Promise<WorkspaceState> {
    const next = this.snapshot()
    change(next)
    assertWorkspaceState(next)
    this.state = structuredClone(next)
    return this.snapshot()
  }
}

function setup(
  readFolder?: (path: string, signal: AbortSignal, maximumBytes?: number) => Promise<string>,
) {
  const store = new MemoryStore()
  store.state.settings = {
    ...store.state.settings,
    defaultProvider: 'ollama',
    ollamaModel: 'test-model',
  }
  const requests: GenerationRequest[] = []
  const events: ChatEvent[] = []
  let behavior: (request: GenerationRequest) => Promise<string> = async (request) => {
    if (request.instructions.includes('Update a compact conversation memory'))
      return 'Decision: keep focused modules. Next: test the integration.'
    request.onDelta?.('Hello')
    return 'Hello'
  }
  const provider: ModelProvider = {
    inspect: async () => ({
      id: 'ollama',
      connected: true,
      detail: 'Ready',
      models: ['test-model'],
    }),
    generate: async (request) => {
      requests.push(request)
      return behavior(request)
    },
  }
  const service = new WorkspaceService(
    store,
    () => provider,
    (event) => events.push(event),
    readFolder,
  )
  return {
    store,
    requests,
    events,
    provider,
    service,
    setBehavior: (next: typeof behavior) => {
      behavior = next
    },
  }
}

async function newChat(fixture: ReturnType<typeof setup>) {
  const state = await fixture.service.createProject(brief)
  const project = state.projects[0]
  const next = await fixture.service.createConversation(project.id)
  return { project, conversation: next.conversations[0] }
}

function appendHistory(conversation: Conversation, prefix: string, lengths: number[]): void {
  for (const [index, length] of lengths.entries())
    conversation.messages.push({
      id: `${prefix}-${index}`,
      role: index % 2 ? 'assistant' : 'user',
      content: `${prefix}: ${'İ🧭x'.repeat(length)}`,
      createdAt: conversation.createdAt,
      status: 'complete',
    })
}

function enforceProviderBudget(fixture: ReturnType<typeof setup>, budget: number): number[] {
  const inputBytes: number[] = []
  fixture.provider.getInputBudget = async () => budget
  fixture.setBehavior(async (request) => {
    const bytes =
      Buffer.byteLength(
        JSON.stringify([{ role: 'system', content: request.instructions }, ...request.messages]),
        'utf8',
      ) +
      request.messages.length * 64 +
      512
    assert.ok(bytes <= budget, `Provider rejected ${bytes} bytes; declared budget is ${budget}`)
    inputBytes.push(bytes)
    for (const canonical of [brief.description, brief.architecture, brief.rules])
      assert.ok(request.instructions.includes(canonical))
    return request.instructions.includes('Update a compact conversation memory')
      ? 'FIXTURE_DECISION: retain adapter boundaries. FIXTURE_FAILURE: deployment failed; retry pending.'
      : 'Continue with the recorded decision and unresolved failure.'
  })
  return inputBytes
}

test('projects and user catalog selections persist without modifying canonical context', async () => {
  const fixture = setup()
  const catalog = await fixture.service.saveCatalogItem({
    kind: 'skill',
    name: 'Tests',
    description: 'Testing guidance',
    instructions: 'Test behavior.',
  })
  const selected = { ...brief, catalogIds: [catalog.catalog[0].id] }
  const created = await fixture.service.createProject(selected)
  assert.deepEqual(
    { ...created.projects[0], id: undefined, createdAt: undefined },
    { ...selected, id: undefined, createdAt: undefined },
  )
  const removed = await fixture.service.removeCatalogItem(catalog.catalog[0].id)
  assert.deepEqual(removed.projects[0].catalogIds, [])
  assert.equal(removed.projects[0].architecture, brief.architecture)
  await assert.rejects(fixture.service.createProject({ ...brief, catalogIds: ['missing'] }))
})

test('recommendations use the chosen model and reject invented catalog entries without changing state', async () => {
  const fixture = setup()
  assert.deepEqual(await fixture.service.recommend(brief), [])
  assert.equal(fixture.requests.length, 0)
  const state = await fixture.service.saveCatalogItem({
    kind: 'skill',
    name: 'Tests',
    description: 'Testing',
    instructions: 'Test behavior.',
  })
  const id = state.catalog[0].id
  fixture.setBehavior(async () => JSON.stringify([{ id, reason: 'Matches the project.' }]))
  assert.deepEqual(await fixture.service.recommend(brief), [{ id, reason: 'Matches the project.' }])
  assert.equal(fixture.requests[0].model, 'test-model')
  assert.ok(fixture.requests[0].instructions.includes(brief.description))
  fixture.setBehavior(async () => '[{"id":"invented","reason":"Invalid"}]')
  await assert.rejects(fixture.service.recommend(brief), /catalog/)
  assert.deepEqual(fixture.store.snapshot(), state)
})

test('streamed answers are saved once with complete canonical context', async () => {
  const fixture = setup()
  const { conversation } = await newChat(fixture)
  const result = await fixture.service.sendMessage({
    conversationId: conversation.id,
    content: 'Start the project',
  })
  assert.equal(result.conversations[0].messages.length, 2)
  assert.equal(result.conversations[0].messages[1].content, 'Hello')
  assert.equal(result.conversations[0].messages[1].status, 'complete')
  assert.ok(fixture.requests[0].instructions.includes(brief.description))
  assert.ok(fixture.requests[0].instructions.includes(brief.architecture))
  assert.ok(fixture.requests[0].instructions.includes(brief.rules))
  assert.deepEqual(fixture.requests[0].messages, [{ role: 'user', content: 'Start the project' }])
  assert.equal(fixture.events.filter((event) => event.type === 'delta').length, 1)
  const delta = fixture.events.find((event) => event.type === 'delta')!
  assert.equal(delta.replyId, result.conversations[0].messages[1].id)
})

test('failure before acceptance preserves the draft and adds no messages', async () => {
  const fixture = setup()
  const { conversation } = await newChat(fixture)
  fixture.provider.inspect = async () => ({
    id: 'ollama',
    connected: false,
    detail: 'Not running',
    models: [],
  })
  await assert.rejects(
    fixture.service.sendMessage({ conversationId: conversation.id, content: 'Hello' }),
    /Not running/,
  )
  assert.equal(fixture.store.snapshot().conversations[0].messages.length, 0)
})

test('failure after acceptance returns saved state and keeps partial output marked failed', async () => {
  const fixture = setup()
  const { conversation } = await newChat(fixture)
  fixture.setBehavior(async (request) => {
    request.onDelta?.('Partial')
    throw new Error('Network failed')
  })
  const state = await fixture.service.sendMessage({
    conversationId: conversation.id,
    content: 'Hello',
  })
  assert.equal(state.conversations[0].messages.length, 2)
  assert.equal(state.conversations[0].messages[1].content, 'Partial')
  assert.equal(state.conversations[0].messages[1].status, 'failed')
  assert.ok(
    fixture.events.some(
      (event) => event.type === 'error' && event.message.includes('Network failed'),
    ),
  )
})

test('cancellation saves a terminal interrupted response and releases the operation lock', async () => {
  const fixture = setup()
  const { conversation } = await newChat(fixture)
  let began!: () => void
  const ready = new Promise<void>((resolve) => {
    began = resolve
  })
  fixture.setBehavior(
    (request) =>
      new Promise((_resolve, reject) => {
        request.onDelta?.('Partial text')
        request.signal.addEventListener(
          'abort',
          () => reject(new DOMException('Stopped', 'AbortError')),
          { once: true },
        )
        began()
      }),
  )
  const running = fixture.service.sendMessage({ conversationId: conversation.id, content: 'Hello' })
  await ready
  await assert.rejects(fixture.service.createProject(brief), /operation is running/)
  await fixture.service.cancelMessage(conversation.id)
  const state = await running
  assert.equal(state.conversations[0].messages[1].status, 'interrupted')
  assert.equal(state.conversations[0].messages[1].content, 'Partial text')
  await fixture.service.saveSettings(state.settings)
})

test('short chat handoffs keep exact history without a summary request', async () => {
  const fixture = setup()
  const bytes = enforceProviderBudget(fixture, 9000)
  const { project, conversation } = await newChat(fixture)
  await fixture.service.sendMessage({
    conversationId: conversation.id,
    content: 'Remember the architecture decision',
  })
  const state = await fixture.service.createConversation(project.id)
  assert.equal(state.conversations.length, 2)
  assert.equal(state.conversations[0].summaryThrough, 0)
  assert.equal(state.conversations[0].summary, '')
  assert.equal(fixture.requests.length, 1, 'creating a chat does not call the model')
  await fixture.service.sendMessage({
    conversationId: state.conversations[1].id,
    content: 'Continue in a new chat',
  })
  const request = fixture.requests.at(-1)!
  assert.equal(fixture.requests.length, 2, 'one generation per user prompt, with no compaction')
  assert.ok(request.instructions.includes('Remember the architecture decision'))
  assert.ok(request.instructions.includes('Continue with the recorded decision'))
  assert.equal(bytes.length, 2)
  assert.ok(bytes.reduce((total, value) => total + value, 0) > 0)
  assert.ok(request.instructions.includes(brief.description))
  assert.ok(request.instructions.includes(brief.architecture))
  assert.equal(fixture.store.snapshot().projects[0].architecture, project.architecture)
})

test('short project histories preserve decisions and failed work verbatim without leaking another project', async () => {
  const fixture = setup()
  const { project } = await newChat(fixture)
  const first = fixture.store.state.conversations[0]
  appendHistory(first, 'EXACT_DECISION: keep adapters separate', [1, 1])
  first.messages[1].status = 'failed'
  first.messages[1].content = 'EXACT_FAILURE: deployment failed; keep retry pending.'
  await fixture.service.createConversation(project.id)
  const second = fixture.store.state.conversations[1]
  appendHistory(second, 'SECOND_EXACT_RECORD', [1, 1])
  second.summary = 'Existing memory must remain present.'
  const foreign = await fixture.service.createProject({
    ...brief,
    name: 'Other project',
    description: 'FOREIGN_CANONICAL_SECRET',
  })
  await fixture.service.createConversation(foreign.projects[1].id)
  appendHistory(fixture.store.state.conversations[2], 'FOREIGN_HISTORY_SECRET', [80, 80])
  await fixture.service.createConversation(project.id)
  const before = fixture.store.snapshot()
  const bytes = enforceProviderBudget(fixture, 9000)

  await fixture.service.sendMessage({
    conversationId: before.conversations[3].id,
    content: 'Continue this project 🧭',
  })

  assert.equal(fixture.requests.length, 1)
  assert.equal(bytes.length, 1)
  const request = fixture.requests[0]
  for (const text of [
    ...before.conversations[0].messages.map((message) => message.content),
    ...before.conversations[1].messages.map((message) => message.content),
    second.summary,
  ])
    assert.ok(request.instructions.includes(text))
  assert.match(request.instructions, /failed response; do not treat as completed work/)
  assert.ok(!request.instructions.includes('FOREIGN_'))
  for (let index = 0; index < 3; index++)
    assert.deepEqual(fixture.store.state.conversations[index], before.conversations[index])
})

test('budget pressure compacts the largest archive first and preserves recent active pairs and small histories', async () => {
  const fixture = setup()
  const { project } = await newChat(fixture)
  const largest = fixture.store.state.conversations[0]
  appendHistory(largest, 'LARGEST_ARCHIVE', [110, 110, 110, 110, 110, 110, 110, 110])
  largest.messages[1].status = 'failed'
  await fixture.service.createConversation(project.id)
  appendHistory(fixture.store.state.conversations[1], 'SMALL_ARCHIVE', [5, 5])
  await fixture.service.createConversation(project.id)
  appendHistory(fixture.store.state.conversations[2], 'ACTIVE_RECENT_PAIR', [10, 10, 10, 10])
  const before = fixture.store.snapshot()
  const bytes = enforceProviderBudget(fixture, 5000)

  await fixture.service.sendMessage({
    conversationId: before.conversations[2].id,
    content: 'Continue with decisions and failures',
  })

  const summaries = fixture.requests.filter((request) =>
    request.instructions.includes('Update a compact conversation memory'),
  )
  const replies = fixture.requests.filter((request) => request.onDelta)
  assert.ok(summaries.length >= 1)
  assert.equal(replies.length, 1)
  assert.ok(summaries[0].messages[0].content.includes('LARGEST_ARCHIVE'))
  assert.ok(!summaries[0].messages[0].content.includes('SMALL_ARCHIVE'))
  assert.equal(fixture.store.state.conversations[0].summaryThrough, 8)
  assert.equal(fixture.store.state.conversations[1].summaryThrough, 0)
  assert.equal(fixture.store.state.conversations[2].summaryThrough, 0)
  assert.match(replies[0].instructions, /FIXTURE_DECISION.*FIXTURE_FAILURE/)
  assert.ok(replies[0].instructions.includes('SMALL_ARCHIVE'))
  assert.deepEqual(
    replies[0].messages.slice(0, 4),
    before.conversations[2].messages.map(({ role, content }) => ({ role, content })),
  )
  assert.deepEqual(fixture.store.state.conversations[0].messages, before.conversations[0].messages)
  assert.equal(bytes.length, fixture.requests.length)
  assert.ok(bytes.every((value) => value <= 5000))
})

test('new chats open independently of the model and retain earlier failed work exactly', async () => {
  const fixture = setup()
  const { project, conversation } = await newChat(fixture)
  fixture.setBehavior(async () => {
    throw new Error('The old attempt failed')
  })
  await fixture.service.sendMessage({ conversationId: conversation.id, content: 'Remember' })
  const history = structuredClone(fixture.store.state.conversations[0])
  fixture.store.state.settings.ollamaModel = ''
  const state = await fixture.service.createConversation(project.id)
  assert.equal(state.conversations.length, 2)
  assert.deepEqual(state.conversations[0], history)
  assert.equal(fixture.requests.length, 1)
})

test('invalid or cancelled budget summaries preserve history and the pending draft', async () => {
  const fixture = setup()
  const { conversation } = await newChat(fixture)
  const old = fixture.store.state.conversations[0]
  for (let index = 0; index < 4; index++)
    old.messages.push({
      id: `before-summary-${index}`,
      role: index % 2 ? 'assistant' : 'user',
      content: 'Remember this earlier content. '.repeat(80),
      status: 'complete',
      createdAt: conversation.createdAt,
    })
  const saved = fixture.store.snapshot()
  fixture.provider.getInputBudget = async () => 5000
  fixture.setBehavior(async () => 'x'.repeat(1601))
  await assert.rejects(
    fixture.service.sendMessage({ conversationId: conversation.id, content: 'Keep this draft' }),
    /invalid summary/,
  )
  assert.deepEqual(fixture.store.snapshot(), saved)
  let began!: () => void
  const ready = new Promise<void>((resolve) => {
    began = resolve
  })
  fixture.setBehavior(
    (request) =>
      new Promise((_resolve, reject) => {
        request.signal.addEventListener(
          'abort',
          () => reject(new DOMException('Stopped', 'AbortError')),
          { once: true },
        )
        began()
      }),
  )
  const running = fixture.service.sendMessage({
    conversationId: conversation.id,
    content: 'Keep this draft',
  })
  await ready
  await fixture.service.cancelOperation()
  await assert.rejects(running, /Stopped/)
  assert.deepEqual(fixture.store.snapshot(), saved)
})

test('automatic compaction preserves recent pairs and all canonical project fields', async () => {
  const fixture = setup()
  const { conversation } = await newChat(fixture)
  for (let index = 0; index < 6; index++)
    await fixture.service.sendMessage({
      conversationId: conversation.id,
      content: `Message ${index}`,
    })
  const state = fixture.store.snapshot()
  assert.equal(state.conversations[0].summaryThrough, 8)
  assert.equal(state.conversations[0].messages.length, 12)
  assert.equal(state.projects[0].description, brief.description)
  assert.equal(state.projects[0].architecture, brief.architecture)
  assert.equal(state.projects[0].rules, brief.rules)
})

test('cancellation during the preflight memory save never accepts the pending user message', async () => {
  const fixture = setup()
  const { conversation } = await newChat(fixture)
  const current = fixture.store.state.conversations[0]
  for (let index = 0; index < 12; index++) {
    current.messages.push({
      id: `existing-${index}`,
      role: index % 2 === 0 ? 'user' : 'assistant',
      content: `Earlier message ${index}`,
      status: 'complete',
      createdAt: conversation.createdAt,
    })
  }
  const update = fixture.store.update.bind(fixture.store)
  fixture.store.update = async (change) => {
    const result = await update(change)
    if (result.conversations[0].summaryThrough > 0) await fixture.service.cancelOperation()
    return result
  }
  await assert.rejects(
    fixture.service.sendMessage({ conversationId: conversation.id, content: 'Cancelled draft' }),
    { name: 'AbortError' },
  )
  assert.equal(fixture.store.snapshot().conversations[0].messages.length, 12)
  assert.equal(fixture.requests.length, 1)
})

test('folder maps refresh before new chats and every prompt without entering canonical records', async () => {
  const reads: { path: string; maximumBytes?: number }[] = []
  let map = 'src/first.ts: function first'
  const fixture = setup(async (path, signal, maximumBytes) => {
    signal.throwIfAborted()
    reads.push({ path, maximumBytes })
    return map
  })
  const state = await fixture.service.createProject({
    ...brief,
    folderPath: 'C:\\projects\\example',
  })
  const first = await fixture.service.createConversation(state.projects[0].id)
  assert.equal(reads.length, 1)
  map = 'src/added.ts: function added'
  await fixture.service.sendMessage({
    conversationId: first.conversations[0].id,
    content: 'Where is added?',
  })
  assert.equal(reads.length, 2)
  assert.ok(fixture.requests.at(-1)!.instructions.includes(map))
  assert.ok(!fixture.requests.at(-1)!.instructions.includes('src/first.ts'))
  const second = await fixture.service.createConversation(state.projects[0].id)
  assert.equal(reads.length, 3)
  map = 'src/renamed.ts: function renamed'
  await fixture.service.sendMessage({
    conversationId: second.conversations[1].id,
    content: 'Continue',
  })
  assert.ok(fixture.requests.at(-1)!.instructions.includes(map))
  assert.ok(fixture.requests.at(-1)!.instructions.includes('Where is added?'))
  assert.deepEqual(
    reads.map((read) => read.path),
    Array(4).fill('C:\\projects\\example'),
  )
  assert.equal(fixture.store.state.projects[0].description, brief.description)
  assert.equal(fixture.store.state.projects[0].architecture, brief.architecture)
})

test('missing folder preserves pending draft and folder removal stops reading it', async () => {
  let fail = false
  const fixture = setup(async () => {
    if (fail) throw new Error('Project folder is unavailable. Choose it again.')
    return 'Folder map'
  })
  const state = await fixture.service.createProject({ ...brief, folderPath: 'C:\\project' })
  const chat = await fixture.service.createConversation(state.projects[0].id)
  fail = true
  await assert.rejects(
    fixture.service.sendMessage({
      conversationId: chat.conversations[0].id,
      content: 'Keep my draft',
    }),
    /folder is unavailable/,
  )
  assert.equal(fixture.store.state.conversations[0].messages.length, 0)
  await assert.rejects(
    fixture.service.createConversation(state.projects[0].id),
    /folder is unavailable/,
  )
  const updated = await fixture.service.updateProject({ ...state.projects[0], folderPath: '' })
  assert.equal(updated.projects[0].folderPath, undefined)
  await fixture.service.sendMessage({
    conversationId: chat.conversations[0].id,
    content: 'No folder now',
  })
  assert.equal(fixture.store.state.conversations[0].messages.length, 2)
})

test('folder reserve compacts prior history before acceptance and bounds the complete escaped request', async () => {
  const allowances: number[] = []
  const fixture = setup(async (_path, _signal, maximumBytes = 0) => {
    allowances.push(maximumBytes)
    return 'Folder map "quoted" \\path 🧭\n'.repeat(Math.floor(maximumBytes / 50))
  })
  const state = await fixture.service.createProject({ ...brief, folderPath: 'C:\\project' })
  await fixture.service.createConversation(state.projects[0].id)
  appendHistory(fixture.store.state.conversations[0], 'FOLDER_ARCHIVE', [90, 90, 90, 90])
  const oldMessages = structuredClone(fixture.store.state.conversations[0].messages)
  const next = await fixture.service.createConversation(state.projects[0].id)
  const bytes = enforceProviderBudget(fixture, 5000)

  await fixture.service.sendMessage({
    conversationId: next.conversations[1].id,
    content: 'Continue with the fresh map',
  })

  assert.equal(fixture.store.state.conversations[0].summaryThrough, 4)
  assert.deepEqual(fixture.store.state.conversations[0].messages, oldMessages)
  assert.ok(allowances.at(-1)! >= 1024 && allowances.at(-1)! <= 18000)
  assert.ok(fixture.requests.at(-1)!.instructions.includes('Folder map "quoted" \\path 🧭'))
  assert.ok(bytes.every((value) => value <= 5000))
})

test('an oversized escaped folder map rejects the prompt before acceptance without truncating it', async () => {
  let map = 'Small map'
  const fixture = setup(async () => map)
  const state = await fixture.service.createProject({ ...brief, folderPath: 'C:\\project' })
  const chat = await fixture.service.createConversation(state.projects[0].id)
  const saved = fixture.store.snapshot()
  fixture.provider.getInputBudget = async () => 5000
  map = '"\\🧭'.repeat(2000)
  await assert.rejects(
    fixture.service.sendMessage({
      conversationId: chat.conversations[0].id,
      content: 'Keep draft',
    }),
    /folder map exceeds/,
  )
  assert.deepEqual(fixture.store.snapshot(), saved)
  assert.equal(fixture.requests.length, 0)
})

test('context budget automatically compacts history before accepting a prompt', async () => {
  const fixture = setup()
  const { conversation } = await newChat(fixture)
  fixture.provider.getInputBudget = async () => 4000
  fixture.setBehavior(async (request) => {
    const bytes = contextInputBytes(request)
    assert.ok(bytes <= 4000, `Provider input ${bytes} exceeds its declared context budget`)
    return request.instructions.includes('Update a compact conversation memory')
      ? 'Decisions from earlier content.'
      : 'Ready to continue.'
  })
  for (let index = 0; index < 8; index++)
    fixture.store.state.conversations[0].messages.push({
      id: `budget-${index}`,
      role: index % 2 ? 'assistant' : 'user',
      content: 'Earlier content '.repeat(35),
      status: 'complete',
      createdAt: conversation.createdAt,
    })
  await fixture.service.sendMessage({ conversationId: conversation.id, content: 'Continue please' })
  assert.ok(fixture.store.state.conversations[0].summaryThrough >= 4)
  assert.equal(fixture.requests.at(-1)!.messages.at(-1)!.content, 'Continue please')
  assert.ok(contextInputBytes(fixture.requests.at(-1)!) <= 4000)
  assert.ok(fixture.requests.at(-1)!.instructions.includes(brief.description))
})

test('oversized historical messages are fully summarized in bounded Unicode-safe fragments', async () => {
  const fixture = setup()
  const { conversation } = await newChat(fixture)
  const original = 'A long response with decisions 🧭\n'.repeat(1800)
  const current = fixture.store.state.conversations[0]
  current.messages.push(
    {
      id: 'large-question',
      role: 'user',
      content: 'Explain the earlier implementation.',
      createdAt: conversation.createdAt,
      status: 'complete',
    },
    {
      id: 'large-answer',
      role: 'assistant',
      content: original,
      createdAt: conversation.createdAt,
      status: 'interrupted',
    },
  )
  for (let index = 0; index < 4; index++)
    current.messages.push({
      id: `recent-after-large-${index}`,
      role: index % 2 ? 'assistant' : 'user',
      content: `Keep recent message ${index} verbatim.`,
      createdAt: conversation.createdAt,
      status: 'complete',
    })
  const history = structuredClone(current.messages)
  fixture.provider.getInputBudget = async () => 5000
  fixture.setBehavior(async (request) => {
    const bytes = contextInputBytes(request)
    assert.ok(bytes <= 5000, `Provider input ${bytes} exceeds its declared context budget`)
    for (const canonical of [brief.description, brief.architecture, brief.rules])
      assert.ok(request.instructions.includes(canonical))
    return request.instructions.includes('Update a compact conversation memory')
      ? 'Preserve the implementation decisions; the long response was interrupted.'
      : 'Continue the interrupted work.'
  })
  await fixture.service.sendMessage({ conversationId: conversation.id, content: 'Continue' })
  const fragments = fixture.requests
    .filter((request) => request.messages[0].content.startsWith('Archived message fragment'))
    .map((request) => {
      const content = request.messages[0].content
      return JSON.parse(content.slice(content.indexOf('\n') + 1)) as {
        messageId: string
        content: string
        status: string
      }
    })
  const answer = fragments.filter((fragment) => fragment.messageId === 'large-answer')
  assert.ok(answer.length > 1)
  assert.equal(answer.map((fragment) => fragment.content).join(''), original)
  assert.ok(answer.every((fragment) => fragment.status === 'interrupted'))
  for (const fragment of answer) {
    assert.ok(!/^[\uDC00-\uDFFF]/.test(fragment.content))
    assert.ok(!/[\uD800-\uDBFF]$/.test(fragment.content))
  }
  const saved = fixture.store.state.conversations[0]
  assert.deepEqual(saved.messages.slice(0, history.length), history)
  assert.equal(saved.summaryThrough, 2)
  assert.match(saved.summary, /interrupted/)
  assert.deepEqual(fixture.requests.at(-1)!.messages, [
    ...history.slice(2).map(({ role, content }) => ({ role, content })),
    { role: 'user', content: 'Continue' },
  ])
})

test('a failed continuation fragment preserves committed memory, boundary, history and pending draft', async () => {
  const fixture = setup()
  const { conversation } = await newChat(fixture)
  const current = fixture.store.state.conversations[0]
  for (let index = 0; index < 4; index++)
    current.messages.push({
      id: `fragment-failure-${index}`,
      role: index % 2 ? 'assistant' : 'user',
      content: index === 3 ? 'Historical response '.repeat(2000) : 'Previous message',
      createdAt: conversation.createdAt,
      status: 'complete',
    })
  current.summary = 'Previously committed decisions.'
  current.summaryThrough = 2
  const saved = structuredClone(current)
  let fragments = 0
  fixture.provider.getInputBudget = async () => 5000
  fixture.setBehavior(async () => {
    if (++fragments === 3) throw new Error('A continuation fragment failed.')
    return 'A partial fragment memory that must not be committed.'
  })
  await assert.rejects(
    fixture.service.sendMessage({ conversationId: conversation.id, content: 'Keep my draft' }),
    /continuation fragment failed/,
  )
  assert.deepEqual(fixture.store.state.conversations[0], saved)
})

test('cancelling continuation summaries leaves the original message pair and memory untouched', async () => {
  const fixture = setup()
  const { conversation } = await newChat(fixture)
  const current = fixture.store.state.conversations[0]
  current.messages.push(
    {
      id: 'fragment-stop-user',
      role: 'user',
      content: 'Earlier question',
      createdAt: conversation.createdAt,
      status: 'complete',
    },
    {
      id: 'fragment-stop-assistant',
      role: 'assistant',
      content: 'Earlier response '.repeat(2000),
      createdAt: conversation.createdAt,
      status: 'complete',
    },
  )
  const saved = structuredClone(current)
  let fragments = 0
  fixture.provider.getInputBudget = async () => 5000
  fixture.setBehavior(async (request) => {
    if (++fragments === 3) {
      await fixture.service.cancelOperation()
      request.signal.throwIfAborted()
    }
    return 'A partial memory that must stay uncommitted.'
  })
  await assert.rejects(
    fixture.service.sendMessage({ conversationId: conversation.id, content: 'Cancelled draft' }),
    { name: 'AbortError' },
  )
  assert.deepEqual(fixture.store.state.conversations[0], saved)
})

test('summary capacity failure preserves full canonical fields instead of truncating them', async () => {
  const fixture = setup()
  const { project, conversation } = await newChat(fixture)
  await fixture.service.updateProject({ ...project, description: 'Canonical purpose '.repeat(400) })
  for (let index = 0; index < 2; index++)
    fixture.store.state.conversations[0].messages.push({
      id: `canonical-capacity-${index}`,
      role: index % 2 ? 'assistant' : 'user',
      content: 'Earlier message',
      createdAt: conversation.createdAt,
      status: 'complete',
    })
  const saved = fixture.store.snapshot()
  fixture.provider.getInputBudget = async () => 4000
  await assert.rejects(
    fixture.service.sendMessage({ conversationId: conversation.id, content: 'Keep my draft' }),
    /summary capacity/,
  )
  assert.deepEqual(fixture.store.snapshot(), saved)
  assert.equal(fixture.requests.length, 0)
})

test('explicit effort reaches Codex chat only and model changes restore the model default', async () => {
  const fixture = setup()
  const { conversation } = await newChat(fixture)
  const settings = {
    ...fixture.store.state.settings,
    defaultProvider: 'codex' as const,
    codexModel: 'reasoning-model',
    reasoningEffort: 'high' as const,
  }
  await fixture.service.saveSettings(settings)
  fixture.provider.inspect = async () => ({
    id: 'codex',
    connected: true,
    detail: 'Ready',
    models: ['reasoning-model'],
    modelCapabilities: [
      { model: 'reasoning-model', reasoningEfforts: [{ value: 'high', description: 'High' }] },
    ],
  })
  await fixture.service.sendMessage({
    conversationId: conversation.id,
    content: 'Reason carefully',
  })
  assert.equal(fixture.requests.at(-1)!.reasoningEffort, 'high')
  const generated = fixture.requests.length
  await fixture.service.createConversation(fixture.store.state.projects[0].id)
  assert.equal(fixture.requests.length, generated)
  await fixture.service.saveSettings({ ...settings, codexModel: 'another-model' })
  assert.equal(fixture.store.state.settings.reasoningEffort, undefined)
  await fixture.service.saveSettings({ ...settings, defaultProvider: 'ollama' })
  await fixture.service.sendMessage({
    conversationId: fixture.store.state.conversations[1].id,
    content: 'Local response',
  })
  assert.equal(fixture.requests.at(-1)!.reasoningEffort, undefined)
})
