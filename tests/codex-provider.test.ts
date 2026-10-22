import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import type { TestContext } from 'node:test'
import { CodexProvider } from '../src/providers/codex.ts'
import type { GenerationRequest } from '../src/core/model.ts'

interface Scenario {
  account?: 'signed-out' | 'chatgpt' | 'apiKey'
  policy?: 'mcp' | 'plugin' | 'tools'
  loginUrl?: string
  behavior?: 'success' | 'failed' | 'empty' | 'stall' | 'tool' | 'invalid' | 'exit' | 'rpc-error'
  models?: unknown
  usageLimits?: unknown
  usageFailure?: boolean
  finishAfterUsage?: boolean
  finishAfterModelRead?: boolean
}

// A real, separate process exercises JSONL framing, request ordering, early
// notifications, interruption and process teardown without accessing an account.
const serverSource = String.raw`
const readline = require('node:readline');
const {appendFileSync} = require('node:fs');
const scenario = JSON.parse(process.argv[1]);
const log = process.argv[2];
const features = JSON.parse(process.argv[3]);
const send = (message) => process.stdout.write(JSON.stringify(message) + '\n');
const event = (method, params) => send({method, params});
readline.createInterface({input: process.stdin}).on('line', line => {
  const message = JSON.parse(line);
  appendFileSync(log, line + '\n');
  if (!message.id) return;
  const reply = result => send({id: message.id, result});
  switch (message.method) {
    case 'initialize': return reply({});
    case 'config/read': {
      const config = {features, web_search:'disabled', mcp_servers:{}, plugins:{}};
      if (scenario.policy === 'mcp') config.mcp_servers.test = {};
      if (scenario.policy === 'plugin') config.plugins.test = {};
      if (scenario.policy === 'tools') config.features.shell_tool = true;
      return reply({config});
    }
    case 'account/read': return reply({account: scenario.account === 'signed-out' ? null : {type:scenario.account || 'chatgpt', planType:'test'}});
    case 'model/list': {
      reply(Object.hasOwn(scenario,'models') ? {data:scenario.models,nextCursor:null} : message.params.cursor ? {data:[{model:'default',isDefault:true},{model:'other'},{model:'hidden',hidden:true}],nextCursor:null} : {data:[{model:'other'}],nextCursor:'page2'});
      if (scenario.finishAfterModelRead) setTimeout(() => event('turn/completed',{threadId:'thread-1',turn:{id:'turn-1',status:'completed'}}),50);
      return;
    }
    case 'account/rateLimits/read': {
      if (scenario.usageFailure) send({id:message.id,error:{code:-1,message:'Usage unavailable'}});
      else reply(Object.hasOwn(scenario,'usageLimits') ? scenario.usageLimits : {rateLimits:{primary:{usedPercent:25,windowDurationMins:300,resetsAt:1800000000},secondary:null}});
      if (scenario.finishAfterUsage) setTimeout(() => event('turn/completed',{threadId:'thread-1',turn:{id:'turn-1',status:'completed'}}),50);
      return;
    }
    case 'account/login/start': return reply({type:'chatgpt',loginId:'login-1',authUrl:scenario.loginUrl || 'https://auth.openai.com/authorize?state=test'});
    case 'account/login/cancel': return reply({status:'canceled'});
    case 'thread/start': return reply({thread:{id:'thread-1'}});
    case 'thread/inject_items': return reply({});
    case 'turn/interrupt': {
      reply({});
      return event('turn/completed',{threadId:'thread-1',turn:{id:'turn-1',status:'interrupted'}});
    }
    case 'turn/start': {
      const behavior = scenario.behavior || 'success';
      if (behavior === 'invalid') return process.stdout.write('invalid JSON\n');
      if (behavior === 'exit') return process.exit(9);
      if (behavior === 'rpc-error') return send({id:message.id,error:{code:-1,message:'Cannot start turn'}});
      event('turn/started',{threadId:'thread-1',turn:{id:'turn-1',status:'inProgress'}});
      reply({turn:{id:'turn-1'}});
      if (behavior === 'tool') return send({id:1000,method:'item/commandExecution/requestApproval',params:{threadId:'thread-1'}});
      event('item/agentMessage/delta',{threadId:'unrelated',turnId:'turn-1',delta:'WRONG'});
      if (behavior !== 'empty') {
        const bytes = Buffer.from(JSON.stringify({method:'item/agentMessage/delta',params:{threadId:'thread-1',turnId:'turn-1',delta:'Hello 🌍'}})+'\n');
        const split = bytes.indexOf(Buffer.from('🌍'))+2;
        process.stdout.write(bytes.subarray(0,split));
        setImmediate(() => {
          process.stdout.write(bytes.subarray(split));
          if (behavior !== 'stall') event('turn/completed',{threadId:'thread-1',turn:{id:'turn-1',status:behavior === 'failed' ? 'failed' : 'completed',error:{message:'Controlled failure'}}});
        });
      } else event('turn/completed',{threadId:'thread-1',turn:{id:'turn-1',status:'completed'}});
      return;
    }
    default: return send({id:message.id,error:{code:-32601,message:'Unknown method'}});
  }
});
`

