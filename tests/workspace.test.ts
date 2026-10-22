import assert from 'node:assert/strict'
import test from 'node:test'
import { WorkspaceService } from '../src/core/workspace.ts'
import type { WorkspaceRepository } from '../src/core/workspace.ts'
import { initialState, assertWorkspaceState } from '../src/core/validation.ts'
import type { GenerationRequest, ModelProvider } from '../src/core/model.ts'
import type { ChatEvent, WorkspaceState } from '../src/shared/contracts.ts'

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

function setup() {
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

test('new conversations summarize prior chats before creation and include memory in the next request', async () => {
  const fixture = setup()
  const { project, conversation } = await newChat(fixture)
  await fixture.service.sendMessage({
    conversationId: conversation.id,
    content: 'Remember the architecture decision',
  })
  const state = await fixture.service.createConversation(project.id)
  assert.equal(state.conversations.length, 2)
  assert.equal(state.conversations[0].summaryThrough, 2)
  assert.ok(state.conversations[0].summary.length <= 1600)
  await fixture.service.sendMessage({
    conversationId: state.conversations[1].id,
    content: 'Continue in a new chat',
  })
  const request = fixture.requests.at(-1)!
  assert.ok(request.instructions.includes('Decision: keep focused modules.'))
  assert.ok(request.instructions.includes(brief.description))
  assert.ok(request.instructions.includes(brief.architecture))
  assert.equal(fixture.store.snapshot().projects[0].architecture, project.architecture)
})

test('invalid or cancelled summaries preserve old history and do not create a new chat', async () => {
  const fixture = setup()
  const { project, conversation } = await newChat(fixture)
  await fixture.service.sendMessage({ conversationId: conversation.id, content: 'Remember' })
  fixture.setBehavior(async () => 'x'.repeat(1601))
  await assert.rejects(fixture.service.createConversation(project.id), /invalid summary/)
  assert.equal(fixture.store.snapshot().conversations.length, 1)
  assert.equal(fixture.store.snapshot().conversations[0].summaryThrough, 0)
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
  const running = fixture.service.createConversation(project.id)
  await ready
  await fixture.service.cancelOperation()
  await assert.rejects(running, /Stopped/)
  assert.equal(fixture.store.snapshot().conversations.length, 1)
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
