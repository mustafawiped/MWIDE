import { request as httpRequest } from 'node:http'
import { StringDecoder } from 'node:string_decoder'
import type { ProviderStatus } from '../shared/contracts.ts'
import { isRecord } from './codex-rpc.ts'
import type { GenerationRequest, ModelProvider } from './types.ts'
import { abortError, errorMessage, validateGeneration } from './types.ts'

interface ModelInfo {
  capabilities: string[]
  contextLength: number
  templateBytes: number
}

interface OllamaOptions {
  requestTimeoutMs?: number
  generationTimeoutMs?: number
}

export function validateOllamaUrl(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('Enter a valid local Ollama URL.')
  }
  if (
    url.protocol !== 'http:' ||
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      'Ollama must use an HTTP loopback URL without credentials, a path, or query parameters.',
    )
  }
  return url.toString()
}

export class OllamaProvider implements ModelProvider {
  private readonly baseUrl: URL
  private readonly options: OllamaOptions
  private readonly pending = new Set<() => void>()
  private readonly metadata = new Map<string, { info: ModelInfo; checkedAt: number }>()

  constructor(baseUrl: string, options: OllamaOptions = {}) {
    this.baseUrl = new URL(validateOllamaUrl(baseUrl))
    this.options = options
  }

  async inspect(): Promise<ProviderStatus> {
    try {
      const result = await this.json('/api/tags')
      if (!isRecord(result) || !Array.isArray(result.models) || result.models.length > 100) {
        throw new Error('Ollama returned an invalid or oversized model catalog.')
      }
      const models: string[] = []
      for (const model of result.models) {
        if (!isRecord(model) || typeof model.name !== 'string') continue
        try {
          const info = await this.modelInfo(model.name)
          if (info.capabilities.includes('completion')) models.push(model.name)
        } catch {
          // A removed, remote, or incompatible model must not become a chat option.
        }
      }
      return {
        id: 'ollama',
        connected: models.length > 0,
        detail: models.length
          ? 'Local Ollama is ready.'
          : 'Ollama is running, but no supported local chat models are installed.',
        models: [...new Set(models)],
      }
    } catch (error) {
      return { id: 'ollama', connected: false, detail: errorMessage(error), models: [] }
    }
  }

  async getInputBudget(model: string, signal: AbortSignal): Promise<number> {
    const info = await this.modelInfo(model, signal)
    if (!info.contextLength) throw new Error('Ollama did not report a usable model context length.')
    return Math.max(0, Math.min(info.contextLength, 32_768) - 2_048 - 512 - info.templateBytes)
  }

