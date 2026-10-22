import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { WorkspaceService } from '../src/core/workspace.ts'
import { batchChatEvents } from '../src/main/chat-events.ts'

const ref = process.argv.find((value) => value.startsWith('--baseline='))?.slice(11) ?? 'v1.1.0'
const output = resolve('.mwide/benchmarks')
const baseline = await mkdtemp(join(tmpdir(), 'mwide-perf-baseline-'))
await mkdir(join(baseline, 'core'))
for (const name of ['workspace', 'memory', 'validation']) {
  const source = execFileSync('git', ['show', `${ref}:src/core/${name}.ts`], { encoding: 'utf8' })
  await writeFile(join(baseline, 'core', `${name}.ts`), source)
}
await writeFile(join(baseline, 'package.json'), '{"type":"module"}')
const { WorkspaceService: BaselineService } = await import(
  pathToFileURL(join(baseline, 'core', 'workspace.ts')).href
)
const canonical = {
  name: 'Benchmark',
  description: 'CANONICAL_PURPOSE: preserve every project constraint.',
  rules: 'CANONICAL_RULES: failed work is not completed work.',
  architecture: 'CANONICAL_ARCHITECTURE: isolated adapters and durable history.',
  catalogIds: [],
}
const timestamp = '2026-10-22T12:00:00.000Z'
const bytes = (request) =>
  Buffer.byteLength(
    JSON.stringify([{ role: 'system', content: request.instructions }, ...request.messages]),
  ) +
  request.messages.length * 64

async function run(Service, scenario) {
  const store = {
    state: {
      settings: {
        defaultProvider: 'ollama',
        codexModel: '',
        ollamaUrl: 'http://127.0.0.1:11434',
        ollamaModel: 'fixture',
      },
      catalog: [],
      projects: [],
      conversations: [],
    },
    snapshot() {
      return structuredClone(this.state)
    },
    async update(change) {
      const next = this.snapshot()
      change(next)
      this.state = next
      return this.snapshot()
    },
  }
  const metrics = {
    chatCalls: 0,
    summaryCalls: 0,
    inputBytes: 0,
    maxRequestBytes: 0,
    handoffModelCalls: 0,
  }
  const budget = scenario === 'short-handoffs' ? 24000 : 12000
  let finalContext = ''
  const provider = {
    inspect: async () => ({
      id: 'ollama',
      connected: true,
      detail: 'Fixture',
      models: ['fixture'],
    }),
    getInputBudget: async () => budget,
    generate: async (request) => {
      const size = bytes(request)
      assert.ok(size <= budget, `Request ${size} exceeds budget ${budget}`)
      for (const field of ['description', 'rules', 'architecture'])
        assert.ok(request.instructions.includes(canonical[field]))
      metrics.inputBytes += size
      metrics.maxRequestBytes = Math.max(metrics.maxRequestBytes, size)
      if (request.instructions.includes('Update a compact conversation memory')) {
        metrics.summaryCalls++
        const markers = [
          ...new Set(
            (request.instructions + JSON.stringify(request.messages)).match(/\b[DF]\d{2}\b/g) ?? [],
          ),
        ]
        return `Decisions and unresolved failures retained: ${markers.join(' ')}. Interrupted responses remain incomplete.`
      }
      metrics.chatCalls++
      finalContext = request.instructions
      const text =
        'Acknowledged. ' + (request.messages.at(-1).content.match(/\b[DF]\d{2}\b/g) ?? []).join(' ')
      request.onDelta?.(text)
      return text
    },
  }
  const errors = []
  const service = new Service(
    store,
    () => provider,
    (event) => {
      if (event.type === 'error') errors.push(event.message)
    },
  )
  try {
    let state = await service.createProject(canonical)
    const id = state.projects[0].id
    if (scenario === 'short-handoffs') {
      for (let index = 0; index < 12; index++) {
        const before = metrics.chatCalls + metrics.summaryCalls
        state = await service.createConversation(id)
        metrics.handoffModelCalls += metrics.chatCalls + metrics.summaryCalls - before
        const marker = String(index).padStart(2, '0')
        await service.sendMessage({
          conversationId: state.conversations.at(-1).id,
          content: `D${marker}: Keep this decision. F${marker}: A failed test remains unresolved.`,
        })
      }
      for (let index = 0; index < 11; index++) {
        assert.ok(finalContext.includes(`D${String(index).padStart(2, '0')}`))
        assert.ok(finalContext.includes(`F${String(index).padStart(2, '0')}`))
      }
    } else {
      for (let index = 0; index < 24; index++) {
        const marker = String(index).padStart(2, '0')
        store.state.conversations.push({
          id: `archive-${index}`,
          projectId: id,
          title: `Archive ${marker}`,
          createdAt: timestamp,
          summary: '',
          summaryThrough: 0,
          messages: [
            {
              id: `u-${index}`,
              role: 'user',
              content:
                `D${marker}: Preserve the decision. ` + 'Implementation details. '.repeat(18),
              status: 'complete',
              createdAt: timestamp,
            },
            {
              id: `a-${index}`,
              role: 'assistant',
              content:
                `F${marker}: Build failed; unfinished. ` + 'Diagnostic information. '.repeat(18),
              status: index % 2 ? 'failed' : 'interrupted',
              createdAt: timestamp,
            },
          ],
        })
      }
      const histories = store.state.conversations.map((chat) => JSON.stringify(chat.messages))
      store.state.conversations.push({
        id: 'current',
        projectId: id,
        title: 'Current',
        createdAt: timestamp,
        summary: '',
        summaryThrough: 0,
        messages: [],
      })
      await service.sendMessage({
        conversationId: 'current',
        content: 'Continue the project and preserve prior decisions and failures.',
      })
      for (let index = 0; index < 24; index++) {
        assert.equal(JSON.stringify(store.state.conversations[index].messages), histories[index])
        assert.ok(finalContext.includes(`D${String(index).padStart(2, '0')}`))
        assert.ok(finalContext.includes(`F${String(index).padStart(2, '0')}`))
      }
    }
    assert.deepEqual(errors, [])
    assert.ok(store.state.conversations.at(-1).messages.at(-1).status === 'complete')
    return {
      ...metrics,
      protectedFieldsIntact: true,
      historyIntact: true,
      decisionAndFailureMarkersRetained: true,
    }
  } finally {
    service.dispose()
  }
}

const scenarios = []
for (const scenario of ['short-handoffs', 'archive-pressure']) {
  const before = await run(BaselineService, scenario)
  const after = await run(WorkspaceService, scenario)
  scenarios.push({
    scenario,
    baseline: before,
    candidate: after,
    summaryCallsSaved: before.summaryCalls - after.summaryCalls,
    inputBytesSavedPercent: Math.round((1 - after.inputBytes / before.inputBytes) * 1000) / 10,
  })
}
const streamed = []
const batch = batchChatEvents(
  (event) => streamed.push(event),
  () => () => {},
)
for (let index = 0; index < 10000; index++)
  batch.emit({ type: 'delta', conversationId: 'test', replyId: 'reply', text: 'x' })
batch.flush()
batch.dispose()
assert.equal(streamed.map((event) => event.text).join(''), 'x'.repeat(10000))
const report = {
  baselineRef: ref,
  scope:
    'Deterministic same-input fixtures; counts and encoded bytes, not real model latency, billing tokens, semantic-quality scores, or a competitor comparison.',
  scenarios,
  streamBurst: {
    providerDeltas: 10000,
    baselineIPCEvents: 10000,
    candidateIPCEvents: streamed.length,
    textIntact: true,
  },
}
await mkdir(output, { recursive: true })
await writeFile(join(output, 'core.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
