const assert = require('node:assert/strict')
const { mkdtemp, mkdir, readFile, writeFile } = require('node:fs/promises')
const { createHash } = require('node:crypto')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const http = require('node:http')
const { app, BrowserWindow } = require('electron')
const label = process.argv.includes('--baseline') ? 'baseline' : 'candidate'
const entryPath = resolve(
  process.argv.find((value) => value.startsWith('--app='))?.slice(6) || 'out/main/index.cjs',
)
const output = resolve('.mwide/benchmarks')
const text = 'x'.repeat(5000)
let sent = false
let holdResponse = false
const server = http.createServer(async (request, response) => {
  for await (const chunk of request) {
    void chunk
  }
  response.setHeader('Content-Type', 'application/json')
  if (request.url === '/api/tags')
    return response.end(JSON.stringify({ models: [{ name: 'fixture' }] }))
  if (request.url === '/api/show')
    return response.end(
      JSON.stringify({
        capabilities: ['completion'],
        model_info: { 'fixture.context_length': 32768 },
      }),
    )
  if (request.url === '/api/chat') {
    sent = true
    response.setHeader('Content-Type', 'application/x-ndjson')
    if (holdResponse) {
      response.write(
        JSON.stringify({ message: { content: 'Fresh guarded partial' }, done: false }) + '\n',
      )
      return
    }
    for (const char of text)
      response.write(JSON.stringify({ message: { content: char }, done: false }) + '\n')
    return response.end(JSON.stringify({ done: true }) + '\n')
  }
  response.statusCode = 404
  response.end('{}')
})
const delay = (time) => new Promise((accept) => setTimeout(accept, time))
async function until(read, name) {
  const started = Date.now()
  while (Date.now() - started < 45000) {
    if (await read()) return
    await delay(30)
  }
  throw new Error(`Timed out: ${name}`)
}
async function run() {
  await mkdir(output, { recursive: true })
  const directory = await mkdtemp(join(process.env.MWIDE_TEST_TMP || tmpdir(), 'mwide-perf-'))
  app.setPath('userData', directory)
  await new Promise((accept) => server.listen(0, '127.0.0.1', accept))
  const createdAt = '2026-10-22T12:00:00.000Z'
  const messages = Array.from({ length: 2000 }, (_, index) => ({
    id: `message-${index}`,
    role: index % 2 ? 'assistant' : 'user',
    content:
      index % 2
        ? `# Decision ${index}\n**Keep the constraint**.\n\n- An earlier decision.\n- An unresolved question.\n\n\`\`\`ts\nconst item${index} = true\n\`\`\``
        : `Earlier request ${index}`,
    createdAt,
    status: 'complete',
  }))
  const state = {
    settings: {
      defaultProvider: 'ollama',
      ollamaUrl: `http://127.0.0.1:${server.address().port}`,
      ollamaModel: 'fixture',
      codexModel: '',
    },
    catalog: [],
    projects: [
      {
        id: 'project',
        name: 'Performance fixture',
        description: 'Measure UI work with identical durable history.',
        rules: '',
        architecture: '',
        catalogIds: [],
        createdAt,
      },
    ],
    conversations: [
      {
        id: 'long-chat',
        projectId: 'project',
        title: 'Long history',
        createdAt,
        messages,
        summary: 'Earlier history retained in storage.',
        summaryThrough: messages.length,
      },
    ],
  }
  state.conversations.unshift({
    id: 'small-chat',
    projectId: 'project',
    title: 'Small history',
    createdAt,
    messages: messages.slice(0, 4).map((message) => ({ ...message, id: `small-${message.id}` })),
    summary: 'Small earlier chat.',
    summaryThrough: 4,
  })
  await writeFile(join(directory, 'workspace.json'), JSON.stringify({ version: 1, state }))
  const created = new Promise((accept) =>
    app.once('browser-window-created', (_event, window) =>
      window.webContents.once('did-finish-load', () => accept(window)),
    ),
  )
  const started = performance.now()
  const mainBundleSha256 = createHash('sha256')
    .update(await readFile(entryPath))
    .digest('hex')
  require(entryPath)
  const window = await created
  window.setContentSize(1280, 800)
  window.webContents.setBackgroundThrottling(false)
  const evaluate = (source) => window.webContents.executeJavaScript(source, true)
  await until(() => evaluate('Boolean(document.querySelector(".message"))'), 'history rendered')
  const initial = await evaluate(
    '({ renderedMessages: document.querySelectorAll(".message").length, domNodes: document.querySelectorAll(".chat-stream *").length, documentScroll: document.documentElement.scrollHeight > window.innerHeight + 1 })',
  )
  const startupMs = Math.round(performance.now() - started)
  assert.equal(initial.documentScroll, false)
  if (label === 'candidate') assert.ok(initial.renderedMessages <= 60)
  else assert.equal(initial.renderedMessages, 2000, 'Baseline mode requires the v1.1.0 build.')
  await evaluate(`(() => {
    window.perfProbe = { deltaEvents: 0, received: '', mutations: 0, frames: [], lastFrame: performance.now(), active: true };
    window.mwide.workspace.onChatEvent(event => { if (event.type === 'delta') { window.perfProbe.deltaEvents++; window.perfProbe.received += event.text; } });
    new MutationObserver(records => { window.perfProbe.mutations += records.length; }).observe(document.querySelector('.chat-stream'), { subtree: true, characterData: true, childList: true });
    const frame = now => { const p = window.perfProbe; p.frames.push(now - p.lastFrame); p.lastFrame = now; if (p.active) requestAnimationFrame(frame); }; requestAnimationFrame(frame);
    const input = document.querySelector('#chat-message'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, 'Stream the fixture response'); input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`)
  await until(
    () => evaluate('!document.querySelector(".composer button[type=submit]").disabled'),
    'ready to send',
  )
  const streamStarted = performance.now()
  await evaluate('document.querySelector(".composer").requestSubmit()')
  await until(
    async () =>
      sent &&
      (await evaluate(
        '(document.querySelector("#chat-message")?.disabled === false) && document.querySelectorAll(".stream-indicator").length === 0 && window.perfProbe.received.length === 5000',
      )),
    'stream completion',
  )
  const streamMs = Math.round(performance.now() - streamStarted)
  await delay(100)
  const probe = await evaluate(
    `(() => { const p = window.perfProbe; p.active = false; const sorted = p.frames.slice().sort((a,b)=>a-b); return { deltaEvents: p.deltaEvents, received: p.received, mutationRecords: p.mutations, frames: p.frames.length, frameP95Ms: Math.round(sorted[Math.floor(sorted.length * .95)] || 0), maxFrameGapMs: Math.round(Math.max(0, ...p.frames)), renderedMessages: document.querySelectorAll('.message').length, domNodes: document.querySelectorAll('.chat-stream *').length }; })()`,
  )
  assert.equal(probe.received, text)
  delete probe.received
  const saved = await evaluate('window.mwide.workspace.getState()')
  const savedLong = saved.conversations.find((chat) => chat.id === 'long-chat')
  assert.equal(savedLong.messages.length, 2002)
  assert.equal(savedLong.messages.at(-1).content, text)
  if (label === 'candidate') {
    assert.ok(probe.renderedMessages <= 60)
    assert.ok(probe.deltaEvents < 100)
    await evaluate('document.querySelector(".chat-stream").scrollTop = 0')
    await delay(50)
    const anchor = await evaluate(
      `(() => { const element = document.querySelector('.message[data-message-id]'); return { id: element.dataset.messageId, top: element.getBoundingClientRect().top }; })()`,
    )
    await evaluate('document.querySelector(".load-earlier").click()')
    await until(
      () => evaluate('document.querySelectorAll(".message").length === 120'),
      'older history page',
    )
    const after = await evaluate(
      `document.querySelector('[data-message-id="${anchor.id}"]').getBoundingClientRect().top`,
    )
    assert.ok(Math.abs(after - anchor.top) < 3, `History anchor moved by ${after - anchor.top}px`)
    const fill = (value) =>
      evaluate(
        `(() => { const input = document.querySelector('#chat-message'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, ${JSON.stringify(value)}); input.dispatchEvent(new Event('input', { bubbles: true })); })()`,
      )
    await fill('Draft kept across conversations')
    await evaluate(
      `[...document.querySelectorAll('.conversation-item')].find(item => item.textContent.includes('Small history')).click()`,
    )
    await until(
      () => evaluate('document.querySelectorAll(".message").length === 4'),
      'small chat switch',
    )
    assert.equal(await evaluate('document.querySelector("#chat-message").value'), '')
    await evaluate(
      `[...document.querySelectorAll('.conversation-item')].find(item => item.textContent.includes('Long history')).click()`,
    )
    await until(
      () => evaluate('document.querySelectorAll(".message").length === 60'),
      'history page reset',
    )
    assert.equal(
      await evaluate('document.querySelector("#chat-message").value'),
      'Draft kept across conversations',
    )
    holdResponse = true
    await fill('Start another guarded response')
    await until(
      () => evaluate('!document.querySelector(".composer button[type=submit]").disabled'),
      'guarded response ready',
    )
    await evaluate('document.querySelector(".composer").requestSubmit()')
    await until(
      () =>
        evaluate(
          'document.querySelector(".message.streaming")?.textContent.includes("Fresh guarded partial")',
        ),
      'guarded stream visible',
    )
    window.webContents.send('mwide:chat', {
      type: 'delta',
      conversationId: 'long-chat',
      replyId: savedLong.messages.at(-1).id,
      text: 'OLD_REPLY_MUST_NOT_APPEAR',
    })
    window.webContents.send('mwide:chat', {
      type: 'delta',
      conversationId: 'long-chat',
      replyId: 'foreign-reply',
      text: 'FOREIGN_REPLY_MUST_NOT_APPEAR',
    })
    await delay(80)
    assert.equal(
      await evaluate(
        'document.querySelector(".message.streaming").textContent.includes("MUST_NOT_APPEAR")',
      ),
      false,
    )
    await evaluate(
      `[...document.querySelectorAll('.composer button')].find(item => item.textContent.includes('Stop response')).click()`,
    )
    await until(
      () => evaluate('!document.querySelector("#chat-message").disabled'),
      'guarded cancellation settled',
    )
    const cancelled = (await evaluate('window.mwide.workspace.getState()')).conversations
      .find((chat) => chat.id === 'long-chat')
      .messages.at(-1)
    assert.equal(cancelled.status, 'interrupted')
    assert.equal(cancelled.content, 'Fresh guarded partial')
  }
  const report = {
    label,
    mainBundleSha256,
    fixtureMessages: 2000,
    burstDeltas: text.length,
    initial,
    startupMs,
    streamMs,
    ...probe,
    historyIntact: true,
    textIntact: true,
    note: 'Single local fixture run; timings are descriptive, not a stable latency guarantee or competitor benchmark.',
  }
  await writeFile(join(output, `desktop-${label}.json`), JSON.stringify(report, null, 2))
  await writeFile(
    join(output, `desktop-${label}.png`),
    (await window.webContents.capturePage()).toPNG(),
  )
  console.log(JSON.stringify(report, null, 2))
  assert.equal(BrowserWindow.getAllWindows().length, 1)
}
setTimeout(() => {
  console.error('Desktop benchmark timed out.')
  app.exit(1)
}, 90000).unref()
run()
  .then(() => {
    server.closeAllConnections()
    server.close()
    app.exit(0)
  })
  .catch((error) => {
    console.error(error)
    server.closeAllConnections()
    server.close()
    app.exit(1)
  })
