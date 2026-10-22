export type ProviderId = 'codex' | 'ollama'
export type CatalogKind = 'mcp' | 'skill'
export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export interface ModelCapabilities {
  model: string
  defaultReasoningEffort?: ReasoningEffort
  reasoningEfforts: { value: ReasoningEffort; description: string }[]
}

export interface UsageLimitWindow {
  remainingPercent: number
  windowDurationMins: number | null
  resetsAt: number | null
}

export interface CodexUsageLimits {
  available: boolean
  detail: string
  checkedAt: string
  buckets: {
    id: string
    name: string
    primary: UsageLimitWindow | null
    secondary: UsageLimitWindow | null
  }[]
}

export interface ProviderSettings {
  defaultProvider: ProviderId
  codexModel: string
  ollamaUrl: string
  ollamaModel: string
  reasoningEffort?: ReasoningEffort
}

export interface ProviderStatus {
  id: ProviderId
  connected: boolean
  detail: string
  models: string[]
  modelCapabilities?: ModelCapabilities[]
}

export interface CatalogItem {
  id: string
  kind: CatalogKind
  name: string
  description: string
  instructions: string
}

export interface ProjectDraft {
  name: string
  description: string
  rules: string
  architecture: string
  catalogIds: string[]
  folderPath?: string
}

export interface Project extends ProjectDraft {
  id: string
  createdAt: string
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: string
  status: 'complete' | 'interrupted' | 'failed'
}

export interface Conversation {
  id: string
  projectId: string
  title: string
  createdAt: string
  messages: ChatMessage[]
  summary: string
  summaryThrough: number
}

export interface WorkspaceState {
  settings: ProviderSettings
  catalog: CatalogItem[]
  projects: Project[]
  conversations: Conversation[]
}

export interface Recommendation {
  id: string
  reason: string
}

export type ChatEvent =
  | { type: 'delta'; conversationId: string; text: string; replyId?: string }
  | { type: 'state'; state: WorkspaceState }
  | { type: 'error'; conversationId: string; message: string }

export interface WorkspaceBridge {
  getState(): Promise<WorkspaceState>
  saveSettings(settings: ProviderSettings): Promise<WorkspaceState>
  inspectProvider(id: ProviderId): Promise<ProviderStatus>
  getCodexUsageLimits(): Promise<CodexUsageLimits>
  selectProjectFolder(): Promise<string | null>
  signInCodex(): Promise<{ message: string }>
  saveCatalogItem(item: Omit<CatalogItem, 'id'> & { id?: string }): Promise<WorkspaceState>
  removeCatalogItem(id: string): Promise<WorkspaceState>
  recommend(project: ProjectDraft): Promise<Recommendation[]>
  createProject(project: ProjectDraft): Promise<WorkspaceState>
  updateProject(project: Project): Promise<WorkspaceState>
  createConversation(projectId: string): Promise<WorkspaceState>
  sendMessage(input: { conversationId: string; content: string }): Promise<WorkspaceState>
  cancelMessage(conversationId: string): Promise<void>
  cancelOperation(): Promise<void>
  onChatEvent(listener: (event: ChatEvent) => void): () => void
}

/** The renderer receives only explicit application operations. */
export interface DesktopBridge {
  readonly platform: string
  readonly workspace?: WorkspaceBridge
}
