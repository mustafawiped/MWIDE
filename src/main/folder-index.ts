import { Worker } from 'node:worker_threads'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CodeGraphQuery, CodeGraphResult, CodeIndexStatus } from '../shared/codegraph.ts'
import { parseCodeGraphQuery } from './codegraph-query.ts'

const MAX_CONTEXT_BYTES = 18_000
interface PendingRequest {
  id: number
  type: 'read' | 'inspect' | 'query'
  folderPath: string
  maximumBytes: number
  queryText?: string
  query?: CodeGraphQuery
  signal?: AbortSignal
  abort: () => void
  resolve: (value: unknown) => void
  reject: (reason: unknown) => void
  worker?: Worker
}

function validStatus(value: unknown): value is CodeIndexStatus {
  if (!value || typeof value !== 'object') return false
  const status = value as Record<string, unknown>
  const changes = status.changes as Record<string, unknown> | undefined
  return (
    typeof status.root === 'string' &&
    typeof status.checkedAt === 'string' &&
    [
      'generation',
      'files',
      'symbols',
      'edges',
      'parsedFiles',
      'reusedFiles',
      'bytesRead',
      'unresolvedCalls',
      'unresolvedImports',
      'partialFiles',
      'skippedFiles',
      'durationMs',
    ].every(
      (key) =>
        typeof status[key] === 'number' &&
        Number.isFinite(status[key]) &&
        (status[key] as number) >= 0,
    ) &&
    ['added', 'modified', 'deleted'].every(
      (key) =>
        Array.isArray(status[key]) &&
        (status[key] as unknown[]).length <= 100 &&
        (status[key] as unknown[]).every((item) => typeof item === 'string'),
    ) &&
    typeof status.truncated === 'boolean' &&
    typeof status.changeListTruncated === 'boolean' &&
    changes !== undefined &&
    changes !== null &&
    ['added', 'modified', 'deleted'].every(
      (key) => Number.isSafeInteger(changes[key]) && (changes[key] as number) >= 0,
    )
  )
}

/** Owns one cancellable thread and a persistent cache; refresh never blocks the main event loop. */
export class FolderIndex {
  private worker?: Worker
  private pending?: PendingRequest
  private stopping?: Promise<void>
  private disposed = false
  private nextId = 0
  private readonly workerPath: string | URL
  private readonly cacheDirectory: string

  constructor(workerPath: string | URL, options: { cacheDirectory?: string } = {}) {
    this.workerPath = workerPath
    this.cacheDirectory = options.cacheDirectory ?? join(tmpdir(), 'mwide-code-index')
  }

  read(
    folderPath: string,
    signal?: AbortSignal,
    maximumBytes = MAX_CONTEXT_BYTES,
    queryText?: string,
  ): Promise<string> {
    return this.request('read', folderPath, signal, maximumBytes, queryText) as Promise<string>
  }

  inspect(folderPath: string, signal?: AbortSignal): Promise<CodeIndexStatus> {
    return this.request('inspect', folderPath, signal) as Promise<CodeIndexStatus>
  }

  query(folderPath: string, query: CodeGraphQuery, signal?: AbortSignal): Promise<CodeGraphResult> {
    try {
      return this.request(
        'query',
        folderPath,
        signal,
        MAX_CONTEXT_BYTES,
        undefined,
        parseCodeGraphQuery(query),
      ) as Promise<CodeGraphResult>
    } catch (error) {
      return Promise.reject(error)
    }
  }

  private request(
    type: PendingRequest['type'],
    folderPath: string,
    signal?: AbortSignal,
    maximumBytes = MAX_CONTEXT_BYTES,
    queryText?: string,
    query?: CodeGraphQuery,
  ): Promise<unknown> {
    if (this.disposed) return Promise.reject(new Error('The project folder index is closed.'))
    if (signal?.aborted) return Promise.reject(signal.reason)
    if (this.pending) return Promise.reject(new Error('A project folder scan is already running.'))
    if (typeof folderPath !== 'string' || !folderPath.trim() || folderPath.length > 32_768)
      return Promise.reject(new Error('Choose a valid project folder using the folder picker.'))
    if (!Number.isFinite(maximumBytes) || maximumBytes < 1_024)
      return Promise.reject(
        new Error('At least 1,024 bytes of model context are needed for the project folder map.'),
      )
    if (queryText !== undefined && (typeof queryText !== 'string' || queryText.length > 100_000))
      return Promise.reject(new Error('The project search text is too large.'))
    return new Promise((resolve, reject) => {
      const request: PendingRequest = {
        id: (this.nextId = (this.nextId % Number.MAX_SAFE_INTEGER) + 1),
        type,
        folderPath,
        maximumBytes: Math.min(MAX_CONTEXT_BYTES, Math.floor(maximumBytes)),
        queryText,
        query,
        signal,
        resolve,
        reject,
        abort: () => {
          if (this.pending !== request) return
          this.finish(request, signal?.reason ?? new DOMException('Scan cancelled.', 'AbortError'))
          if (request.worker) this.retire(request.worker)
        },
      }
      this.pending = request
      signal?.addEventListener('abort', request.abort, { once: true })
      void this.start(request).catch((error: unknown) => this.finish(request, error))
    })
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    if (this.pending) this.finish(this.pending, new Error('The project folder index is closed.'))
    if (this.worker) this.retire(this.worker)
  }