async function fixture(
  t: TestContext,
  scenario: Scenario = {},
  timeouts: { generationTimeoutMs?: number; requestTimeoutMs?: number } = {},
) {
  const prefix = join(process.env.MWIDE_TEST_TMP ?? tmpdir(), 'mwide-codex-')
  const directory = await mkdtemp(prefix)
  const log = join(directory, 'requests.jsonl')
  let spawnInfo:
    | { args: string[]; env: NodeJS.ProcessEnv; cwd: unknown; shell: unknown; windowsHide: unknown }
    | undefined
  const children: ReturnType<typeof spawn>[] = []
  const provider = new CodexProvider(join(directory, 'profile'), join(directory, 'workspace'), {
    executablePath: process.execPath,
    ...timeouts,
    createProcess: (_executable, args, options) => {
      spawnInfo = {
        args,
        env: options.env!,
        cwd: options.cwd,
        shell: options.shell,
        windowsHide: options.windowsHide,
      }
      const features = Object.fromEntries(
        args
          .filter((arg) => /^features\..+=false$/.test(arg))
          .map((arg) => [arg.slice(9, -6), false]),
      )
      const child = spawn(
        process.execPath,
        ['-e', serverSource, JSON.stringify(scenario), log, JSON.stringify(features)],
        { ...options, stdio: ['pipe', 'pipe', 'pipe'] },
      )
      children.push(child)
      return child
    },
  })
  t.after(async () => {
    provider.dispose()
    await Promise.all(
      children.map((child) =>
        child.exitCode !== null || child.signalCode !== null
          ? Promise.resolve()
          : new Promise<void>((resolve) => child.once('exit', () => resolve())),
      ),
    )
    assert.ok(directory.startsWith(prefix))
    await rm(directory, { recursive: true, force: true })
  })
  return {
    provider,
    directory,
    spawnInfo: () => spawnInfo!,
    requests: async () =>
      (await readFile(log, 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as { method: string; params?: Record<string, unknown> }),
  }
}

function generation(overrides: Partial<GenerationRequest> = {}): GenerationRequest {
  return {
    model: 'default',
    instructions: 'Purpose: MWIDE. Architecture: isolated providers.',
    messages: [{ role: 'user', content: 'Continue.' }],
    signal: new AbortController().signal,
    ...overrides,
  }
}

test('Codex uses a private profile, explicit tool restrictions, no shell and no inherited API credentials', async (t) => {
  const before = process.env.OPENAI_API_KEY
  process.env.OPENAI_API_KEY = 'do-not-inherit'
  t.after(() => {
    if (before === undefined) delete process.env.OPENAI_API_KEY
    else process.env.OPENAI_API_KEY = before
  })
  const context = await fixture(t, { account: 'signed-out' })
  const status = await context.provider.inspect()
  assert.equal(status.connected, false)
  assert.match(status.detail, /Sign in with ChatGPT/)
  const metadata = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  assert.deepEqual(
    (await context.requests()).find((request) => request.method === 'initialize')?.params
      ?.clientInfo,
    { name: 'mwide', title: 'MWIDE', version: metadata.version },
  )
  const info = context.spawnInfo()
  assert.equal(info.env.CODEX_HOME, join(context.directory, 'profile'))
  assert.equal(info.env.OPENAI_API_KEY, undefined)
  assert.equal(info.cwd, join(context.directory, 'workspace'))
  assert.equal(info.shell, false)
  assert.equal(info.windowsHide, true)
  assert.ok(info.args.includes('features.shell_tool=false'))
  assert.ok(info.args.includes('features.unified_exec=false'))
  assert.ok(info.args.includes('web_search="disabled"'))
  assert.ok(info.args.includes('project_doc_max_bytes=0'))
  assert.equal(
    (await context.requests()).some((request) => request.method === 'account/login/start'),
    false,
  )
})

test('Codex discovers paginated ChatGPT models with default first and no duplicates', async (t) => {
  const { provider } = await fixture(t)
  assert.deepEqual((await provider.inspect()).models, ['default', 'other'])
})

test('Codex reports only valid model-dependent reasoning efforts and sends the selected effort', async (t) => {
  const { provider, requests } = await fixture(t, {
    models: [
      {
        model: 'default',
        isDefault: true,
        defaultReasoningEffort: 'medium',
        supportedReasoningEfforts: [
          { reasoningEffort: 'medium', description: 'Balanced\u0000 effort' },
          { reasoningEffort: 'high', description: 'More reasoning' },
          { reasoningEffort: 'high', description: 'Duplicate' },
          { reasoningEffort: 'future-value', description: 'Unknown' },
          null,
        ],
      },
      { model: 'hidden', hidden: true, supportedReasoningEfforts: [{ reasoningEffort: 'max' }] },
      { model: 'legacy' },
      null,
    ],
  })
  assert.deepEqual((await provider.inspect()).modelCapabilities, [
    {
      model: 'default',
      defaultReasoningEffort: 'medium',
      reasoningEfforts: [
        { value: 'medium', description: 'Balanced effort' },
        { value: 'high', description: 'More reasoning' },
      ],
    },
    { model: 'legacy', reasoningEfforts: [] },
  ])
  assert.equal(await provider.generate(generation({ reasoningEffort: 'high' })), 'Hello 🌍')
  assert.equal(
    (await requests()).find((item) => item.method === 'turn/start')?.params?.effort,
    'high',
  )
})

test('Codex refuses unsupported effort before creating a thread and leaves Auto compatible', async (t) => {
  const context = await fixture(t, {
    models: [
      {
        model: 'default',
        supportedReasoningEfforts: [{ reasoningEffort: 'low', description: '' }],
      },
    ],
  })
  await assert.rejects(
    context.provider.generate(generation({ reasoningEffort: 'max' })),
    /does not support/,
  )
  assert.equal(
    (await context.requests()).some((item) => item.method === 'thread/start'),
    false,
  )
  assert.equal(await context.provider.generate(generation()), 'Hello 🌍')
  assert.equal(
    Object.hasOwn(
      (await context.requests()).find((item) => item.method === 'turn/start')!.params!,
      'effort',
    ),
    false,
  )
})

test('Codex usage reads prefer account buckets and retain separate windows with honest null metadata', async (t) => {
  const { provider, requests } = await fixture(t, {
    usageLimits: {
      rateLimits: { primary: { usedPercent: 99 }, secondary: null },
      rateLimitsByLimitId: {
        codex: {
          limitId: 'codex',
          limitName: 'Codex',
          primary: { usedPercent: 25, windowDurationMins: 300, resetsAt: 1800000000 },
          secondary: { usedPercent: 100, windowDurationMins: 10080, resetsAt: null },
        },
        other: {
          limitId: null,
          limitName: null,
          primary: { usedPercent: -10, windowDurationMins: null, resetsAt: null },
          secondary: { usedPercent: 120, windowDurationMins: 'bad', resetsAt: -1 },
        },
      },
    },
  })
  const [limits, sameRead] = await Promise.all([
    provider.getUsageLimits(),
    provider.getUsageLimits(),
  ])
  assert.deepEqual(limits, sameRead)
  assert.equal(limits.available, true)
  assert.ok(Number.isFinite(Date.parse(limits.checkedAt)))
  assert.deepEqual(limits.buckets, [
    {
      id: 'codex',
      name: 'Codex',
      primary: { remainingPercent: 75, windowDurationMins: 300, resetsAt: 1800000000 },
      secondary: { remainingPercent: 0, windowDurationMins: 10080, resetsAt: null },
    },
    {
      id: 'other',
      name: 'other',
      primary: { remainingPercent: 100, windowDurationMins: null, resetsAt: null },
      secondary: { remainingPercent: 0, windowDurationMins: null, resetsAt: null },
    },
  ])
  assert.equal(
    (await requests()).filter((item) => item.method === 'account/rateLimits/read').length,
    1,
  )
  assert.equal(
    (await requests()).some((item) => /reset|purchase|login/.test(item.method)),
    false,
  )
})

test('Codex usage supports legacy snapshots and discards malformed or missing windows', async (t) => {
  const { provider } = await fixture(t, {
    usageLimits: {
      rateLimitsByLimitId: { broken: { primary: { usedPercent: '75' } } },
      rateLimits: {
        limitId: 'codex',
        limitName: ' Account\u0000 limit ',
        primary: { usedPercent: 42.5, windowDurationMins: null, resetsAt: 999999999999999 },
        secondary: null,
      },
    },
  })
  assert.deepEqual((await provider.getUsageLimits()).buckets, [
    {
      id: 'codex',
      name: 'Account limit',
      primary: { remainingPercent: 57.5, windowDurationMins: null, resetsAt: null },
      secondary: null,
    },
  ])
  for (const usageLimits of [null, {}, { rateLimits: { primary: { usedPercent: null } } }]) {
    await t.test(JSON.stringify(usageLimits), async (subtest) => {
      const context = await fixture(subtest, { usageLimits })
      const unavailable = await context.provider.getUsageLimits()
      assert.equal(unavailable.available, false)
      assert.deepEqual(unavailable.buckets, [])
      assert.match(unavailable.detail, /unavailable/)
    })
  }
})

test('Codex usage requires its own ChatGPT sign-in and a read failure never interrupts generation', async (t) => {
  for (const account of ['signed-out', 'apiKey'] as const) {
    await t.test(account, async (subtest) => {
      const { provider, requests } = await fixture(subtest, { account })
      const limits = await provider.getUsageLimits()
      assert.equal(limits.available, false)
      assert.match(limits.detail, /Sign in with ChatGPT in MWIDE/)
      assert.equal(
        (await requests()).some((item) => item.method === 'account/rateLimits/read'),
        false,
      )
    })
  }
  const { provider } = await fixture(t, {
    behavior: 'stall',
    usageFailure: true,
    finishAfterUsage: true,
  })
  let usage: ReturnType<typeof provider.getUsageLimits> | undefined
  assert.equal(
    await provider.generate(
      generation({
        onDelta: () => {
          usage = provider.getUsageLimits()
        },
      }),
    ),
    'Hello 🌍',
  )
  assert.equal((await usage)!.available, false)
})

test('Codex model inspection failure does not close an active generation', async (t) => {
  const { provider } = await fixture(t, {
    behavior: 'stall',
    models: {},
    finishAfterModelRead: true,
  })
  let inspection: ReturnType<typeof provider.inspect> | undefined
  assert.equal(
    await provider.generate(
      generation({
        onDelta: () => {
          inspection = provider.inspect()
        },
      }),
    ),
    'Hello 🌍',
  )
  assert.equal((await inspection)!.connected, false)
  assert.match((await inspection)!.detail, /invalid model catalog/)
})

test('Codex disposal during async startup never spawns a process and is terminal', async (t) => {
  const context = await fixture(t)
  const pending = context.provider.inspect()
  context.provider.dispose()
  const status = await pending
  assert.equal(status.connected, false)
  assert.match(status.detail, /disposed/)
  assert.equal(context.spawnInfo(), undefined)
  await assert.rejects(context.provider.login(), /disposed/)
  await assert.rejects(context.provider.generate(generation()), /disposed/)
  assert.equal(context.spawnInfo(), undefined)
})

test('Codex refuses profiles with MCP, plugins or enabled tools', async (t) => {
  for (const policy of ['mcp', 'plugin', 'tools'] as const) {
    await t.test(policy, async (subtest) => {
      const { provider } = await fixture(subtest, { policy })
      const result = await provider.inspect()
      assert.equal(result.connected, false)
      assert.match(result.detail, /chat-only|isolated profile/i)
    })
  }
})

test('Codex starts explicit hosted login, cancels a previous login and rejects untrusted login URLs', async (t) => {
  const context = await fixture(t, { account: 'signed-out' })
  assert.match((await context.provider.login()).url, /^https:\/\/auth.openai.com\//)
  await context.provider.login()
  const requests = await context.requests()
  assert.deepEqual(requests.find((request) => request.method === 'account/login/cancel')?.params, {
    loginId: 'login-1',
  })
  for (const loginUrl of [
    'http://auth.openai.com/login',
    'https://auth.openai.com.evil.example/login',
    'https://user:secret@auth.openai.com/login',
  ]) {
    await t.test(loginUrl, async (subtest) => {
      const { provider } = await fixture(subtest, { loginUrl })
      await assert.rejects(provider.login(), /untrusted/)
    })
  }
})

test('Codex streams UTF-8, isolates unrelated events and passes complete instructions and conversation history', async (t) => {
  const context = await fixture(t)
  const deltas: string[] = []
  const input = generation({
    messages: [
      { role: 'user', content: 'Previous question' },
      { role: 'assistant', content: 'Previous answer' },
      { role: 'user', content: 'Continue' },
    ],
    onDelta: (text) => deltas.push(text),
  })
  assert.equal(await context.provider.generate(input), 'Hello 🌍')
  assert.deepEqual(deltas, ['Hello 🌍'])
  const requests = await context.requests()
  const thread = requests.find((request) => request.method === 'thread/start')!.params!
  assert.equal(thread.developerInstructions, input.instructions)
  assert.equal(thread.approvalPolicy, 'never')
  assert.equal(thread.sandbox, 'read-only')
  assert.equal(thread.ephemeral, true)
  assert.deepEqual(requests.find((request) => request.method === 'thread/inject_items')?.params, {
    threadId: 'thread-1',
    items: [
      {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'Previous question' }],
      },
      {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'Previous answer' }],
      },
    ],
  })
  assert.deepEqual(requests.find((request) => request.method === 'turn/start')?.params?.input, [
    { type: 'text', text: 'Continue', text_elements: [] },
  ])
})

