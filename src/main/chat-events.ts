import type { ChatEvent } from '../shared/contracts.ts'

type Schedule = (flush: () => void) => () => void

/** Keep the first token immediate and bound IPC work for bursts; state events are barriers. */
export function batchChatEvents(
  deliver: (event: ChatEvent) => void,
  schedule: Schedule = (flush) => {
    const timer = setTimeout(flush, 32)
    timer.unref()
    return () => clearTimeout(timer)
  },
) {
  let conversationId = ''
  let replyId: string | undefined
  let parts: string[] = []
  let size = 0
  let first = true
  let cancel: (() => void) | undefined
  let disposed = false
  const flush = () => {
    cancel?.()
    cancel = undefined
    if (!size || disposed) return
    const text = parts.join('')
    parts = []
    size = 0
    deliver({ type: 'delta', conversationId, text, ...(replyId ? { replyId } : {}) })
  }
  return {
    emit(event: ChatEvent): void {
      if (disposed) return
      if (event.type !== 'delta') {
        flush()
        first = true
        conversationId = ''
        replyId = undefined
        deliver(event)
        return
      }
      if (!event.text) return
      if (conversationId !== event.conversationId || replyId !== event.replyId) {
        flush()
        conversationId = event.conversationId
        replyId = event.replyId
        first = true
      }
      if (first) {
        first = false
        deliver(event)
        return
      }
      parts.push(event.text)
      size += event.text.length
      if (size >= 4096) flush()
      else if (!cancel) cancel = schedule(flush)
    },
    flush,
    dispose(): void {
      disposed = true
      cancel?.()
      cancel = undefined
      parts = []
      size = 0
    },
  }
}
