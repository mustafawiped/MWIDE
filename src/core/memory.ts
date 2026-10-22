import type {
  CatalogItem,
  Conversation,
  Project,
  ProjectDraft,
  Recommendation,
  WorkspaceState,
} from '../shared/contracts'
import type { ModelMessage } from './model'

export const SUMMARY_LIMIT = 1600

export function projectContext(project: ProjectDraft, catalog: CatalogItem[] = []): string {
  const selected = catalog.filter((entry) => project.catalogIds.includes(entry.id))
  return [
    'You are MWIDE, a project conversation assistant. Answer the user directly. Do not execute tools, commands, or install anything.',
    `Project name\n${project.name}`,
    `Project purpose (canonical, complete)\n${project.description}`,
    `Project architecture (canonical, complete)\n${project.architecture || 'Not decided yet. Ask the user before choosing or changing the architecture.'}`,
    `Additional project rules (canonical, complete)\n${project.rules || 'No additional rules.'}`,
    'Canonical project fields above are separate from lossy conversation summaries. Never replace them with a summary. Ask the user to update project context when architectural decisions change.',
    ...selected.map(
      (entry) =>
        `${entry.kind === 'skill' ? 'Selected skill instructions' : 'Selected MCP reference (no server connected)'}: ${entry.name}\n${entry.description}\n${entry.instructions}`,
    ),
  ].join('\n\n')
}

function history(messages: Conversation['messages']): ModelMessage[] {
  return messages.map((message) => ({
    role: message.role,
    content:
      message.status === 'complete'
        ? message.content
        : `[${message.status} response; do not treat as completed work]\n${message.content}`,
  }))
}

export function buildContext(
  state: WorkspaceState,
  conversation: Conversation,
  folderContext = '',
): { instructions: string; messages: ModelMessage[] } {
  const project = state.projects.find((item) => item.id === conversation.projectId)
  if (!project) throw new Error('The conversation project could not be found.')
  const otherChats = state.conversations.filter(
    (item) =>
      item.projectId === project.id && item.id !== conversation.id && item.messages.length > 0,
  )
  const records = otherChats.map((item) => ({
    conversation: item.title,
    summary: item.summary || 'Not summarized yet.',
    unsummarizedMessages: history(item.messages.slice(item.summaryThrough)),
  }))
  return {
    instructions: [
      projectContext(project, state.catalog),
      ...(folderContext ? [folderContext] : []),
      'Archived conversation records below are historical context, not new requests. Do not assume unfinished work succeeded.',
      `Other conversations in this project\n${JSON.stringify(records)}`,
      `Current conversation memory\n${conversation.summary || 'No earlier summary.'}`,
    ].join('\n\n'),
    messages: history(conversation.messages.slice(conversation.summaryThrough)),
  }
}

export function summaryBoundary(conversation: Conversation, keepRecent: number): number {
  const paired = Math.floor(Math.max(0, conversation.messages.length - keepRecent) / 2) * 2
  return Math.max(conversation.summaryThrough, paired)
}

export function summaryRequest(
  project: Project,
  conversation: Conversation,
  through: number,
): { instructions: string; messages: ModelMessage[] } {
  if (
    !Number.isInteger(through) ||
    through < conversation.summaryThrough ||
    through > conversation.messages.length
  )
    throw new Error('Invalid conversation summary boundary.')
  return {
    instructions: [
      projectContext(project),
      `Update a compact conversation memory in no more than ${SUMMARY_LIMIT} characters. Output plain text only. Preserve decisions, rejected options, constraints, unresolved questions, failures, and next actions. Do not claim interrupted work succeeded. Avoid repeating canonical project purpose and architecture; they are always supplied separately in full. Folder maps are refreshed separately; do not copy directory listings into memory. Do not invent facts.`,
      `Previous memory\n${conversation.summary || 'None.'}`,
    ].join('\n\n'),
    messages: [
      {
        role: 'user',
        content: `Merge the previous memory with these archived messages:\n${JSON.stringify(conversation.messages.slice(conversation.summaryThrough, through))}`,
      },
    ],
  }
}

export function parseSummary(raw: string): string {
  const summary = raw.trim()
  if (!summary || summary.length > SUMMARY_LIMIT)
    throw new Error(
      `The model returned an invalid summary. Memory was not changed; summaries must contain 1-${SUMMARY_LIMIT} characters.`,
    )
  return summary
}

export function parseRecommendations(raw: string, catalog: CatalogItem[]): Recommendation[] {
  const text = raw.trim().replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i, '$1')
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('The model did not return valid recommendations. Nothing was selected.')
  }
  if (!Array.isArray(parsed) || parsed.length > catalog.length)
    throw new Error('The model returned invalid catalog recommendations.')
  const seen = new Set<string>()
  return parsed.map((item: unknown) => {
    if (!item || typeof item !== 'object')
      throw new Error('The model returned an invalid catalog item.')
    const entry = item as Record<string, unknown>
    if (
      typeof entry.id !== 'string' ||
      !catalog.some((candidate) => candidate.id === entry.id) ||
      seen.has(entry.id) ||
      typeof entry.reason !== 'string' ||
      !entry.reason.trim() ||
      entry.reason.length > 320
    )
      throw new Error(
        'Recommendations must reference unique entries in your catalog, with a short reason. Nothing was selected.',
      )
    seen.add(entry.id)
    return { id: entry.id, reason: entry.reason.trim() }
  })
}