test('Codex fails closed on protocol errors, tool requests, failed or empty turns and unexpected process exit', async (t) => {
  for (const [behavior, error] of [
    ['failed', /Controlled failure/],
    ['empty', /without a text response/],
    ['tool', /unavailable tool/],
    ['invalid', /invalid protocol data/],
    ['exit', /stopped unexpectedly/],
    ['rpc-error', /Cannot start turn/],
  ] as const) {
    await t.test(behavior, async (subtest) => {
      const { provider } = await fixture(subtest, { behavior })
      await assert.rejects(provider.generate(generation()), error)
    })
  }
})

test('Codex cancellation interrupts the owned turn and rejects partial output', async (t) => {
  const { provider, requests } = await fixture(t, { behavior: 'stall' })
  const controller = new AbortController()
  await assert.rejects(
    provider.generate(generation({ signal: controller.signal, onDelta: () => controller.abort() })),
    { name: 'AbortError' },
  )
  assert.ok((await requests()).some((request) => request.method === 'turn/interrupt'))
})

test('Codex times out stalled generation and rejects concurrent generation', async (t) => {
  const { provider } = await fixture(t, { behavior: 'stall' }, { generationTimeoutMs: 100 })
  let reachedDelta: () => void = () => {}
  const delta = new Promise<void>((resolve) => {
    reachedDelta = resolve
  })
  const generating = provider.generate(generation({ onDelta: reachedDelta }))
  const rejected = assert.rejects(generating, /timed out/)
  await delta
  await assert.rejects(provider.generate(generation()), /already running/)
  await rejected
})

test('Codex rejects unsigned and API-key accounts, pre-aborted requests and oversized input', async (t) => {
  for (const account of ['signed-out', 'apiKey'] as const) {
    await t.test(account, async (subtest) => {
      const { provider, requests } = await fixture(subtest, { account })
      await assert.rejects(provider.generate(generation()), /Sign in with ChatGPT/)
      assert.equal(
        (await requests()).some((request) => request.method === 'thread/start'),
        false,
      )
    })
  }
  const { provider } = await fixture(t)
  await assert.rejects(
    provider.generate(generation({ instructions: 'x'.repeat(100_001) })),
    /input budget.*not truncated/,
  )
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(provider.generate(generation({ signal: controller.signal })), {
    name: 'AbortError',
  })
})