  private async start(request: PendingRequest): Promise<void> {
    if (this.stopping) await this.stopping
    if (this.pending !== request || this.disposed) return
    let worker = this.worker
    if (!worker) {
      worker = new Worker(this.workerPath, {
        workerData: { cacheDirectory: this.cacheDirectory },
        resourceLimits: { maxOldGenerationSizeMb: 256, maxYoungGenerationSizeMb: 32 },
      })
      this.worker = worker
      const ownedWorker = worker
      worker.on('message', (message: unknown) => this.receive(ownedWorker, message))
      worker.once('error', (error) => this.failed(ownedWorker, error))
      worker.once('exit', (code) => {
        if (this.worker !== ownedWorker) return
        this.worker = undefined
        if (this.pending?.worker === ownedWorker)
          this.finish(this.pending, new Error(`The project folder scanner stopped (code ${code}).`))
      })
    }
    request.worker = worker
    worker.ref()
    try {
      worker.postMessage({
        type: request.type,
        id: request.id,
        folderPath: request.folderPath,
        maximumBytes: request.maximumBytes,
        queryText: request.queryText,
        query: request.query,
      })
    } catch (error) {
      this.failed(worker, error)
    }
  }

  private receive(worker: Worker, message: unknown): void {
    const request = this.pending
    if (this.worker !== worker || request?.worker !== worker) return
    if (message && typeof message === 'object') {
      const result = message as Record<string, unknown>
      if (result.id === request.id) {
        if (result.type === 'result') {
          const value = result.value
          const graph = value as CodeGraphResult | undefined
          const valid =
            request.type === 'read'
              ? typeof value === 'string' && Buffer.byteLength(value) <= request.maximumBytes
              : Buffer.byteLength(JSON.stringify(value) ?? '') <= 1_048_576 &&
                (request.type === 'inspect'
                  ? validStatus(value)
                  : graph &&
                    validStatus(graph.status) &&
                    Array.isArray(graph.symbols) &&
                    graph.symbols.length <= 500 &&
                    Array.isArray(graph.edges) &&
                    graph.edges.length <= 10_000 &&
                    Number.isSafeInteger(graph.total) &&
                    typeof graph.truncated === 'boolean')
          if (valid) {
            this.finish(request, undefined, value)
            return
          }
        }
        if (result.type === 'error' && typeof result.message === 'string') {
          this.finish(request, new Error(result.message.slice(0, 2_048)))
          return
        }
      }
    }
    this.failed(worker, new Error('The project folder scanner returned an invalid response.'))
  }

  private failed(worker: Worker, error: unknown): void {
    if (this.worker !== worker) return
    if (this.pending?.worker === worker) this.finish(this.pending, error)
    this.retire(worker)
  }

  private finish(request: PendingRequest, error?: unknown, value?: unknown): void {
    if (this.pending !== request) return
    this.pending = undefined
    request.signal?.removeEventListener('abort', request.abort)
    request.worker?.unref()
    if (value !== undefined) request.resolve(value)
    else request.reject(error)
  }

  private retire(worker: Worker): void {
    if (this.worker === worker) this.worker = undefined
    const stopped = worker.terminate().then(
      () => undefined,
      () => undefined,
    )
    const stopping = this.stopping
      ? Promise.all([this.stopping, stopped]).then(() => undefined)
      : stopped
    this.stopping = stopping
    void stopping.then(() => {
      if (this.stopping === stopping) this.stopping = undefined
    })
  }
}