  async generate(request: GenerationRequest): Promise<string> {
    validateGeneration(request)
    const info = await this.modelInfo(request.model, request.signal)
    if (!info.capabilities.includes('completion'))
      throw new Error('The selected Ollama model does not support chat completion.')
    if (!info.contextLength)
      throw new Error(
        'Ollama did not report a usable model context length. The request was not sent.',
      )
    const maximumContext = Math.min(info.contextLength, 32_768)
    const messages = [{ role: 'system', content: request.instructions }, ...request.messages]
    // UTF-8 bytes deliberately overestimate typical text tokenization. Template and
    // message framing plus the full output allowance receive separate headroom.
    const inputBudget =
      Buffer.byteLength(JSON.stringify(messages)) + info.templateBytes + messages.length * 64
    if (inputBudget > maximumContext - 2_048 - 512) {
      throw new Error(
        'This request exceeds the local model context budget after automatic memory optimization. Shorten the prompt or project instructions, or choose a model with a larger context. Canonical project fields were preserved.',
      )
    }
    // Start with the smallest sufficient context. Allocating the model maximum
    // for a short chat wastes local RAM/VRAM and can force slow CPU offloading.
    const requiredContext = inputBudget + 2_048 + 512
    const contextLength = Math.min(
      maximumContext,
      Math.max(4_096, 2 ** Math.ceil(Math.log2(requiredContext))),
    )
    let buffer = ''
    let answer = ''
    let done = false
    const decoder = new StringDecoder('utf8')
    const parseLine = (line: string): void => {
      if (!line.trim()) return
      if (Buffer.byteLength(line) > 256 * 1024)
        throw new Error('Ollama returned an oversized stream message.')
      let chunk: unknown
      try {
        chunk = JSON.parse(line)
      } catch {
        throw new Error('Ollama returned invalid stream data.')
      }
      if (!isRecord(chunk)) throw new Error('Ollama returned an invalid stream message.')
      if (typeof chunk.error === 'string') throw new Error(`Ollama: ${chunk.error.slice(0, 500)}`)
      if (done) throw new Error('Ollama returned data after completing the response.')
      if (isRecord(chunk.message)) {
        if (Array.isArray(chunk.message.tool_calls) && chunk.message.tool_calls.length) {
          throw new Error('Tool calls are unavailable in MWIDE chat-only mode.')
        }
        if (typeof chunk.message.content === 'string' && chunk.message.content) {
          answer += chunk.message.content
          if (Buffer.byteLength(answer) > 2 * 1024 * 1024)
            throw new Error('Ollama response exceeded the output limit.')
          request.onDelta?.(chunk.message.content)
        }
      }
      if (chunk.done === true) {
        if (chunk.done_reason !== undefined && chunk.done_reason !== 'stop') {
          throw new Error(
            chunk.done_reason === 'length'
              ? 'Ollama reached its output limit before completing the response. Partial output was not accepted.'
              : 'Ollama returned an unsupported completion reason. Partial output was not accepted.',
          )
        }
        done = true
      }
    }
    await this.read(
      '/api/chat',
      {
        model: request.model,
        messages,
        stream: true,
        // Never let the server silently drop project instructions or history if
        // template expansion or model-provided messages exceed our estimate.
        truncate: false,
        shift: false,
        options: { num_ctx: contextLength, num_predict: 2_048 },
        ...(info.capabilities.includes('thinking') ? { think: false } : {}),
      },
      request.signal,
      this.options.generationTimeoutMs ?? 600_000,
      (data) => {
        buffer += decoder.write(data)
        if (Buffer.byteLength(buffer) > 1024 * 1024)
          throw new Error('Ollama stream exceeded the buffer limit.')
        let newline: number
        while ((newline = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, newline)
          buffer = buffer.slice(newline + 1)
          parseLine(line)
        }
        if (Buffer.byteLength(buffer) > 256 * 1024)
          throw new Error('Ollama returned an oversized stream message.')
      },
    )
    buffer += decoder.end()
    if (buffer.trim()) parseLine(buffer)
    if (!done)
      throw new Error(
        'Ollama closed the stream before completing the response. Partial output was not accepted.',
      )
    if (!answer.trim()) throw new Error('Ollama completed without a text response.')
    return answer
  }

  dispose(): void {
    for (const cancel of this.pending) cancel()
    this.pending.clear()
    this.metadata.clear()
  }

  private async modelInfo(model: string, signal?: AbortSignal): Promise<ModelInfo> {
    if (signal?.aborted) throw abortError()
    const cached = this.metadata.get(model)
    if (cached && Date.now() - cached.checkedAt < 60_000) return cached.info
    const result = await this.json('/api/show', { model }, signal)
    if (!isRecord(result) || !Array.isArray(result.capabilities))
      throw new Error('Ollama returned invalid model details.')
    if (result.remote_host || result.remote_model || model.endsWith(':cloud'))
      throw new Error('Only local Ollama models are supported.')
    const metadata = isRecord(result.model_info) ? result.model_info : {}
    const architecture =
      typeof metadata['general.architecture'] === 'string' ? metadata['general.architecture'] : ''
    const primaryLength = metadata[`${architecture}.context_length`]
    const lengths = Object.entries(metadata)
      .filter(
        ([key, value]) =>
          key.endsWith('.context_length') &&
          typeof value === 'number' &&
          Number.isSafeInteger(value) &&
          value > 0,
      )
      .map(([, value]) => value as number)
    const contextLength =
      typeof primaryLength === 'number' && Number.isSafeInteger(primaryLength) && primaryLength > 0
        ? primaryLength
        : lengths.length
          ? Math.min(...lengths)
          : 0
    const info = {
      capabilities: result.capabilities.filter(
        (value): value is string => typeof value === 'string',
      ),
      contextLength,
      templateBytes: typeof result.template === 'string' ? Buffer.byteLength(result.template) : 0,
    }
    this.metadata.set(model, { info, checkedAt: Date.now() })
    return info
  }

