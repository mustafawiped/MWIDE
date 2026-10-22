export interface StreamScheduler {
  frame(callback: () => void): () => void
  delay(callback: () => void, milliseconds: number): () => void
}

export interface StreamResponse {
  conversationId: string
  knownMessageIds: Set<string>
  cancelled: boolean
  replyId?: string
}

/** Match tagged provider events while retaining compatibility with older transports. */
export function acceptsStreamDelta(
  response: StreamResponse,
  event: { conversationId: string; replyId?: string },
): boolean {
  if (response.cancelled || response.conversationId !== event.conversationId) return false
  if (!event.replyId) return true
  if (response.knownMessageIds.has(event.replyId)) return false
  if (response.replyId && response.replyId !== event.replyId) return false
  response.replyId = event.replyId
  return true
}

/** Coalesce transport chunks without delaying the first visible text. */
export function createStreamBuffer<Key>(
  publish: (text: string) => void,
  scheduler: StreamScheduler,
) {
  let active: Key | null = null
  let revision = 0
  let text = ''
  let chunks: string[] = []
  let started = false
  let scheduled = false
  let cancelFrame: (() => void) | undefined
  let cancelDelay: (() => void) | undefined

  const unschedule = () => {
    cancelFrame?.()
    cancelDelay?.()
    cancelFrame = undefined
    cancelDelay = undefined
    scheduled = false
    revision++
  }
  const flush = (key: Key) => {
    if (active !== key) return
    unschedule()
    if (!chunks.length) return
    text += chunks.join('')
    chunks = []
    publish(text)
  }
  const discard = () => {
    unschedule()
    active = null
    chunks = []
    text = ''
    started = false
  }
  return {
    begin(key: Key) {
      discard()
      active = key
    },
    append(key: Key, chunk: string) {
      if (active !== key || !chunk) return
      chunks.push(chunk)
      if (!started) {
        started = true
        flush(key)
        return
      }
      if (scheduled) return
      scheduled = true
      const ticket = revision
      const commit = () => {
        if (ticket === revision && active === key) flush(key)
      }
      cancelFrame = scheduler.frame(commit)
      // A hidden or throttled window must not leave pending text behind indefinitely.
      cancelDelay = scheduler.delay(commit, 32)
    },
    flush,
    finish(key: Key) {
      if (active !== key) return
      flush(key)
      active = null
    },
    discard,
  }
}
