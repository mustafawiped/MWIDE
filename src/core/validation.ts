import type {
  CatalogItem,
  ProjectDraft,
  ProviderSettings,
  ReasoningEffort,
  WorkspaceState,
} from '../shared/contracts.ts'

type RecordValue = Record<string, unknown>

function record(value: unknown, label: string): RecordValue {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`)
  }
  return value as RecordValue
}

function text(value: unknown, label: string, maximum: number, required = false): string {
  if (typeof value !== 'string' || value.length > maximum || (required && !value.trim())) {
    throw new Error(
      `${label} must be ${required ? 'a nonempty' : 'a'} string of at most ${maximum} characters.`,
    )
  }
  return value
}

function identifier(value: unknown, label: string): string {
  return text(value, label, 200, true)
}

function list(value: unknown, label: string, maximum = 50_000): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) {
    throw new Error(`${label} must be an array with at most ${maximum} entries.`)
  }
  return value
}

function date(value: unknown, label: string): void {
  const result = text(value, label, 64, true)
  if (!Number.isFinite(Date.parse(result))) throw new Error(`${label} must be a valid date.`)
}

function addId(ids: Set<string>, value: unknown, label: string): string {
  const id = identifier(value, label)
  if (ids.has(id)) throw new Error(`${label} must be unique.`)
  ids.add(id)
  return id
}

export function initialState(): WorkspaceState {
  return {
    settings: {
      defaultProvider: 'codex',
      codexModel: '',
      ollamaUrl: 'http://127.0.0.1:11434',
      ollamaModel: '',
    },
    catalog: [],
    projects: [],
    conversations: [],
  }
}

export function parseProjectDraft(value: unknown): ProjectDraft {
  const input = record(value, 'Project')
  const catalogIds = list(input.catalogIds, 'Project catalog IDs', 64).map((id) =>
    identifier(id, 'Project catalog ID'),
  )
  if (new Set(catalogIds).size !== catalogIds.length) {
    throw new Error('Project catalog IDs must be unique.')
  }
  const draft: ProjectDraft = {
    name: text(input.name, 'Project name', 120, true),
    description: text(input.description, 'Project description', 20_000, true),
    rules: text(input.rules, 'Project rules', 12_000),
    architecture: text(input.architecture, 'Project architecture notes', 20_000),
    catalogIds,
  }
  if (input.folderPath !== undefined) {
    const folder = text(input.folderPath, 'Project folder', 4096)
    if ([...folder].some((character) => character.charCodeAt(0) < 32))
      throw new Error('Project folder contains invalid characters.')
    draft.folderPath = folder
  }
  return draft
}

export function parseCatalogItem(value: unknown): Omit<CatalogItem, 'id'> & { id?: string } {
  const input = record(value, 'Catalog entry')
  if (input.kind !== 'mcp' && input.kind !== 'skill') {
    throw new Error('Catalog type must be mcp or skill.')
  }
  const item: Omit<CatalogItem, 'id'> & { id?: string } = {
    kind: input.kind,
    name: text(input.name, 'Catalog name', 120, true),
    description: text(input.description, 'Catalog description', 4_000, true),
    instructions: text(
      input.instructions,
      'Catalog instructions',
      input.libraryId ? 128_000 : 16_000,
      true,
    ),
  }
  if (input.libraryId !== undefined)
    item.libraryId = identifier(input.libraryId, 'Library entry ID')
  if (input.id !== undefined) item.id = identifier(input.id, 'Catalog ID')
  return item
}

export function parseSettings(value: unknown): ProviderSettings {
  const input = record(value, 'Provider settings')
  if (input.defaultProvider !== 'codex' && input.defaultProvider !== 'ollama') {
    throw new Error('Default provider must be codex or ollama.')
  }
  const ollamaUrl = text(input.ollamaUrl, 'Ollama URL', 2_048, true)
  let url: URL
  try {
    url = new URL(ollamaUrl)
  } catch {
    throw new Error('Ollama URL must be a valid loopback HTTP URL.')
  }
  const authority = /^[a-z][a-z\d+.-]*:\/\/([^/?#]*)/i.exec(ollamaUrl.trim())?.[1]
  const loopback =
    url.hostname === 'localhost' || url.hostname === '[::1]' || url.hostname === '127.0.0.1'
  if (
    url.protocol !== 'http:' ||
    !loopback ||
    !authority ||
    authority.includes('@') ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    ollamaUrl.includes('?') ||
    ollamaUrl.includes('#')
  ) {
    throw new Error(
      'Ollama URL must use local HTTP (localhost, 127.0.0.1, or ::1), without a path, credentials, query, or fragment.',
    )
  }
  const settings: ProviderSettings = {
    defaultProvider: input.defaultProvider,
    codexModel: text(input.codexModel, 'Codex model', 200),
    ollamaUrl,
    ollamaModel: text(input.ollamaModel, 'Ollama model', 200),
  }
  if (input.reasoningEffort !== undefined) {
    const supported: unknown[] = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
    if (!supported.includes(input.reasoningEffort)) throw new Error('Unknown reasoning effort.')
    settings.reasoningEffort = input.reasoningEffort as ReasoningEffort
  }
  return settings
}

export function assertWorkspaceState(value: unknown): asserts value is WorkspaceState {
  const state = record(value, 'Workspace')
  parseSettings(state.settings)
  const catalogIds = new Set<string>()
  for (const entry of list(state.catalog, 'Catalog')) {
    const item = record(entry, 'Catalog entry')
    parseCatalogItem(item)
    addId(catalogIds, item.id, 'Catalog ID')
  }
  const projectIds = new Set<string>()
  for (const entry of list(state.projects, 'Projects')) {
    const project = record(entry, 'Project')
    const parsed = parseProjectDraft(project)
    addId(projectIds, project.id, 'Project ID')
    date(project.createdAt, 'Project creation date')
    if (parsed.catalogIds.some((id) => !catalogIds.has(id))) {
      throw new Error('Project refers to a catalog entry that does not exist.')
    }
  }
  const conversationIds = new Set<string>()
  const messageIds = new Set<string>()
  for (const entry of list(state.conversations, 'Conversations')) {
    const conversation = record(entry, 'Conversation')
    addId(conversationIds, conversation.id, 'Conversation ID')
    if (!projectIds.has(identifier(conversation.projectId, 'Conversation project ID'))) {
      throw new Error('Conversation refers to a project that does not exist.')
    }
    text(conversation.title, 'Conversation title', 200, true)
    date(conversation.createdAt, 'Conversation creation date')
    const summary = text(conversation.summary, 'Conversation summary', 1_600)
    const messages = list(conversation.messages, 'Messages')
    if (
      !Number.isInteger(conversation.summaryThrough) ||
      typeof conversation.summaryThrough !== 'number' ||
      conversation.summaryThrough < 0 ||
      conversation.summaryThrough > messages.length
    ) {
      throw new Error(
        'Conversation summary boundary must be an integer within its message history.',
      )
    }
    if (conversation.summaryThrough > 0 && !summary.trim()) {
      throw new Error('Archived messages must have a nonempty conversation summary.')
    }
    for (const entry of messages) {
      const message = record(entry, 'Message')
      addId(messageIds, message.id, 'Message ID')
      if (message.role !== 'user' && message.role !== 'assistant')
        throw new Error('Message role must be user or assistant.')
      if (
        message.status !== 'complete' &&
        message.status !== 'interrupted' &&
        message.status !== 'failed'
      )
        throw new Error('Message status must be complete, interrupted, or failed.')
      text(message.content, 'Message content', 200_000)
      date(message.createdAt, 'Message creation date')
    }
  }
}
