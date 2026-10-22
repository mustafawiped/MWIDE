import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  assertWorkspaceState,
  initialState,
  parseCatalogItem,
  parseProjectDraft,
  parseSettings,
} from '../src/core/validation.ts'
import type { WorkspaceState } from '../src/shared/contracts.ts'

const timestamp = '2026-10-22T12:00:00.000Z'
function validState(): WorkspaceState {
  const state = initialState()
  state.catalog.push({
    id: 'skill-1',
    kind: 'skill',
    name: 'Testing',
    description: 'Useful testing guidance.',
    instructions: 'Run focused checks.',
  })
  state.projects.push({
    id: 'project-1',
    name: 'Example',
    description: 'Canonical project brief.',
    rules: '',
    architecture: '',
    catalogIds: ['skill-1'],
    createdAt: timestamp,
  })
  state.conversations.push({
    id: 'chat-1',
    projectId: 'project-1',
    title: 'Conversation',
    createdAt: timestamp,
    messages: [
      { id: 'message-1', role: 'user', content: 'Hello', status: 'complete', createdAt: timestamp },
    ],
    summary: '',
    summaryThrough: 0,
  })
  return state
}

test('project parsing preserves exact canonical text and validates sizes and selection IDs', () => {
  const input = {
    name: '  Name  ',
    description: '\n Keep the full brief.\n ',
    rules: '  Rule one.\n',
    architecture: '\n  Existing architecture.  ',
    catalogIds: ['one', 'two'],
  }
  assert.deepEqual(parseProjectDraft(input), input)
  for (const patch of [
    { name: '' },
    { description: ' \n ' },
    { name: 'x'.repeat(121) },
    { description: 'x'.repeat(20_001) },
    { rules: 'x'.repeat(12_001) },
    { architecture: 'x'.repeat(20_001) },
    { catalogIds: ['same', 'same'] },
    { catalogIds: [''] },
    { catalogIds: Array.from({ length: 65 }, (_, index) => String(index)) },
  ]) {
    assert.throws(() => parseProjectDraft({ ...input, ...patch }))
  }
})

test('settings only accept supported providers, bounded models, and credential-free loopback URLs', () => {
  const settings = initialState().settings
  for (const url of ['http://127.0.0.1:11434', 'http://localhost:11434', 'http://[::1]:11434']) {
    assert.equal(parseSettings({ ...settings, ollamaUrl: url }).ollamaUrl, url)
  }
  for (const url of [
    'http://example.com',
    'https://localhost:11434',
    'http://127.7.3.2:11434',
    'http://localhost:11434/api',
    'http://127.0.0.1.example.com',
    'file:///etc/passwd',
    'ftp://localhost',
    'http://user:pass@localhost',
    'http://@localhost',
    'http://localhost?model=x',
    'http://localhost?',
    'http://localhost#fragment',
    'http://localhost#',
    'not a URL',
  ]) {
    assert.throws(() => parseSettings({ ...settings, ollamaUrl: url }))
  }
  assert.throws(() => parseSettings({ ...settings, defaultProvider: 'unsupported' }))
  assert.throws(() => parseSettings({ ...settings, codexModel: 'm'.repeat(201) }))
  assert.throws(() => parseSettings({ ...settings, ollamaModel: null }))
})

test('catalog parsing validates kind, required instructions, IDs, and bounds', () => {
  const item = {
    kind: 'mcp',
    name: 'Context',
    description: 'Description',
    instructions: 'Instructions',
  }
  assert.deepEqual(parseCatalogItem(item), item)
  for (const patch of [
    { kind: 'other' },
    { instructions: '' },
    { description: ' ' },
    { id: '' },
    { name: 'x'.repeat(121) },
    { description: 'x'.repeat(4_001) },
    { instructions: 'x'.repeat(16_001) },
  ]) {
    assert.throws(() => parseCatalogItem({ ...item, ...patch }))
  }
})

test('loaded workspaces validate nested references, unique IDs, dates, roles, and summary boundaries', () => {
  const changes: ((state: WorkspaceState) => void)[] = [
    (state) => {
      state.catalog.push({ ...state.catalog[0] })
    },
    (state) => {
      state.projects.push({ ...state.projects[0] })
    },
    (state) => {
      state.conversations.push({ ...state.conversations[0] })
    },
    (state) => {
      state.projects[0].catalogIds = ['missing']
    },
    (state) => {
      state.conversations[0].projectId = 'missing'
    },
    (state) => {
      state.conversations[0].messages.push({ ...state.conversations[0].messages[0] })
    },
    (state) => {
      state.projects[0].createdAt = 'not a date'
    },
    (state) => {
      state.conversations[0].summaryThrough = -1
    },
    (state) => {
      state.conversations[0].summaryThrough = 2
    },
    (state) => {
      state.conversations[0].summaryThrough = 0.5
    },
    (state) => {
      state.conversations[0].summaryThrough = 1
      state.conversations[0].summary = '  '
    },
    (state) => {
      state.conversations[0].summary = 'x'.repeat(1_601)
    },
    (state) => {
      state.conversations[0].messages[0].content = 'x'.repeat(200_001)
    },
  ]
  assert.doesNotThrow(() => assertWorkspaceState(validState()))
  const boundary = validState()
  boundary.conversations[0].summaryThrough = 1
  boundary.conversations[0].summary = 'The user greeted the assistant.'
  assert.doesNotThrow(() => assertWorkspaceState(boundary))
  for (const change of changes) {
    const state = validState()
    change(state)
    assert.throws(() => assertWorkspaceState(state))
  }
  const wrongRole: unknown = {
    ...validState(),
    conversations: [
      {
        ...validState().conversations[0],
        messages: [
          {
            id: 'bad',
            role: 'system',
            content: 'Bad role',
            status: 'complete',
            createdAt: timestamp,
          },
        ],
      },
    ],
  }
  assert.throws(() => assertWorkspaceState(wrongRole))
})
