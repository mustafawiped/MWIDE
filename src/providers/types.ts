import type { GenerationRequest } from '../core/model.ts'

export type { GenerationRequest, ModelProvider } from '../core/model.ts'

export function abortError(): Error {
  const error = new Error('Generation was cancelled.')
  error.name = 'AbortError'
  return error
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'The provider could not complete the request.'
}

export function validateGeneration(request: GenerationRequest): void {
  if (request.signal.aborted) throw abortError()
  if (!request.model.trim()) throw new Error('Choose a model before generating a response.')
  if (!request.messages.length || request.messages.at(-1)?.role !== 'user') {
    throw new Error('A generation must end with a user message.')
  }
  if (request.messages.some((message) => !['user', 'assistant'].includes(message.role))) {
    throw new Error('The conversation contains an unsupported message role.')
  }
}
