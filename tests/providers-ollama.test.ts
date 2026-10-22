import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { test } from 'node:test'
import type { TestContext } from 'node:test'
import { OllamaProvider, validateOllamaUrl } from '../src/providers/ollama.ts'
import type { GenerationRequest } from '../src/core/model.ts'

interface CapturedRequest {
  path: string
  body: Record<string, unknown>
}

async function fixture(
  t: TestContext,
  handle: (
    request: IncomingMessage,
    response: ServerResponse,
    body: Record<string, unknown>,
  ) => void,
  options: { requestTimeoutMs?: number; generationTimeoutMs?: number } = {},
): Promise<{ provider: OllamaProvider; requests: CapturedRequest[] }> {
  const requests: CapturedRequest[] = []
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    const content = Buffer.concat(chunks).toString('utf8')
    const body = content ? (JSON.parse(content) as Record<string, unknown>) : {}
    requests.push({ path: request.url ?? '', body })
    handle(request, response, body)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const provider = new OllamaProvider(
    `http://localhost:${(server.address() as AddressInfo).port}`,
    options,
  )
  t.after(async () => {
    provider.dispose()
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
  })
  return { provider, requests }
}

function metadata(response: ServerResponse, extra: Record<string, unknown> = {}): void {
  response.end(
    JSON.stringify({
      capabilities: ['completion', 'thinking'],
      template: '{{ .Messages }}',
      model_info: { 'general.architecture': 'qwen2', 'qwen2.context_length': 32768 },
      ...extra,
    }),
  )
}

function generation(overrides: Partial<GenerationRequest> = {}): GenerationRequest {
  return {
    model: 'test:local',
    instructions: 'Purpose: build MWIDE. Architecture: isolated desktop providers.',
    messages: [{ role: 'user', content: 'Continue the project.' }],
    signal: new AbortController().signal,
    ...overrides,
  }
}

test('Ollama accepts loopback HTTP only and never paths, credentials or remote endpoints', () => {
  for (const valid of ['http://localhost:11434', 'http://127.0.0.1:11434/', 'http://[::1]:11434']) {
    assert.doesNotThrow(() => validateOllamaUrl(valid))
  }
  for (const invalid of [
    'https://localhost',
    'http://127.0.0.2',
    'http://example.com',
    'file:///tmp',
    'http://user:secret@localhost',
    'http://localhost/api',
    'http://localhost?x=1',
    'http://localhost/#part',
    'not a URL',
  ]) {
    assert.throws(() => validateOllamaUrl(invalid), /local|loopback/)
  }
})

test('Ollama discovers supported local completion models and filters cloud and embedding models', async (t) => {
  const { provider } = await fixture(t, (request, response, body) => {
    if (request.url === '/api/tags')
      response.end(
        JSON.stringify({
          models: [
            { name: 'local' },
            { name: 'cloud:cloud' },
            { name: 'embed' },
            { name: 'removed' },
            { name: 'local' },
          ],
        }),
      )
    else if (body.model === 'embed') metadata(response, { capabilities: ['embedding'] })
    else if (body.model === 'cloud:cloud')
      metadata(response, { remote_host: 'https://remote.example' })
    else if (body.model === 'removed') {
      response.statusCode = 404
      response.end()
    } else metadata(response)
  })
  assert.deepEqual(await provider.inspect(), {
    id: 'ollama',
    connected: true,
    detail: 'Local Ollama is ready.',
    models: ['local'],
  })
})

test('Ollama preserves project instructions and history while decoding split UTF-8 NDJSON', async (t) => {
  const parts: string[] = []
  const { provider, requests } = await fixture(t, (request, response) => {
    if (request.url === '/api/show') return metadata(response)
    const bytes = Buffer.from(
      `${JSON.stringify({ message: { role: 'assistant', content: 'Merhaba, dünya 🌍' }, done: false })}\n${JSON.stringify({ message: { role: 'assistant', content: '!' }, done: true })}`,
    )
    const split = bytes.indexOf(Buffer.from('🌍')) + 2
    response.write(bytes.subarray(0, split))
    setImmediate(() => response.end(bytes.subarray(split)))
  })
  const input = generation({
    messages: [
      { role: 'user', content: 'Earlier question' },
      { role: 'assistant', content: 'Earlier answer' },
      { role: 'user', content: 'Continue' },
    ],
    onDelta: (text) => parts.push(text),
  })
  assert.equal(await provider.generate(input), 'Merhaba, dünya 🌍!')
  assert.equal(parts.join(''), 'Merhaba, dünya 🌍!')
  const body = requests.find((request) => request.path === '/api/chat')!.body
  assert.deepEqual(body.messages, [
    { role: 'system', content: input.instructions },
    ...input.messages,
  ])
  assert.deepEqual(body.options, { num_ctx: 4096, num_predict: 2048 })
  assert.equal(body.think, false)
  assert.equal(body.stream, true)
  assert.equal(body.truncate, false)
  assert.equal(body.shift, false)
})

