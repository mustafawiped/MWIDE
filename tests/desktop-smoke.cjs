const assert = require('node:assert/strict')
const { mkdtemp, mkdir, readFile, writeFile } = require('node:fs/promises')
const http = require('node:http')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { app, BrowserWindow } = require('electron')

const requests = []
let serviceAvailable = true
let holdSummary = false
let summaryHeld = false
const summary = 'Decision: keep isolated adapters. Next: verify project continuity.'
const project = {
  name: 'Continuity test',
  description: '  Preserve the complete purpose 🧭\nAcross every conversation.  ',
  rules: 'Never omit project rules.',
  architecture: 'React interface, isolated adapters, durable project context.',
}

const server = http.createServer(async (request, response) => {
  try {
    let raw = ''
    for await (const part of request) raw += part
    const payload = raw ? JSON.parse(raw) : {}
    response.setHeader('Content-Type', 'application/json')
    if (!serviceAvailable) {
      response.statusCode = 503
      response.end(JSON.stringify({ error: 'The local test service is unavailable.' }))
      return
    }
    if (request.url === '/api/tags') {
      response.end(JSON.stringify({ models: [{ name: 'fixture:local' }] }))
    } else if (request.url === '/api/show') {
      response.end(
        JSON.stringify({
          capabilities: ['completion'],
          model_info: { 'fixture.context_length': 32768 },
        }),
      )
    } else if (request.url === '/api/chat') {
      requests.push(payload)
      const instructions = payload.messages[0].content
      let text = 'The project context is available.'
      if (instructions.includes('Recommend only useful entries')) {
        const catalog = JSON.parse(instructions.slice(instructions.lastIndexOf('\n') + 1))
        text = JSON.stringify([{ id: catalog[0].id, reason: 'Useful for testing this project.' }])
      } else if (instructions.includes('Update a compact conversation memory')) {
        if (holdSummary) {
          summaryHeld = true
          response.writeHead(200, { 'Content-Type': 'application/x-ndjson' })
          response.flushHeaders()
          return
        }
        text = summary
      }
      response.setHeader('Content-Type', 'application/x-ndjson')
      if (payload.messages.at(-1).content === 'Cancel this response') {
        response.write(
          JSON.stringify({ message: { content: 'Partial response' }, done: false }) + '\n',
        )
        return
      }
      response.write(JSON.stringify({ message: { content: text.slice(0, 8) }, done: false }) + '\n')
      response.end(JSON.stringify({ message: { content: text.slice(8) }, done: true }) + '\n')
    } else {
      response.statusCode = 404
      response.end('{}')
    }
  } catch (error) {
    response.statusCode = 500
    response.end(JSON.stringify({ error: error.message }))
  }
})

