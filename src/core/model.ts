import type { ProviderStatus } from '../shared/contracts'

export interface ModelMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface GenerationRequest {
  model: string
  instructions: string
  messages: ModelMessage[]
  signal: AbortSignal
  onDelta?: (text: string) => void
}

export interface ModelProvider {
  inspect(): Promise<ProviderStatus>
  generate(request: GenerationRequest): Promise<string>
  dispose?(): void
}