test('Ollama refuses incomplete, invalid, errored, empty and tool responses', async (t) => {
  for (const [content, error] of [
    [JSON.stringify({ message: { content: 'partial' }, done: false }), /before completing/],
    ['invalid\n', /invalid stream data/],
    [JSON.stringify({ error: 'model is unavailable' }), /model is unavailable/],
    [JSON.stringify({ done: true }), /without a text response/],
    [
      JSON.stringify({ message: { tool_calls: [{ function: { name: 'shell' } }] }, done: true }),
      /Tool calls/,
    ],
    [
      `${JSON.stringify({ message: { content: 'answer' }, done: true })}\n${JSON.stringify({ done: true })}\n`,
      /after completing/,
    ],
  ] as const) {
    await t.test(String(error), async (subtest) => {
      const { provider } = await fixture(subtest, (request, response) =>
        request.url === '/api/show' ? metadata(response) : response.end(content),
      )
      await assert.rejects(provider.generate(generation()), error)
    })
  }
})

test('Ollama refuses context overflow without truncating or issuing a chat request', async (t) => {
  const { provider, requests } = await fixture(t, (_request, response) =>
    metadata(response, { model_info: { 'test.context_length': 4096 } }),
  )
  await assert.rejects(
    provider.generate(generation({ instructions: 'Purpose and architecture. '.repeat(150) })),
    /context budget.*not truncated/,
  )
  assert.deepEqual(
    requests.map((request) => request.path),
    ['/api/show'],
  )
})

test('Ollama rejects output-limit and unsupported completion reasons while retaining partial deltas', async (t) => {
  for (const reason of ['length', 'cancelled', null]) {
    await t.test(String(reason), async (subtest) => {
      const deltas: string[] = []
      const { provider } = await fixture(subtest, (request, response) => {
        if (request.url === '/api/show') return metadata(response)
        response.end(
          JSON.stringify({
            message: { role: 'assistant', content: 'The unfinished response' },
            done: true,
            done_reason: reason,
          }),
        )
      })
      await assert.rejects(
        provider.generate(generation({ onDelta: (text) => deltas.push(text) })),
        reason === 'length'
          ? /output limit.*Partial output was not accepted/
          : /unsupported completion reason/,
      )
      assert.equal(deltas.join(''), 'The unfinished response')
    })
  }
})

test('Ollama accepts a normal stop completion reason', async (t) => {
  const { provider } = await fixture(t, (request, response) => {
    if (request.url === '/api/show') return metadata(response)
    response.end(
      JSON.stringify({
        message: { content: 'Complete response.' },
        done: true,
        done_reason: 'stop',
      }),
    )
  })
  assert.equal(await provider.generate(generation()), 'Complete response.')
})

test('Ollama grows the allocated context when full project memory needs it', async (t) => {
  const { provider, requests } = await fixture(t, (request, response) => {
    if (request.url === '/api/show') return metadata(response)
    response.end(JSON.stringify({ message: { content: 'Accepted.' }, done: true }))
  })
  const instructions = 'Purpose: MWIDE. Architecture: isolated providers. '.repeat(80)
  assert.equal(await provider.generate(generation({ instructions })), 'Accepted.')
  const body = requests.find((request) => request.path === '/api/chat')!.body
  assert.deepEqual(body.options, { num_ctx: 8192, num_predict: 2048 })
  assert.equal((body.messages as { content: string }[])[0].content, instructions)
})

test('Ollama refuses missing context metadata, remote models and incompatible capabilities', async (t) => {
  for (const [extra, error] of [
    [{ model_info: {} }, /context length/],
    [{ remote_model: 'remote' }, /Only local/],
    [{ capabilities: ['embedding'] }, /does not support chat/],
  ] as const) {
    await t.test(String(error), async (subtest) => {
      const { provider, requests } = await fixture(subtest, (_request, response) =>
        metadata(response, extra),
      )
      await assert.rejects(provider.generate(generation()), error)
      assert.equal(requests.length, 1)
    })
  }
})

test('Ollama cancellation closes in-flight requests and pre-aborted work never connects', async (t) => {
  const controller = new AbortController()
  const { provider, requests } = await fixture(t, (request, response) => {
    if (request.url === '/api/show') return metadata(response)
    response.write(`${JSON.stringify({ message: { content: 'partial' }, done: false })}\n`)
  })
  await assert.rejects(
    provider.generate(generation({ signal: controller.signal, onDelta: () => controller.abort() })),
    { name: 'AbortError' },
  )
  const count = requests.length
  await assert.rejects(provider.generate(generation({ signal: controller.signal })), {
    name: 'AbortError',
  })
  assert.equal(requests.length, count)
})

test('Ollama rejects stalled responses, HTTP redirects and oversized stream messages', async (t) => {
  for (const kind of ['timeout', 'redirect', 'oversized'] as const) {
    await t.test(kind, async (subtest) => {
      const { provider } = await fixture(
        subtest,
        (request, response) => {
          if (request.url === '/api/show') return metadata(response)
          if (kind === 'timeout') return
          if (kind === 'redirect') {
            response.writeHead(302, { Location: 'https://remote.example' })
            response.end()
            return
          }
          response.end(JSON.stringify({ message: { content: 'x'.repeat(300_000) }, done: true }))
        },
        { generationTimeoutMs: 100 },
      )
      await assert.rejects(
        provider.generate(generation()),
        kind === 'timeout'
          ? /timed out/
          : kind === 'redirect'
            ? /HTTP 302/
            : /oversized|buffer limit/,
      )
    })
  }
})

test('Ollama dispose cancels ongoing generation', async (t) => {
  const { provider } = await fixture(t, (request, response) => {
    if (request.url === '/api/show') return metadata(response)
    response.write(`${JSON.stringify({ message: { content: 'partial' }, done: false })}\n`)
  })
  await assert.rejects(provider.generate(generation({ onDelta: () => provider.dispose() })), {
    name: 'AbortError',
  })
})
