import { parentPort, workerData } from 'node:worker_threads'
import { CodeGraphStore } from './codegraph-store.ts'
import { parseCodeGraphQuery } from './codegraph-query.ts'

const port = parentPort
if (!port || typeof workerData?.cacheDirectory !== 'string')
  throw new Error('The project index must run in its owned worker thread.')
const store = new CodeGraphStore(workerData.cacheDirectory)
let busy = false

port.on('message', (message: unknown) => {
  if (!message || typeof message !== 'object') throw new Error('Invalid folder scan request.')
  const request = message as Record<string, unknown>
  if (
    !['read', 'inspect', 'query'].includes(String(request.type)) ||
    !Number.isSafeInteger(request.id) ||
    (request.id as number) < 1 ||
    typeof request.folderPath !== 'string' ||
    !request.folderPath.trim() ||
    request.folderPath.length > 32_768 ||
    busy
  ) {
    throw new Error('Invalid or overlapping folder scan request.')
  }
  const root = request.folderPath
  busy = true
  void (async () => {
    const query = request.type === 'query' ? parseCodeGraphQuery(request.query) : undefined
    if (
      request.type === 'read' &&
      (!Number.isInteger(request.maximumBytes) ||
        (request.maximumBytes as number) < 1_024 ||
        (request.maximumBytes as number) > 18_000 ||
        (request.queryText !== undefined &&
          (typeof request.queryText !== 'string' || request.queryText.length > 100_000)))
    )
      throw new Error('Invalid project context request.')
    const status = await store.refresh(root)
    if (request.type === 'inspect') return status
    if (query) return store.query(root, query)
    return store.context(
      root,
      request.maximumBytes as number,
      request.queryText as string | undefined,
    )
  })()
    .then(
      (value) => port.postMessage({ type: 'result', id: request.id, value }),
      (error: unknown) =>
        port.postMessage({
          type: 'error',
          id: request.id,
          message: (error instanceof Error
            ? error.message
            : 'Cannot scan the project folder.'
          ).slice(0, 2_048),
        }),
    )
    .finally(() => {
      busy = false
    })
})