  private async json(path: string, body?: unknown, signal?: AbortSignal): Promise<unknown> {
    const chunks: Buffer[] = []
    let bytes = 0
    await this.read(path, body, signal, this.options.requestTimeoutMs ?? 10_000, (chunk) => {
      bytes += chunk.length
      if (bytes > 4 * 1024 * 1024) throw new Error('Ollama returned an oversized response.')
      chunks.push(chunk)
    })
    let result: unknown
    try {
      result = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    } catch {
      throw new Error('Ollama returned invalid JSON.')
    }
    if (isRecord(result) && typeof result.error === 'string')
      throw new Error(`Ollama: ${result.error.slice(0, 500)}`)
    return result
  }

  private read(
    path: string,
    body: unknown,
    signal: AbortSignal | undefined,
    timeoutMs: number,
    onData: (data: Buffer) => void,
  ): Promise<void> {
    if (signal?.aborted) return Promise.reject(abortError())
    return new Promise<void>((resolve, reject) => {
      let settled = false
      const content = body === undefined ? undefined : JSON.stringify(body)
      const timer = setTimeout(() => finish(new Error('Ollama request timed out.')), timeoutMs)
      const cancel = (): void => finish(abortError())
      const finish = (error?: Error): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        signal?.removeEventListener('abort', cancel)
        this.pending.delete(cancel)
        if (error) {
          outgoing.destroy()
          reject(error)
        } else resolve()
      }
      // node:http bypasses ambient HTTP proxy settings. localhost is pinned to a
      // numeric loopback address; no DNS lookup or redirects can leave the host.
      const outgoing = httpRequest(
        {
          hostname:
            this.baseUrl.hostname === 'localhost'
              ? '127.0.0.1'
              : this.baseUrl.hostname.replace(/^\[|\]$/g, ''),
          port: this.baseUrl.port || 80,
          path,
          method: content === undefined ? 'GET' : 'POST',
          agent: false,
          headers:
            content === undefined
              ? {}
              : {
                  'Content-Type': 'application/json',
                  'Content-Length': Buffer.byteLength(content),
                },
        },
        (incoming) => {
          if (incoming.statusCode !== 200) {
            incoming.resume()
            finish(
              new Error(
                `Ollama returned HTTP ${incoming.statusCode ?? 'unknown'}. Check the local service and selected model.`,
              ),
            )
            return
          }
          incoming.on('data', (chunk: Buffer) => {
            if (settled) return
            try {
              onData(chunk)
            } catch (error) {
              finish(error instanceof Error ? error : new Error('Ollama response handling failed.'))
            }
          })
          incoming.on('end', () => finish())
          incoming.on('aborted', () => finish(new Error('Ollama response was interrupted.')))
          incoming.on('error', () => finish(new Error('Ollama response could not be read.')))
        },
      )
      this.pending.add(cancel)
      signal?.addEventListener('abort', cancel, { once: true })
      outgoing.on('error', () =>
        finish(
          signal?.aborted
            ? abortError()
            : new Error('Could not connect to local Ollama. Start Ollama and retry.'),
        ),
      )
      outgoing.end(content)
    })
  }
}
