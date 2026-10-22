export const CHAT_PAGE_SIZE = 60

/** Window only the view. Stored history and provider context remain complete. */
export function chatWindow(messageCount: number, visibleCount = CHAT_PAGE_SIZE) {
  const end = Math.max(0, Math.trunc(messageCount))
  const start = Math.max(0, end - Math.max(CHAT_PAGE_SIZE, Math.trunc(visibleCount)))
  return { start, end, earlier: start }
}

export function preserveChatAnchor(
  previous: { top: number; height: number },
  nextHeight: number,
): number {
  return Math.max(0, previous.top + nextHeight - previous.height)
}
