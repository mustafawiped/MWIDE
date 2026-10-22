import assert from 'node:assert/strict'
import test from 'node:test'
import { batchChatEvents } from '../src/main/chat-events.ts'
import type { ChatEvent } from '../src/shared/contracts.ts'

function fixture() {
  const events: ChatEvent[] = []
  let scheduled: (() => void) | undefined
  const batch = batchChatEvents(
    (event) => events.push(event),
    (flush) => {
      scheduled = flush
      return () => {
        scheduled = undefined
      }
    },
  )
  return { batch, events, tick: () => scheduled?.() }
}

test('first token is immediate; a burst is lossless with bounded IPC batches and a state barrier', () => {
  const { batch, events } = fixture()
  batch.emit({ type: 'delta', conversationId: 'a', text: '🧭' })
  assert.equal(events.length, 1)
  for (let index = 0; index < 10000; index++)
    batch.emit({ type: 'delta', conversationId: 'a', text: 'x' })
  const boundary: ChatEvent = { type: 'error', conversationId: 'a', message: 'Stopped' }
  batch.emit(boundary)
  const deltas = events.filter((event) => event.type === 'delta')
  assert.equal(deltas.map((event) => event.text).join(''), '🧭' + 'x'.repeat(10000))
  assert.equal(deltas.length, 4)
  assert.equal(events.at(-1), boundary)
})

test('scheduled flushes and conversation changes preserve event order', () => {
  const { batch, events, tick } = fixture()
  batch.emit({ type: 'delta', conversationId: 'a', text: 'A' })
  batch.emit({ type: 'delta', conversationId: 'a', text: 'B' })
  tick()
  batch.emit({ type: 'delta', conversationId: 'a', text: 'C' })
  batch.emit({ type: 'delta', conversationId: 'b', text: 'D' })
  batch.emit({ type: 'delta', conversationId: 'b', text: 'E' })
  tick()
  assert.deepEqual(
    events.map((event) => (event.type === 'delta' ? [event.conversationId, event.text] : null)),
    [
      ['a', 'A'],
      ['a', 'B'],
      ['a', 'C'],
      ['b', 'D'],
      ['b', 'E'],
    ],
  )
})

test('disposing drops pending and late output', () => {
  const { batch, events, tick } = fixture()
  batch.emit({ type: 'delta', conversationId: 'a', text: 'First' })
  batch.emit({ type: 'delta', conversationId: 'a', text: 'Pending' })
  batch.dispose()
  tick()
  batch.emit({ type: 'delta', conversationId: 'a', text: 'Late' })
  batch.flush()
  assert.equal(events.length, 1)
})

test('reply identities stay separate when the same conversation starts another response', () => {
  const { batch, events } = fixture()
  batch.emit({ type: 'delta', conversationId: 'a', replyId: 'first', text: 'A' })
  batch.emit({ type: 'delta', conversationId: 'a', replyId: 'first', text: 'B' })
  batch.emit({ type: 'delta', conversationId: 'a', replyId: 'second', text: 'C' })
  assert.deepEqual(events, [
    { type: 'delta', conversationId: 'a', replyId: 'first', text: 'A' },
    { type: 'delta', conversationId: 'a', replyId: 'first', text: 'B' },
    { type: 'delta', conversationId: 'a', replyId: 'second', text: 'C' },
  ])
})
