import type { ChildProcessWithoutNullStreams } from 'node:child_process'

export interface RpcNotification {
  method: string
  params?: unknown
}

interface PendingRequest {
  resolve(value: unknown): void
  reject(error: Error): void
  timer: ReturnType<typeof setTimeout>
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A bounded JSONL connection to a single, privately spawned app-server. */
export class CodexRpc {
  private readonly process: ChildProcessWithoutNullStreams
  private readonly defaultTimeoutMs: number
  private sequence = 0
  private buffer = ''
  private closed: Error | undefined
  private readonly pending = new Map<number, PendingRequest>()
  private readonly notifications = new Set<(event: RpcNotification) => void>()
  private readonly closeListeners = new Set<(error: Error) => void>()

  constructor(process: ChildProcessWithoutNullStreams, defaultTimeoutMs = 15_000) {
    this.process = process
    this.defaultTimeoutMs = defaultTimeoutMs
    process.stdout.setEncoding('utf8')
    process.stdout.on('data', (chunk: string) => this.read(chunk))
    process.stdout.on('error', () => this.dispose(new Error('Codex output could not be read.')))
    process.stdin.on('error', () => this.dispose(new Error('Codex input connection closed.')))
    // Drain diagnostics without forwarding account details or environment data to the UI.
    process.stderr.on('data', () => {})
    process.on('error', () => this.dispose(new Error('Codex app-server could not be started.')))
    process.on('exit', (code) => {
      this.dispose(new Error(`Codex app-server stopped unexpectedly (exit ${code ?? 'unknown'}).`))
    })
  }

  request<T = unknown>(
    method: string,
    params?: unknown,
    timeoutMs = this.defaultTimeoutMs,
  ): Promise<T> {
    if (this.closed) return Promise.reject(this.closed)
    if (this.pending.size >= 32)
      return Promise.reject(new Error('Too many pending Codex requests.'))
    const id = ++this.sequence
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.dispose(new Error(`Codex ${method} timed out.`))
      }, timeoutMs)
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject, timer })
      this.write({ id, method, ...(params === undefined ? {} : { params }) })
    })
  }

  notify(method: string): void {
    this.write({ method })
  }

  subscribe(listener: (event: RpcNotification) => void): () => void {
    this.notifications.add(listener)
    return () => this.notifications.delete(listener)
  }

  onClose(listener: (error: Error) => void): () => void {
    if (this.closed) listener(this.closed)
    else this.closeListeners.add(listener)
    return () => this.closeListeners.delete(listener)
  }

  dispose(error = new Error('Codex connection was closed.')): void {
    if (this.closed) return
    this.closed = error
    this.buffer = ''
    for (const request of this.pending.values()) {
      clearTimeout(request.timer)
      request.reject(error)
    }
    this.pending.clear()
    for (const listener of this.closeListeners) listener(error)
    this.closeListeners.clear()
    this.notifications.clear()
    this.process.kill()
    // Native descendants can inherit stdio handles on Windows. Release our
    // pipe handles even after the private app-server has been terminated.
    this.process.stdin.destroy()
    this.process.stdout.destroy()
    this.process.stderr.destroy()
  }

  private write(message: unknown): void {
    if (this.closed) return
    try {
      this.process.stdin.write(`${JSON.stringify(message)}\n`)
    } catch {
      this.dispose(new Error('A Codex request could not be written.'))
    }
  }

  private read(chunk: string): void {
    if (this.closed) return
    this.buffer += chunk
    if (Buffer.byteLength(this.buffer) > 4 * 1024 * 1024) {
      this.dispose(new Error('Codex output exceeded the buffer limit.'))
      return
    }
    let newline: number
    while ((newline = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, newline)
      this.buffer = this.buffer.slice(newline + 1)
      if (Buffer.byteLength(line) > 1024 * 1024) {
        this.dispose(new Error('Codex returned an oversized protocol message.'))
        return
      }
      if (!line.trim()) continue
      let message: unknown
      try {
        message = JSON.parse(line)
      } catch {
        this.dispose(new Error('Codex returned invalid protocol data.'))
        return
      }
      if (!isRecord(message)) {
        this.dispose(new Error('Codex returned an invalid protocol message.'))
        return
      }
      if (typeof message.method === 'string') {
        if (message.id !== undefined) {
          this.write({
            id: message.id,
            error: {
              code: -32601,
              message: 'Client tool requests are disabled in chat-only mode.',
            },
          })
          this.dispose(new Error('Codex requested an unavailable tool in chat-only mode.'))
          return
        }
        for (const listener of this.notifications) {
          try {
            listener({ method: message.method, params: message.params })
          } catch {
            this.dispose(new Error('Codex response handling failed.'))
            return
          }
        }
      } else if (typeof message.id === 'number') {
        const pending = this.pending.get(message.id)
        if (!pending) continue
        clearTimeout(pending.timer)
        this.pending.delete(message.id)
        if (isRecord(message.error)) {
          const detail =
            typeof message.error.message === 'string' ? message.error.message : 'Request failed.'
          pending.reject(new Error(`Codex: ${detail.slice(0, 500)}`))
        } else if ('result' in message) pending.resolve(message.result)
        else pending.reject(new Error('Codex returned a response without a result.'))
      }
    }
    if (Buffer.byteLength(this.buffer) > 1024 * 1024) {
      this.dispose(new Error('Codex returned an oversized protocol message.'))
    }
  }
}
