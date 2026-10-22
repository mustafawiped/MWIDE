const assert = require('node:assert/strict')
const { mkdtemp, mkdir, readFile, realpath, writeFile } = require('node:fs/promises')
const http = require('node:http')
const { tmpdir } = require('node:os')
const { dirname, join, resolve } = require('node:path')
const { app, BrowserWindow, dialog, ipcMain } = require('electron')

app.commandLine.appendSwitch('force-prefers-reduced-motion')

const requests = []
let serviceAvailable = true
let holdSummary = false
let summaryHeld = false
let codexUsageAvailable = true
let codexUsageReads = 0
let cancelledFolderSelection = false
const folderSelections = []
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
      let text =
        payload.messages.at(-1).content === 'Show a small TypeScript example.'
          ? '# Example\n**Typed output**\n```ts\nconst ready: boolean = true\n```\n<script>window.modelOutputRan = true</script>'
          : 'The project context is available.'
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
  const selectedFolder = join(directory, 'selected-project')
  const ungrantedFolder = join(directory, 'ungranted-project')
  await mkdir(join(selectedFolder, 'src'), { recursive: true })
  await mkdir(join(selectedFolder, 'node_modules'), { recursive: true })
  await mkdir(ungrantedFolder)
  await Promise.all([
    writeFile(
      join(selectedFolder, 'src', 'entry.ts'),
      'export function initialProjectEntry() { return true }\n',
    ),
    writeFile(join(selectedFolder, '.env'), 'PRIVATE_TOKEN=must-never-reach-provider\n'),
    writeFile(join(selectedFolder, '.gitignore'), 'ignored-private.ts\n'),
    writeFile(
      join(selectedFolder, 'ignored-private.ts'),
      'export const ignoredPrivateSymbol = true\n',
    ),
    writeFile(
      join(selectedFolder, 'node_modules', 'dependency.ts'),
      'export const excludedDependency = true\n',
    ),
  ])
  const canonicalFolder = await realpath(selectedFolder)
  dialog.showOpenDialog = async (_owner, options) => {
    folderSelections.push(options)
    return cancelledFolderSelection
      ? { canceled: true, filePaths: [] }
      : { canceled: false, filePaths: [selectedFolder] }
  }
  // Only account discovery is a fixture. Folder grants, persistence, prompts and all other IPC stay real.
  const realHandle = ipcMain.handle.bind(ipcMain)
  ipcMain.handle = (channel, handler) =>
    realHandle(channel, async (event, method, input) => {
      if (channel === 'mwide:request' && method === 'inspectProvider' && input === 'codex') {
        return {
          id: 'codex',
          connected: true,
          detail: 'Desktop fixture account; no Codex inference is performed.',
          models: ['fixture-codex', 'fixture-codex-other'],
          modelCapabilities: [
            {
              model: 'fixture-codex',
              defaultReasoningEffort: 'medium',
              reasoningEfforts: [
                { value: 'low', description: 'Fixture low effort' },
                { value: 'medium', description: 'Fixture medium effort' },
                { value: 'high', description: 'Fixture high effort' },
              ],
            },
            {
              model: 'fixture-codex-other',
              defaultReasoningEffort: 'low',
              reasoningEfforts: [{ value: 'low', description: 'Fixture low effort only' }],
            },
          ],
        }
      }
      if (channel === 'mwide:request' && method === 'getCodexUsageLimits') {
        codexUsageReads += 1
        return {
          available: codexUsageAvailable,
          detail: codexUsageAvailable
            ? 'Desktop fixture account limits.'
            : 'Fixture account limits are temporarily unavailable.',
          checkedAt: new Date().toISOString(),
          buckets: codexUsageAvailable
            ? [
                {
                  id: 'codex',
                  name: 'Codex',
                  primary: {
                    remainingPercent: 72.5,
                    windowDurationMins: 300,
                    resetsAt: Math.floor(Date.now() / 1_000) + 3_600,
                  },
                  secondary: {
                    remainingPercent: 89,
                    windowDurationMins: 10_080,
                    resetsAt: Math.floor(Date.now() / 1_000) + 604_800,
                  },
                },
                {
                  id: 'review',
                  name: 'Code review',
                  primary: {
                    remainingPercent: 25,
                    windowDurationMins: 1_440,
                    resetsAt: Math.floor(Date.now() / 1_000) + 86_400,
                  },
                  secondary: null,
                },
              ]
            : [],
        }
      }
      return handler(event, method, input)
    })
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
  window.webContents.setBackgroundThrottling(false)
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
  const ensureSidebar = async () => {
    if (!(await evaluate('Boolean(document.querySelector(".sidebar"))'))) {
      await evaluate('document.querySelector(".sidebar-toggle").click()')
      await until(() => evaluate('Boolean(document.querySelector(".sidebar"))'), 'sidebar opens')
    }
  }
  const click = async (label, selector = 'button') => {
    if (['.nav-item', '.conversation-item', '.sidebar-project'].includes(selector))
      await ensureSidebar()
    await until(
      () =>
        evaluate(
          `Boolean([...document.querySelectorAll(${JSON.stringify(selector)})].find(e => !e.disabled && e.textContent.trim().replace(/\\s+/g, ' ') === ${JSON.stringify(label)}))`,
        ),
      label,
    )
    await evaluate(
      `(() => { const target = [...document.querySelectorAll(${JSON.stringify(selector)})].find(e => !e.disabled && e.textContent.trim().replace(/\\s+/g, ' ') === ${JSON.stringify(label)}); const disclosure = target.closest('details'); if (disclosure && !disclosure.open) disclosure.querySelector('summary').click(); target.click(); })()`,
    )
  }
  const fill = async (selector, value) => {
    await evaluate(
      `(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) throw Error('Missing field'); Object.getOwnPropertyDescriptor(Object.getPrototypeOf(e), 'value').set.call(e, ${JSON.stringify(value)}); e.dispatchEvent(new Event(e.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); })()`,
    )
  }
  const settleLayout = () =>
    evaluate(
      'new Promise(resolve => { setTimeout(resolve, 250); requestAnimationFrame(() => requestAnimationFrame(resolve)); })',
    )
  const screenshotDirectory = process.env.MWIDE_SCREENSHOT
    ? dirname(resolve(process.env.MWIDE_SCREENSHOT))
    : resolve('.mwide/test-results')
  await mkdir(screenshotDirectory, { recursive: true })
  window.setMinimumSize(360, 420)
  const inspectLayout = async (screen) => {
    const [originalWidth, originalHeight] = window.getContentSize()
    for (const [width, height] of [
      [1280, 800],
      [980, 600],
      [640, 480],
      [600, 600],
    ]) {
      window.setContentSize(width, height)
      await until(() => evaluate(`window.innerWidth === ${width}`), `${screen} viewport ${width}`)
      await settleLayout()
      const layout = await evaluate(`(() => ({
        viewport: window.innerWidth,
        page: document.documentElement.scrollWidth,
        pageHeight: document.documentElement.scrollHeight,
        viewportHeight: window.innerHeight,
        escapedControls: [...document.querySelectorAll('.main-panel input, .main-panel textarea, .main-panel select, .main-panel button')].filter(element => { const bounds = element.getBoundingClientRect(); return bounds.width > 0 && bounds.height > 0 && !element.closest('.chat-stream') && (bounds.top < -1 || bounds.bottom > window.innerHeight + 1); }).map(element => element.getAttribute('aria-label') || element.name || element.textContent.trim()),
        unexpectedScrollers: [...document.querySelectorAll('body, #root, .app-shell, .main-panel, .page-content, .project-workspace, .chat-main, .provider-panel, .editor-section, .catalog-editor')].filter(element => { const style = getComputedStyle(element); return /(auto|scroll)/.test(style.overflowY) && element.scrollHeight > element.clientHeight + 1; }).map(element => element.className || element.tagName),
        controlsOutsideViewport: [...document.querySelectorAll('input:not([type="hidden"]), textarea, select, button')]
          .filter(element => {
            const bounds = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            return bounds.width > 0 && bounds.height > 0 && style.visibility !== 'hidden'
              && (bounds.left < -1 || bounds.right > window.innerWidth + 1);
          }).map(element => element.getAttribute('aria-label') || element.name || element.textContent.trim()),
        chatGeometry: [...document.querySelectorAll('.project-workspace, .workspace-layout, .chat-main, .chat-stream, .composer')].map(element => ({ class: element.className, height: element.getBoundingClientRect().height, top: element.getBoundingClientRect().top, bottom: element.getBoundingClientRect().bottom, client: element.clientHeight, scroll: element.scrollHeight })),
      }))()`)
      await writeFile(
        join(screenshotDirectory, `${screen}-${width}.png`),
        (await window.webContents.capturePage()).toPNG(),
      )
      assert.ok(
        layout.page <= layout.viewport + 1,
        `${screen} overflows horizontally at ${width}px`,
      )
      assert.deepEqual(
        layout.controlsOutsideViewport,
        [],
        `${screen} has unreachable horizontal controls at ${width}px`,
      )
      assert.ok(
        layout.pageHeight <= layout.viewportHeight + 1,
        screen + ' document scrolls vertically at ' + width + 'x' + height,
      )
      assert.deepEqual(
        layout.escapedControls,
        [],
        screen + ' controls clipped vertically at ' + width + 'x' + height,
      )
      assert.deepEqual(layout.unexpectedScrollers, [], screen + ' unexpected page scrolling')
      if (layout.chatGeometry.length) {
        const composerBounds = layout.chatGeometry.find((element) => element.class === 'composer')
        assert.ok(
          composerBounds.bottom <= height + 1,
          `Chat composer must stay visible: ${JSON.stringify(layout.chatGeometry)}`,
        )
      }
    }
    window.setContentSize(originalWidth, originalHeight)
    await settleLayout()
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
  const theme = await evaluate(`(() => {
    const style = getComputedStyle(document.documentElement);
    const navigation = getComputedStyle(document.querySelector('.nav-item'));
    return {
      background: style.getPropertyValue('--background').trim(),
      main: style.getPropertyValue('--main').trim(),
      accent: style.getPropertyValue('--accent').trim(),
      reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
      transitionDurations: navigation.transitionDuration.split(',').map(parseFloat),
    };
  })()`)
  assert.equal(theme.background, '#f3f3f1')
  assert.equal(theme.main, '#fafaf9')
  assert.equal(theme.accent, '#202020')
  assert.equal(theme.reducedMotion, true)
  assert.ok(theme.transitionDurations.every((duration) => duration <= 0.01))
  await until(
    () =>
      evaluate(
        'Boolean(document.querySelector("img.brand-logo")?.complete && document.querySelector("img.brand-logo")?.naturalWidth > 0)',
      ),
    'loaded brand image',
  )
  window.focus()
  window.webContents.focus()
  assert.equal(await evaluate('document.querySelector(".workspace-menu").open'), false)
  await evaluate('document.querySelector(".workspace-menu > summary").focus()')
  window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Space' })
  window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Space' })
  await until(
    () => evaluate('document.querySelector(".workspace-menu").open'),
    'keyboard opens Workspace menu',
  )
  await evaluate('document.querySelector(".nav-item").focus()')
  window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab' })
  window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab' })
  const keyboardFocus = await evaluate(`(() => {
    const element = document.activeElement;
    const style = getComputedStyle(element);
    const bounds = element.getBoundingClientRect();
    return {
      interactive: element.matches('button, a[href], input, textarea, select, [tabindex="0"]'),
      visible: bounds.width > 0 && bounds.height > 0,
      indicated: (style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0) || style.boxShadow !== 'none',
    };
  })()`)
  assert.deepEqual(keyboardFocus, { interactive: true, visible: true, indicated: true })
  await evaluate('document.activeElement.blur()')
  await evaluate('document.querySelector(".workspace-menu > summary").click()')
  await inspectLayout('projects-empty')
  const settings = {
    ...(await state()).settings,
    defaultProvider: 'ollama',
    ollamaUrl: `http://127.0.0.1:${server.address().port}`,
    ollamaModel: 'fixture:local',
  }
  await evaluate(`window.mwide.workspace.saveSettings(${JSON.stringify(settings)})`)
  await click('ProvidersModels & connections', '.nav-item')
  await click('Ollama', '[role=tab]')
  await click('Check connection', '.provider-panel button')
  await until(
    () =>
      evaluate(
        'document.querySelector(".provider-panel .connection-detail").classList.contains("connected-text")',
      ),
    'Ollama connection discovery',
  )
  assert.equal(
    await evaluate('document.querySelector(".provider-panel select").value'),
    'fixture:local',
  )
  await inspectLayout('providers')
  await click('CatalogMCPs & Skills', '.nav-item')
  await click('Add entry')
  const lastCatalogType = await evaluate(
    'document.querySelector("select").options[document.querySelector("select").options.length - 1].value',
  )
  await evaluate('document.querySelector("select").focus()')
  window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'End' })
  window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'End' })
  await until(
    () => evaluate(`document.querySelector('select').value === ${JSON.stringify(lastCatalogType)}`),
    'native catalog select keyboard selection',
  )
  await fill('select', 'skill')
  await fill('input[name="name"]', 'Focused tests')
  await fill('textarea[name="description"]', 'Testing project behavior')
  await click('Instructions', '[role=tab]')
  await fill('textarea[name="instructions"]', 'Verify outcomes before committing.')
  await inspectLayout('catalog-entry')
  await click('Save entry')
  await until(async () => (await state()).catalog.length === 1, 'catalog persistence')
  await inspectLayout('catalog')
  await click('ProjectsYour work, in context', '.nav-item')
  await click('New project')
  await click('Create project')
  await until(
    () =>
      evaluate("document.querySelector('[name=name]')?.getAttribute('aria-invalid') === 'true'"),
    'required field validation',
  )
  await inspectLayout('project-validation')
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
  await click('Rules', '[role=tab]')
  await fill('textarea[name="rules"]', project.rules)
  await click('Architecture', '[role=tab]')
  await fill('textarea[name="architecture"]', project.architecture)
  await inspectLayout('create-project')
  await click('Folder', '[role=tab]')
  cancelledFolderSelection = true
  await click('Choose folder')
  await until(
    () => evaluate('!document.querySelector(".project-editor fieldset").disabled'),
    'folder selection cancelled',
  )
  assert.equal(
    await evaluate('document.querySelector(".project-folder-path").textContent'),
    'No folder selected',
  )
  cancelledFolderSelection = false
  await click('Choose folder')
  await until(
    () =>
      evaluate(
        `document.querySelector('.project-folder-path')?.textContent === ${JSON.stringify(canonicalFolder)}`,
      ),
    'native folder selected',
  )
  assert.deepEqual(folderSelections.at(-1).properties, ['openDirectory'])
  await inspectLayout('project-folder')
  await click('MCPs & Skills', '[role=tab]')
  await click('Recommend MCPs & Skills')
  await click('Apply recommendations')
  await click('Create project')
  await until(async () => (await state()).projects.length === 1, 'project persistence')
  const saved = (await state()).projects[0]
  for (const [field, value] of Object.entries(project)) assert.equal(saved[field], value)
  assert.equal(saved.catalogIds.length, 1)
  assert.equal(saved.folderPath, canonicalFolder)
  await assert.rejects(
    () =>
      evaluate(
        `window.mwide.workspace.createProject(${JSON.stringify({ ...project, name: 'Unapproved folder', catalogIds: [], folderPath: ungrantedFolder })})`,
      ),
    (error) => /folder picker/.test(error.cause?.message || error.message),
  )
  await assert.rejects(
    () =>
      evaluate(
        `window.mwide.workspace.updateProject(${JSON.stringify({ ...saved, folderPath: ungrantedFolder })})`,
      ),
    (error) => /folder picker/.test(error.cause?.message || error.message),
  )
  assert.equal((await state()).projects.length, 1)
  assert.equal((await state()).projects[0].folderPath, canonicalFolder)
  await inspectLayout('chat-empty')
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
  await evaluate(
    'document.querySelector("#chat-message").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true }))',
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
  await inspectLayout('chat')
  const firstFolderContext = requests.at(-1).messages[0].content
  assert.ok(firstFolderContext.includes('src/entry.ts'))
  assert.ok(firstFolderContext.includes('initialProjectEntry'))
  for (const excluded of [
    '.env',
    'must-never-reach-provider',
    'node_modules',
    'excludedDependency',
    'ignored-private.ts',
    'ignoredPrivateSymbol',
  ])
    assert.equal(
      firstFolderContext.includes(excluded),
      false,
      `Excluded folder data reached AI: ${excluded}`,
    )
  if (process.env.MWIDE_SCREENSHOT)
    await writeFile(process.env.MWIDE_SCREENSHOT, (await window.webContents.capturePage()).toPNG())
  await writeFile(
    join(selectedFolder, 'src', 'later.ts'),
    'export function freshlyAddedEntry() { return true }\n',
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
  assert.ok(context.includes('src/later.ts'))
  assert.ok(context.includes('freshlyAddedEntry'))
  assert.equal(context.includes('.env'), false)
  assert.equal(await evaluate('document.body.textContent.includes("Optimize conversation")'), false)
  const firstTitle = (await state()).conversations[0].title
  const secondTitle = (await state()).conversations[1].title
  await click(firstTitle, '.conversation-item')
  await fill('#chat-message', 'Unsent first conversation draft')
  await click('CatalogMCPs & Skills', '.nav-item')
  await click(firstTitle, '.conversation-item')
  assert.equal(
    await evaluate('document.querySelector("#chat-message").value'),
    'Unsent first conversation draft',
  )
  await click(secondTitle, '.conversation-item')
  assert.equal(await evaluate('document.querySelector("#chat-message").value'), '')
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
    () =>
      evaluate(
        `document.querySelector('.chat-project-name')?.textContent === ${JSON.stringify(project.name)}`,
      ),
    'workspace reload',
  )
  assert.deepEqual(await state(), beforeReload)
  const disk = JSON.parse(await readFile(join(directory, 'workspace.json'), 'utf8'))
  assert.deepEqual(disk.state, beforeReload)
  assert.equal(BrowserWindow.getAllWindows().length, 1)
  assert.equal(await evaluate('document.querySelector(".workspace-menu").open'), false)
  assert.equal(
    await evaluate('document.querySelector(".chat-conversation-title").textContent'),
    beforeReload.conversations.at(-1).title,
  )
  await inspectLayout('chat-focused')
  await click('ProjectsYour work, in context', '.nav-item')
  await inspectLayout('projects-list')
  await click(firstTitle, '.conversation-item')
  await fill('#chat-message', 'Draft retained across projects')
  await click('New project')
  await fill('input[name="name"]', 'Another project')
  await fill('textarea[name="description"]', 'Keep this project separate from the first one.')
  await click('Create project')
  await until(
    () =>
      evaluate('document.querySelector(".chat-project-name")?.textContent === "Another project"'),
    'second project opens in chat',
  )
  assert.equal(await evaluate('document.querySelectorAll(".conversation-item").length'), 0)
  await fill('#chat-message', 'Show a small TypeScript example.')
  await evaluate(
    'document.querySelector("#chat-message").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))',
  )
  await until(
    async () =>
      (await state()).conversations.find((item) => item.projectId !== saved.id)?.messages.at(-1)
        ?.status === 'complete',
    'direct first prompt creates and streams a conversation',
  )
  await until(
    () => evaluate('!document.querySelector("#chat-message").disabled'),
    'first prompt finished',
  )
  assert.equal(
    await evaluate('document.querySelector(".message-code code")?.textContent'),
    'const ready: boolean = true',
  )
  assert.equal(await evaluate('Boolean(window.modelOutputRan)'), false)
  await click('Check AI')
  await until(
    () => evaluate('document.querySelector(".chat-model-status")?.textContent === "Connected"'),
    'inline AI connection',
  )
  await fill('[aria-label="AI provider"]', 'codex')
  await until(
    () => evaluate('Boolean(document.querySelector(".composer-notice"))'),
    'missing AI model guidance',
  )
  await until(
    () =>
      evaluate(
        '[...document.querySelector("[aria-label=\\"AI model\\"]").options].some(item => item.value === "fixture-codex")',
      ),
    'Codex capability discovery',
  )
  await fill('[aria-label="AI model"]', 'fixture-codex')
  await until(
    () => evaluate('!document.querySelector("[aria-label=\\"Reasoning effort\\"]").disabled'),
    'supported reasoning efforts',
  )
  assert.deepEqual(
    await evaluate(
      '[...document.querySelector("[aria-label=\\"Reasoning effort\\"]").options].map(item => item.value)',
    ),
    ['', 'low', 'medium', 'high'],
  )
  await fill('[aria-label="Reasoning effort"]', 'high')
  await until(
    async () => (await state()).settings.reasoningEffort === 'high',
    'reasoning effort persisted',
  )
  await until(
    () => evaluate('!document.querySelector("[aria-label=\\"AI model\\"]").disabled'),
    'effort save complete',
  )
  await fill('[aria-label="AI model"]', 'fixture-codex-other')
  await until(
    async () =>
      (await state()).settings.codexModel === 'fixture-codex-other' &&
      (await state()).settings.reasoningEffort === undefined,
    'model change restores default effort',
  )
  assert.deepEqual(
    await evaluate(
      '[...document.querySelector("[aria-label=\\"Reasoning effort\\"]").options].map(item => item.value)',
    ),
    ['', 'low'],
  )
  await until(
    () => evaluate('!document.querySelector("[aria-label=\\"AI model\\"]").disabled'),
    'model save complete',
  )
  await fill('[aria-label="AI model"]', 'fixture-codex')
  await until(
    () =>
      evaluate('document.querySelector(".codex-usage")?.textContent.includes("5h: 72.5% left")'),
    'Codex primary usage window',
  )
  assert.ok(
    await evaluate('document.querySelector(".codex-usage").textContent.includes("7d: 89% left")'),
  )
  assert.equal(
    await evaluate(
      '[...document.querySelectorAll(".codex-usage-window > span")].every(item => /^resets /.test(item.textContent))',
    ),
    true,
  )
  await fill('[aria-label="Codex usage bucket"]', 'review')
  await until(
    () => evaluate('document.querySelector(".codex-usage")?.textContent.includes("1d: 25% left")'),
    'additional usage bucket',
  )
  assert.equal(await evaluate('document.querySelectorAll(".codex-usage-window").length'), 1)
  await fill('[aria-label="Codex usage bucket"]', 'codex')
  await inspectLayout('codex-chat-controls')
  codexUsageAvailable = false
  const previousUsageReads = codexUsageReads
  await click('Check AI')
  await until(
    () =>
      evaluate(
        'document.querySelector(".codex-usage")?.textContent.includes("Last known Codex limit")',
      ),
    'failed usage refresh marked stale',
  )
  assert.ok(codexUsageReads > previousUsageReads)
  assert.ok(
    await evaluate('document.querySelector(".codex-usage").textContent.includes("5h: 72.5% left")'),
  )
  assert.ok(
    await evaluate(
      'document.querySelector(".codex-usage").textContent.includes("Refresh unavailable · checked")',
    ),
  )
  codexUsageAvailable = true
  await click('Check AI')
  await until(
    () => evaluate('!document.querySelector(".codex-usage").classList.contains("is-stale")'),
    'usage refresh recovers',
  )
  await fill('[aria-label="AI provider"]', 'ollama')
  await until(
    () => evaluate(`document.querySelector('[aria-label="AI model"]').value === 'fixture:local'`),
    'inline provider selection retained model',
  )
  assert.equal(await evaluate('Boolean(document.querySelector(".codex-usage"))'), false)
  await inspectLayout('direct-ai-chat')
  const mainWidthWithSidebar = await evaluate('document.querySelector(".main-panel").clientWidth')
  await evaluate('document.querySelector(".sidebar-toggle").click()')
  assert.equal(await evaluate('Boolean(document.querySelector(".sidebar"))'), false)
  assert.ok(
    await evaluate(`document.querySelector('.main-panel').clientWidth > ${mainWidthWithSidebar}`),
  )
  await evaluate('document.querySelector(".sidebar-toggle").click()')
  const [drawerTestWidth, drawerTestHeight] = window.getContentSize()
  window.setContentSize(600, 600)
  await until(
    () => evaluate('window.innerWidth === 600 && !document.querySelector(".sidebar")'),
    'narrow viewport collapses sidebar',
  )
  await evaluate('document.querySelector(".sidebar-toggle").click()')
  await until(
    () => evaluate('Boolean(document.querySelector(".sidebar-drawer[open]"))'),
    'native sidebar drawer opens',
  )
  assert.equal(await evaluate('document.activeElement.getAttribute("aria-label")'), 'Close sidebar')
  window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab' })
  window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab' })
  assert.ok(
    await evaluate('document.querySelector(".sidebar-drawer").contains(document.activeElement)'),
  )
  await writeFile(
    join(screenshotDirectory, 'sidebar-drawer-600.png'),
    (await window.webContents.capturePage()).toPNG(),
  )
  window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
  window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
  await until(
    () => evaluate('!document.querySelector(".sidebar-drawer")'),
    'Escape closes sidebar drawer',
  )
  assert.equal(await evaluate('document.activeElement.classList.contains("sidebar-toggle")'), true)
  window.setContentSize(drawerTestWidth, drawerTestHeight)
  await settleLayout()
  await click(project.name, '.sidebar-project')
  assert.equal(
    await evaluate('document.querySelector(".chat-conversation-title").textContent'),
    firstTitle,
  )
  assert.equal(
    await evaluate('document.querySelector("#chat-message").value'),
    'Draft retained across projects',
  )
  await inspectLayout('project-chat')
  await evaluate('document.querySelector(".workspace-menu > summary").click()')
  await inspectLayout('workspace-menu')
  await click('Project context')
  await click('Folder', '[role=tab]')
  assert.equal(
    await evaluate('document.querySelector(".project-folder-path").textContent'),
    canonicalFolder,
  )
  await click('Remove folder')
  await click('Save project context')
  await until(
    async () =>
      (await state()).projects.find((item) => item.id === saved.id).folderPath === undefined,
    'folder binding removed',
  )
  for (const [field, value] of Object.entries(project))
    assert.equal((await state()).projects.find((item) => item.id === saved.id)[field], value)
  console.log(
    `Desktop smoke passed: real preload/IPC, native folder grants, fresh folder maps and exclusions, automatic memory, fixture Codex effort/usage controls, forms, catalog, streams, cancellation, cross-chat context, reload, durable storage, monochrome theme, keyboard controls and dynamic 1280x800/980x600/640x480/600x600 layouts without document scroll. Screenshots: ${screenshotDirectory}`,
  )
}

setTimeout(() => {
  console.error('Desktop smoke exceeded 90 seconds.')
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
