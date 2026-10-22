import assert from 'node:assert/strict'
import test from 'node:test'
import { CHAT_PAGE_SIZE, chatWindow, preserveChatAnchor } from '../src/renderer/src/chat-window.ts'

test('long chats initially mount only their latest page without changing stored history', () => {
  const messages = Array.from({ length: 1000 }, (_, index) => ({ id: String(index) }))
  const { start, end, earlier } = chatWindow(messages.length)
  assert.equal(earlier, 940)
  assert.equal(end - start, CHAT_PAGE_SIZE)
  assert.equal(messages.slice(start, end)[0]?.id, '940')
  assert.equal(messages.slice(start, end).at(-1)?.id, '999')
  assert.equal(messages.length, 1000)
})

test('successive earlier pages make every message accessible in chronological order', () => {
  const messages = Array.from({ length: 1003 }, (_, index) => index)
  let visibleCount = CHAT_PAGE_SIZE
  let window = chatWindow(messages.length, visibleCount)
  while (window.earlier) {
    const previous = window
    visibleCount += CHAT_PAGE_SIZE
    window = chatWindow(messages.length, visibleCount)
    assert.equal(window.end, previous.end)
    assert.ok(previous.start - window.start <= CHAT_PAGE_SIZE)
    assert.ok(previous.start > window.start)
  }
  assert.deepEqual(messages.slice(window.start, window.end), messages)
})

test('empty and short conversations have no earlier page and a fresh chat uses the default', () => {
  assert.deepEqual(chatWindow(0), { start: 0, end: 0, earlier: 0 })
  assert.deepEqual(chatWindow(5), { start: 0, end: 5, earlier: 0 })
  assert.equal(chatWindow(300, 180).start, 120)
  assert.equal(chatWindow(300).start, 240)
})

test('prepending variable-height history preserves the existing viewport position', () => {
  const before = { top: 240, height: 10_000 }
  const addedHeight = 3_827
  const after = preserveChatAnchor(before, before.height + addedHeight)
  assert.equal(after - addedHeight, before.top)
  assert.equal(preserveChatAnchor({ top: 0, height: 50 }, 10), 0)
})