async function run() {
  const base = resolve(process.env.MWIDE_TEST_TMP || tmpdir())
  await mkdir(base, { recursive: true })
  const directory = await mkdtemp(join(base, 'mwide-desktop-'))
  app.setPath('userData', directory)
  await new Promise((accept, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', accept)
  })
  const created = new Promise((accept) =>
    app.once('browser-window-created', (_event, window) => {
      window.webContents.once('did-finish-load', () => accept(window))
    }),
  )
  require('../out/main/index.cjs')
  const window = await created
  const evaluate = async (source) => {
    let result
    try {
      result = await window.webContents.executeJavaScript(
        `(async () => { try { return (${source}); } catch (error) { return { __smokeError: error.message, stack: error.stack }; } })()`,
      )
    } catch (error) {
      throw new Error(`Renderer operation failed: ${source.slice(0, 300)}`, { cause: error })
    }
    if (result?.__smokeError)
      throw new Error(`${result.__smokeError}\n${result.stack}\nOperation: ${source.slice(0, 250)}`)
    return result
  }
  const state = () => evaluate('window.mwide.workspace.getState()')
  const until = async (predicate, label) => {
    const deadline = Date.now() + 10000
    while (Date.now() < deadline) {
      if (await predicate()) return
      await new Promise((accept) => setTimeout(accept, 25))
    }
    throw new Error(`Timed out: ${label}`)
  }
  const click = async (label, selector = 'button') => {
    await until(
      () =>
        evaluate(
          `Boolean([...document.querySelectorAll(${JSON.stringify(selector)})].find(e => !e.disabled && e.textContent.trim().replace(/\\s+/g, ' ') === ${JSON.stringify(label)}))`,
        ),
      label,
    )
    await evaluate(
      `[...document.querySelectorAll(${JSON.stringify(selector)})].find(e => !e.disabled && e.textContent.trim().replace(/\\s+/g, ' ') === ${JSON.stringify(label)}).click()`,
    )
  }
  const fill = async (selector, value) => {
    await evaluate(
      `(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) throw Error('Missing field'); Object.getOwnPropertyDescriptor(Object.getPrototypeOf(e), 'value').set.call(e, ${JSON.stringify(value)}); e.dispatchEvent(new Event(e.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); })()`,
    )
  }
  await until(
    () => evaluate("document.querySelector('h1')?.textContent === 'Projects'"),
    'workspace startup',
  )
  assert.equal(await evaluate("Boolean(document.querySelector('.preview-banner'))"), false)
  const preferences = window.webContents.getLastWebPreferences()
  assert.equal(preferences.sandbox, true)
  assert.equal(preferences.contextIsolation, true)
  assert.equal(preferences.nodeIntegration, false)
  const settings = {
    ...(await state()).settings,
    defaultProvider: 'ollama',
    ollamaUrl: `http://127.0.0.1:${server.address().port}`,
    ollamaModel: 'fixture:local',
  }
  await evaluate(`window.mwide.workspace.saveSettings(${JSON.stringify(settings)})`)
  await click('ProvidersModels & connections', '.nav-item')
  await click('Check connection', '.provider-card:last-child button')
  await until(
    () =>
      evaluate(
        'document.querySelector(".provider-card:last-child .connection-detail").classList.contains("connected-text")',
      ),
    'Ollama connection discovery',
  )
  assert.equal(
    await evaluate('document.querySelector(".provider-card:last-child select").value'),
    'fixture:local',
  )
  await click('CatalogMCPs & Skills', '.nav-item')
  await click('Add entry')
  await fill('select', 'skill')
  await fill('input[name="name"]', 'Focused tests')
  await fill('textarea[name="description"]', 'Testing project behavior')
  await fill('textarea[name="instructions"]', 'Verify outcomes before committing.')
  await click('Save entry')
  await until(async () => (await state()).catalog.length === 1, 'catalog persistence')
  await click('ProjectsYour work, in context', '.nav-item')
  await click('New project')
  await click('Create project')
  await until(
    () =>
      evaluate("document.querySelector('[name=name]')?.getAttribute('aria-invalid') === 'true'"),
    'required field validation',
  )
  await fill('input[name="name"]', project.name)
  await click('ProvidersModels & connections', '.nav-item')
  await until(
    () => evaluate('Boolean(document.querySelector("dialog[open]"))'),
    'discard confirmation',
  )
  assert.equal(await evaluate('document.activeElement.textContent.trim()'), 'Keep editing')
  await click('Keep editing')
  assert.equal(await evaluate('document.querySelector("[name=name]").value'), project.name)
  await fill('textarea[name="description"]', project.description)
  await fill('textarea[name="rules"]', project.rules)
  await fill('textarea[name="architecture"]', project.architecture)
  await click('Recommend MCPs & Skills')
  await click('Apply recommendations')
  await click('Create project')
  await until(async () => (await state()).projects.length === 1, 'project persistence')
  const saved = (await state()).projects[0]
  for (const [field, value] of Object.entries(project)) assert.equal(saved[field], value)
  assert.equal(saved.catalogIds.length, 1)
  await click('New conversation')
  await until(
    () => evaluate('!document.querySelector("#chat-message").disabled'),
    'new conversation',
  )
  await fill('#chat-message', 'Do not submit during IME composition')
  await evaluate(
    'document.querySelector("#chat-message").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, isComposing: true, bubbles: true }))',
  )
  assert.equal((await state()).conversations[0].messages.length, 0)
  serviceAvailable = false
  await click('Send')
  await until(
    () =>
      evaluate(
        'Boolean(document.querySelector(".global-error")) && !document.querySelector("#chat-message").disabled',
      ),
    'connection failure recovery',
  )
  assert.equal(
    await evaluate('document.querySelector("#chat-message").value'),
    'Do not submit during IME composition',
  )
  assert.equal((await state()).conversations[0].messages.length, 0)
  serviceAvailable = true
  await fill('#chat-message', 'Remember the architecture decision')
  await click('Send')
  await until(
    async () => (await state()).conversations[0].messages[1]?.status === 'complete',
    'streamed response',
  )
  await until(
    () => evaluate('!document.querySelector("#chat-message").disabled'),
    'response completion',
  )
  await evaluate(`document.querySelector('[aria-label="New conversation"]').click()`)
  await until(async () => (await state()).conversations.length === 2, 'cross-chat summary')
  await until(
    () => evaluate('!document.querySelector("#chat-message").disabled'),
    'second conversation',
  )
  await fill('#chat-message', 'Continue in this conversation')
  await click('Send')
  await until(
    async () => (await state()).conversations[1].messages[1]?.status === 'complete',
    'second response',
  )
  const context = requests.at(-1).messages[0].content
  for (const field of ['description', 'rules', 'architecture'])
    assert.ok(context.includes(project[field]))
  assert.ok(context.includes(summary))
  assert.ok(context.includes('Verify outcomes before committing.'))
  await until(
    () => evaluate('!document.querySelector("#chat-message").disabled'),
    'ready to cancel',
  )
  await fill('#chat-message', 'Cancel this response')
  await click('Send')
  await until(
    () => evaluate('document.body.textContent.includes("Partial response")'),
    'partial stream',
  )
  await click('Stop response')
  await until(
    async () => (await state()).conversations[1].messages[3]?.content === 'Partial response',
    'interrupted response saved',
  )
  assert.equal((await state()).conversations[1].messages[3].status, 'interrupted')
  for (let index = 0; index < 3; index++) {
    await until(
      () => evaluate('!document.querySelector("#chat-message").disabled'),
      'next message ready',
    )
    await fill('#chat-message', `Continue ${index}`)
    await click('Send')
    await until(
      async () =>
        (await state()).conversations[1].messages.length === 6 + index * 2 &&
        (await state()).conversations[1].messages.at(-1).status === 'complete',
      'response before compaction',
    )
  }
  await until(
    () => evaluate('!document.querySelector("#chat-message").disabled'),
    'compaction message ready',
  )
  holdSummary = true
  await fill('#chat-message', 'Trigger automatic memory compaction')
  await click('Send')
  await until(
    async () =>
      summaryHeld && (await state()).conversations[1].messages.at(-1).status === 'complete',
    'response saved while memory is pending',
  )
  await until(
    () =>
      evaluate(
        'document.querySelectorAll(".message.assistant").length === 6 && document.querySelectorAll(".stream-indicator").length === 0',
      ),
    'saved response displayed only once during compaction',
  )
  await click('Stop memory update')
  await until(
    () => evaluate('!document.querySelector("#chat-message").disabled'),
    'memory cancellation',
  )
  assert.equal((await state()).conversations[1].messages.at(-1).status, 'complete')
  const beforeReload = await state()
  await window.webContents.reload()
  await until(
    () => evaluate("document.querySelector('h1')?.textContent === 'Projects'"),
    'workspace reload',
  )
  assert.deepEqual(await state(), beforeReload)
  const disk = JSON.parse(await readFile(join(directory, 'workspace.json'), 'utf8'))
  assert.deepEqual(disk.state, beforeReload)
  assert.equal(BrowserWindow.getAllWindows().length, 1)
  if (process.env.MWIDE_SCREENSHOT) {
    await evaluate('document.querySelector(".project-card").click()')
    await evaluate(
      'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
    )
    await writeFile(process.env.MWIDE_SCREENSHOT, (await window.webContents.capturePage()).toPNG())
    window.setSize(980, 700)
    await evaluate(
      'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
    )
    assert.ok(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'))
    await writeFile(
      process.env.MWIDE_SCREENSHOT.replace('.png', '-narrow.png'),
      (await window.webContents.capturePage()).toPNG(),
    )
  }
  console.log(
    'Desktop smoke passed: real preload/IPC, forms, catalog, recommendations, streams, cancellation, cross-chat context, reload and durable storage.',
  )
}

setTimeout(() => {
  console.error('Desktop smoke exceeded 60 seconds.')
  app.exit(1)
}, 60000).unref()
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
