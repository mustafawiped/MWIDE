import type { ProviderStatus, ReasoningEffort } from '../shared/contracts'

export interface ModelMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface GenerationRequest {
  model: string
  instructions: string
  messages: ModelMessage[]
  signal: AbortSignal
  reasoningEffort?: ReasoningEffort
  onDelta?: (text: string) => void
}

export interface ModelProvider {
  inspect(): Promise<ProviderStatus>
  getInputBudget?(model: string, signal: AbortSignal): Promise<number>
  generate(request: GenerationRequest): Promise<string>
  dispose?(): void
}
