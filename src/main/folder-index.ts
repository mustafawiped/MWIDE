import { Worker } from 'node:worker_threads'

const MAX_PATH_LENGTH = 32_768
const MAX_CONTEXT_BYTES = 18_000

interface PendingRead {
  id: number
  folderPath: string
  maximumBytes: number
  signal?: AbortSignal
  abort: () => void
  resolve: (value: string) => void
  reject: (reason: unknown) => void
  worker?: Worker
}

/** Owns one reusable scanner thread. No results are cached between requests. */
export class FolderIndex {
  private worker?: Worker
  private pending?: PendingRead
  private stopping?: Promise<void>
  private disposed = false
  private nextId = 0
  private readonly workerPath: string | URL

  constructor(workerPath: string | URL) {
    this.workerPath = workerPath
  }

  read(
    folderPath: string,
    signal?: AbortSignal,
    maximumBytes = MAX_CONTEXT_BYTES,
  ): Promise<string> {
    if (this.disposed) return Promise.reject(new Error('The project folder index is closed.'))
    if (signal?.aborted) return Promise.reject(signal.reason)
    if (this.pending) return Promise.reject(new Error('A project folder scan is already running.'))
    if (
      typeof folderPath !== 'string' ||
      !folderPath.trim() ||
      folderPath.length > MAX_PATH_LENGTH
    ) {
      return Promise.reject(new Error('Choose a valid project folder using the folder picker.'))
    }
    if (!Number.isFinite(maximumBytes) || maximumBytes < 1_024) {
      return Promise.reject(
        new Error('At least 1,024 bytes of model context are needed for the project folder map.'),
      )
    }

    return new Promise<string>((resolve, reject) => {
      const request: PendingRead = {
        id: (this.nextId = (this.nextId % Number.MAX_SAFE_INTEGER) + 1),
        folderPath,
        maximumBytes: Math.min(MAX_CONTEXT_BYTES, Math.floor(maximumBytes)),
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

  private async start(request: PendingRead): Promise<void> {
    // Wait for an aborted scanner to stop before creating a replacement.
    if (this.stopping) await this.stopping
    if (this.pending !== request || this.disposed) return
    let worker = this.worker
    if (!worker) {
      worker = new Worker(this.workerPath, {
        resourceLimits: { maxOldGenerationSizeMb: 64, maxYoungGenerationSizeMb: 16 },
      })
      this.worker = worker
      const ownedWorker = worker
      worker.on('message', (message: unknown) => this.receive(ownedWorker, message))
      worker.once('error', (error) => this.failed(ownedWorker, error))
      worker.once('exit', (code) => {
        if (this.worker !== ownedWorker) return
        this.worker = undefined
        if (this.pending?.worker === ownedWorker) {
          this.finish(this.pending, new Error(`The project folder scanner stopped (code ${code}).`))
        }
      })
    }
    request.worker = worker
    worker.ref()
    try {
      worker.postMessage({
        type: 'read',
        id: request.id,
        folderPath: request.folderPath,
        maximumBytes: request.maximumBytes,
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
        if (
          result.type === 'result' &&
          typeof result.value === 'string' &&
          Buffer.byteLength(result.value) <= request.maximumBytes
        ) {
          this.finish(request, undefined, result.value)
          return
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

  private finish(request: PendingRead, error?: unknown, value?: string): void {
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
