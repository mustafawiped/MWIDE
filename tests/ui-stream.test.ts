import assert from 'node:assert/strict'
import test from 'node:test'
import {
  acceptsStreamDelta,
  createStreamBuffer,
  type StreamResponse,
  type StreamScheduler,
} from '../src/renderer/src/stream-buffer.ts'

function clock() {
  const frames = new Set<() => void>()
  const timers = new Map<() => void, number>()
  let now = 0
  const scheduler: StreamScheduler = {
    frame(callback) {
      frames.add(callback)
      return () => frames.delete(callback)
    },
    delay(callback, milliseconds) {
      timers.set(callback, now + milliseconds)
      return () => timers.delete(callback)
    },
  }
  return {
    scheduler,
    frames,
    timers,
    frame() {
      for (const callback of [...frames]) callback()
    },
    advance(milliseconds: number) {
      now += milliseconds
      for (const [callback, due] of [...timers]) if (due <= now) callback()
    },
  }
}

test('a 1000-delta burst is ordered, first text is immediate, and final text flushes', () => {
  const time = clock()
  const published: string[] = []
  const stream = createStreamBuffer<string>((value) => published.push(value), time.scheduler)
  const chunks = Array.from({ length: 1000 }, (_, index) => `${index}:界🌍\n`)
  stream.begin('response')
  stream.append('response', chunks[0]!)
  assert.deepEqual(published, [chunks[0]])
  for (const chunk of chunks.slice(1)) stream.append('response', chunk)
  assert.equal(published.length, 1)
  assert.equal(time.frames.size, 1)
  assert.equal(time.timers.size, 1)
  stream.finish('response')
  assert.equal(published.length, 2)
  assert.equal(published.at(-1), chunks.join(''))
  assert.equal(time.frames.size, 0)
  assert.equal(time.timers.size, 0)
  stream.append('response', 'late')
  assert.equal(published.length, 2)
})

test('a visible frame flushes once and cancels its timer fallback', () => {
  const time = clock()
  const published: string[] = []
  const stream = createStreamBuffer<string>((value) => published.push(value), time.scheduler)
  stream.begin('response')
  stream.append('response', 'a')
  stream.append('response', 'b')
  stream.append('response', 'c')
  time.frame()
  time.advance(32)
  assert.deepEqual(published, ['a', 'abc'])
  stream.append('response', 'd')
  time.frame()
  assert.deepEqual(published, ['a', 'abc', 'abcd'])
})

test('the 32 ms fallback publishes when animation frames are suspended', () => {
  const time = clock()
  const published: string[] = []
  const stream = createStreamBuffer<string>((value) => published.push(value), time.scheduler)
  stream.begin('response')
  stream.append('response', 'first')
  stream.append('response', ' pending')
  time.advance(31)
  assert.deepEqual(published, ['first'])
  time.advance(1)
  assert.deepEqual(published, ['first', 'first pending'])
  assert.equal(time.frames.size, 0)
})

test('cancellation flushes pending text; discarded callbacks cannot alter the next response', () => {
  const time = clock()
  const published: string[] = []
  const stream = createStreamBuffer<object>((value) => published.push(value), time.scheduler)
  const previous = {}
  const next = {}
  stream.begin(previous)
  stream.append(previous, 'partial')
  stream.append(previous, ' response')
  const staleFrame = [...time.frames][0]!
  stream.flush(previous)
  assert.deepEqual(published, ['partial', 'partial response'])
  stream.discard()
  stream.begin(next)
  stream.append(next, 'new')
  stream.append(next, ' answer')
  staleFrame()
  stream.append(previous, 'late old chunk')
  stream.finish(previous)
  assert.deepEqual(published, ['partial', 'partial response', 'new'])
  time.frame()
  assert.equal(published.at(-1), 'new answer')
})

test('discard during unmount or a rejected request prevents all pending publications', () => {
  const time = clock()
  const published: string[] = []
  const stream = createStreamBuffer<string>((value) => published.push(value), time.scheduler)
  stream.begin('unmounted')
  stream.append('unmounted', 'visible')
  stream.append('unmounted', ' pending')
  const staleFrame = [...time.frames][0]!
  const staleTimer = [...time.timers.keys()][0]!
  stream.discard()
  staleFrame()
  staleTimer()
  stream.finish('unmounted')
  assert.deepEqual(published, ['visible'])
  assert.equal(time.frames.size, 0)
  assert.equal(time.timers.size, 0)
})

test('switching response identities drops old queued text even with the same conversation', () => {
  const time = clock()
  const published: string[] = []
  const stream = createStreamBuffer<object>((value) => published.push(value), time.scheduler)
  const oldRequest = { conversationId: 'same' }
  const newRequest = { conversationId: 'same' }
  stream.begin(oldRequest)
  stream.append(oldRequest, 'old')
  stream.append(oldRequest, ' pending')
  stream.begin(newRequest)
  stream.append(newRequest, 'fresh')
  stream.append(oldRequest, ' stale')
  time.frame()
  time.advance(32)
  assert.deepEqual(published, ['old', 'fresh'])
})

test('tagged deltas reject a previous reply before and after the active reply is identified', () => {
  const response: StreamResponse = {
    conversationId: 'same-chat',
    knownMessageIds: new Set(['old-reply']),
    cancelled: false,
  }
  assert.equal(
    acceptsStreamDelta(response, { conversationId: 'same-chat', replyId: 'old-reply' }),
    false,
  )
  assert.equal(response.replyId, undefined)
  assert.equal(
    acceptsStreamDelta(response, { conversationId: 'other-chat', replyId: 'current-reply' }),
    false,
  )
  assert.equal(
    acceptsStreamDelta(response, { conversationId: 'same-chat', replyId: 'current-reply' }),
    true,
  )
  assert.equal(
    acceptsStreamDelta(response, { conversationId: 'same-chat', replyId: 'foreign-reply' }),
    false,
  )
  assert.equal(
    acceptsStreamDelta(response, { conversationId: 'same-chat', replyId: 'current-reply' }),
    true,
  )
  assert.equal(acceptsStreamDelta(response, { conversationId: 'same-chat' }), true)
  response.cancelled = true
  assert.equal(
    acceptsStreamDelta(response, { conversationId: 'same-chat', replyId: 'current-reply' }),
    false,
  )
})
