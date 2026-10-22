import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { WorkspaceState } from '../shared/contracts.ts'
import { assertWorkspaceState, initialState } from '../core/validation.ts'

export class WorkspaceStore {
  private queue: Promise<void> = Promise.resolve()
  private readonly filePath: string
  private state: WorkspaceState

  private constructor(filePath: string, state: WorkspaceState) {
    this.filePath = filePath
    this.state = state
  }

  static async open(filePath: string): Promise<WorkspaceStore> {
    let contents: string
    try {
      contents = await readFile(filePath, 'utf8')
    } catch (error) {
      if (
        error !== null &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        return new WorkspaceStore(filePath, initialState())
      }
      throw error
    }
    let envelope: unknown
    try {
      envelope = JSON.parse(contents) as unknown
    } catch {
      throw new Error('The saved workspace is not valid JSON. The original file was preserved.')
    }
    if (
      envelope === null ||
      typeof envelope !== 'object' ||
      Array.isArray(envelope) ||
      !('version' in envelope) ||
      envelope.version !== 1 ||
      !('state' in envelope) ||
      Object.keys(envelope).some((key) => key !== 'version' && key !== 'state')
    ) {
      throw new Error(
        'The saved workspace format is not supported. The original file was preserved.',
      )
    }
    assertWorkspaceState(envelope.state)
    return new WorkspaceStore(filePath, structuredClone(envelope.state))
  }

  snapshot(): WorkspaceState {
    return structuredClone(this.state)
  }

  update(change: (draft: WorkspaceState) => void): Promise<WorkspaceState> {
    const operation = this.queue.then(async () => {
      const draft = this.snapshot()
      change(draft)
      const next = structuredClone(draft)
      assertWorkspaceState(next)
      const serialized = JSON.stringify({ version: 1, state: next })
      const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`
      let createdTemporaryFile = false
      try {
        await mkdir(dirname(this.filePath), { recursive: true })
        const handle = await open(temporaryPath, 'wx', 0o600)
        createdTemporaryFile = true
        try {
          await handle.writeFile(serialized, 'utf8')
          await handle.sync()
        } finally {
          await handle.close()
        }
        await rename(temporaryPath, this.filePath)
      } catch (error) {
        if (createdTemporaryFile) {
          try {
            await unlink(temporaryPath)
          } catch {
            /* Preserve the original write error. */
          }
        }
        throw error
      }
      this.state = next
      return this.snapshot()
    })
    this.queue = operation.then(
      () => undefined,
      () => undefined,
    )
    return operation
  }
}
