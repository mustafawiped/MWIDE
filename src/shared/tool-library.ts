export interface ToolLibrarySource {
  url: string
  repository: string
  revision: string
  license: string
}

export interface ToolLibraryEntry {
  id: string
  kind: 'skill' | 'mcp'
  name: string
  description: string
  category: string
  tags: string[]
  coding: boolean
  version: string
  source: ToolLibrarySource
  state: 'installed' | 'needs-setup' | 'available' | 'error'
  detail: string
  requirements: string[]
  access: string[]
  verifiedAt?: string
  toolCount?: number
}

export interface ToolLibraryState {
  entries: ToolLibraryEntry[]
  installedAt?: string
}

export interface ToolLibraryInspection {
  id: string
  connected: boolean
  detail: string
  checkedAt: string
  tools: { name: string; description: string }[]
}
