import { parentPort } from 'node:worker_threads'
import { readProjectFolder } from './project-folder.ts'

const port = parentPort
if (!port) throw new Error('The project folder scanner must run in its owned worker thread.')
let busy = false

port.on('message', (message: unknown) => {
  if (!message || typeof message !== 'object') throw new Error('Invalid folder scan request.')
  const request = message as Record<string, unknown>
  if (
    request.type !== 'read' ||
    !Number.isSafeInteger(request.id) ||
    (request.id as number) < 1 ||
    typeof request.folderPath !== 'string' ||
    !request.folderPath.trim() ||
    request.folderPath.length > 32_768 ||
    typeof request.maximumBytes !== 'number' ||
    !Number.isInteger(request.maximumBytes) ||
    request.maximumBytes < 1_024 ||
    request.maximumBytes > 18_000 ||
    busy
  ) {
    throw new Error('Invalid or overlapping folder scan request.')
  }
  busy = true
  void readProjectFolder(request.folderPath, undefined, request.maximumBytes)
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
