const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { mkdir, mkdtemp, readFile, realpath, writeFile } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { dirname, isAbsolute, join, relative, resolve } = require('node:path')
const { app } = require('electron')

app.commandLine.appendSwitch('force-prefers-reduced-motion')
app.disableHardwareAcceleration()

const hash = (contents) => createHash('sha256').update(contents).digest('hex')

async function run() {
  const base = await realpath(process.env.MWIDE_TEST_TMP || tmpdir())
  const directory = await mkdtemp(join(base, 'mwide-tool-library-desktop-'))
  app.setPath('userData', directory)
  const libraryDirectory = join(directory, 'tool-library')
  const pack = JSON.parse(
    await readFile(join(__dirname, '..', 'resources', 'tool-library-pack.json'), 'utf8'),
  )
  assert.equal(pack.entries.length, 100)
  assert.equal(pack.entries.filter((definition) => definition.entry.kind === 'skill').length, 70)
  assert.equal(pack.entries.filter((definition) => definition.entry.kind === 'mcp').length, 30)

  const installedEntries = []
  let resourceCount = 0
  let longestSkill
  for (const definition of pack.entries) {
    const entry = definition.entry
    installedEntries.push({
      ...entry,
      state: entry.kind === 'skill' ? 'installed' : 'needs-setup',
      detail:
        entry.kind === 'skill'
          ? 'Desktop fixture: complete reviewed files are installed.'
          : 'Desktop fixture: capability inspection has not run; no runtime is registered.',
    })
    if (entry.kind !== 'skill') continue
    const skillDirectory = join(
      libraryDirectory,
      'skills',
      entry.id,
      entry.source.revision.slice(0, 40),
    )
    for (const resource of definition.files) {
      assert.ok(!isAbsolute(resource.path) && !resource.path.includes('\\'))
      const target = resolve(skillDirectory, resource.path)
      const child = relative(skillDirectory, target)
      assert.ok(child && !child.startsWith('..') && !isAbsolute(child))
      const bytes = Buffer.from(resource.data, 'base64')
      assert.equal(hash(bytes), resource.sha256)
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, bytes)
      resourceCount += 1
      if (resource.path === 'SKILL.md') {
        const text = bytes.toString('utf8')
        if (!longestSkill || text.length > longestSkill.text.length)
          longestSkill = { id: entry.id, text }
      }
    }
  }
  assert.ok(longestSkill.text.length > 16_000, 'Exercise the real complete-Skill import limit.')
  await writeFile(
    join(libraryDirectory, 'installation.json'),
    JSON.stringify({
      version: 1,
      revision: pack.revision,
      installedAt: new Date().toISOString(),
      entries: installedEntries,
      runtimes: {},
    }),
  )
  const personalCatalog = {
    id: 'personal-catalog',
    kind: 'skill',
    name: 'Personal untouched instructions',
    description: 'A pre-existing custom entry that must survive library import.',
    instructions: 'PERSONAL-INSTRUCTIONS: preserve exactly. 🧭',
  }
  const personalProject = {
    id: 'personal-project',
    name: 'Personal untouched project',
    description: '  Complete purpose retained.\nSecond line.  ',
    rules: 'Never replace these project rules.',
    architecture: 'Canonical architecture stays separate.',
    catalogIds: [personalCatalog.id],
    createdAt: '2026-10-23T00:00:00.000Z',
  }
  const personalConversation = {
    id: 'personal-conversation',
    projectId: personalProject.id,
    title: 'Personal conversation',
    createdAt: '2026-10-23T00:00:00.000Z',
    summary: '',
    summaryThrough: 0,
    messages: [
      {
        id: 'personal-message',
        role: 'user',
        content: 'Saved message remains intact.',
        createdAt: '2026-10-23T00:00:00.000Z',
        status: 'complete',
      },
    ],
  }
  const saved = {
    settings: {
      defaultProvider: 'ollama',
      codexModel: '',
      ollamaModel: '',
      ollamaUrl: 'http://127.0.0.1:11434',
    },
    catalog: [personalCatalog],
    projects: [personalProject],
    conversations: [personalConversation],
  }
  await writeFile(join(directory, 'workspace.json'), JSON.stringify({ version: 1, state: saved }))
  console.log('Tool library desktop: isolated profile seeded.')

  const created = new Promise((accept) =>
    app.once('browser-window-created', (_event, window) => {
      window.webContents.once('did-finish-load', () => accept(window))
    }),
  )
  // Load the actual application main process, which creates its real isolated preload bridge.
  require('../out/main/index.cjs')
  const window = await created
  console.log('Tool library desktop: production window loaded.')
  window.webContents.setBackgroundThrottling(false)
  const evaluate = async (source) => {
    const result = await window.webContents.executeJavaScript(`(async () => {
      try { return (${source}); }
      catch (error) { return { __testFailure: error.message }; }
    })()`)
    if (result?.__testFailure) throw new Error(result.__testFailure)
    return result
  }
  const until = async (predicate, label) => {
    const deadline = Date.now() + 10_000
    while (Date.now() < deadline) {
      if (await predicate()) return
      await new Promise((accept) => setTimeout(accept, 25))
    }
    throw new Error(`Timed out: ${label}`)
  }
  const state = () => evaluate('window.mwide.workspace.getState()')
  await until(
    () => evaluate('Boolean(window.mwide?.workspace && document.querySelector(".sidebar"))'),
    'real bridge and renderer',
  )
  assert.equal(await evaluate('typeof window.require'), 'undefined')
  const library = await evaluate('window.mwide.workspace.getToolLibrary()')
  assert.equal(library.entries.length, 100)
  assert.equal(library.entries.filter((entry) => entry.kind === 'skill').length, 70)
  assert.equal(library.entries.filter((entry) => entry.kind === 'mcp').length, 30)
  assert.ok(
    library.entries.every(
      (entry) => entry.toolCount === undefined && entry.verifiedAt === undefined,
    ),
  )
  let current = await state()
  assert.equal(current.catalog.length, 101, 'Startup imports every installed definition once.')
  assert.deepEqual(current.projects, saved.projects)
  assert.deepEqual(current.conversations, saved.conversations)
  assert.deepEqual(current.settings, saved.settings)
  assert.deepEqual(
    current.catalog.find((entry) => entry.id === personalCatalog.id),
    personalCatalog,
  )
  assert.deepEqual(
    current.projects[0].catalogIds,
    [personalCatalog.id],
    'Library import does not activate project tools.',
  )
  const completeSkill = current.catalog.find((entry) => entry.libraryId === longestSkill.id)
  assert.ok(
    completeSkill.instructions.endsWith(longestSkill.text),
    'The full reviewed Skill body must cross real IPC and persist.',
  )
  const originalLibraryItem = structuredClone(completeSkill)
  await assert.rejects(
    evaluate(
      `window.mwide.workspace.saveCatalogItem(${JSON.stringify({ ...completeSkill, instructions: 'unreviewed replacement' })})`,
    ),
    /reviewed source|custom entry/i,
  )
  await assert.rejects(
    evaluate(
      `window.mwide.workspace.saveCatalogItem(${JSON.stringify({ ...completeSkill, libraryId: undefined, instructions: 'unreviewed replacement' })})`,
    ),
    /reviewed source|custom entry/i,
  )
  current = await evaluate('window.mwide.workspace.importToolLibrary()')
  assert.equal(current.catalog.length, 101)
  assert.deepEqual(
    current.catalog.find((entry) => entry.id === completeSkill.id),
    originalLibraryItem,
  )
  assert.deepEqual(current.projects, saved.projects)
  assert.deepEqual(
    current.catalog.find((entry) => entry.id === personalCatalog.id),
    personalCatalog,
  )
  const persisted = JSON.parse(await readFile(join(directory, 'workspace.json'), 'utf8'))
  assert.equal(persisted.state.catalog.length, 101)
  assert.ok(
    persisted.state.catalog
      .find((entry) => entry.libraryId === longestSkill.id)
      .instructions.endsWith(longestSkill.text),
  )
  const installation = JSON.parse(
    await readFile(join(libraryDirectory, 'installation.json'), 'utf8'),
  )
  assert.ok(installation.catalogImportedAt)

  const click = async (label, selector = 'button') => {
    await until(
      () =>
        evaluate(
          `Boolean([...document.querySelectorAll(${JSON.stringify(selector)})].find(element => !element.disabled && element.textContent.trim().replace(/\\s+/g,' ') === ${JSON.stringify(label)}))`,
        ),
      label,
    )
    await evaluate(`(() => {
      const target = [...document.querySelectorAll(${JSON.stringify(selector)})].find(element => !element.disabled && element.textContent.trim().replace(/\\s+/g,' ') === ${JSON.stringify(label)});
      const disclosure = target.closest('details');
      if (disclosure && !disclosure.open) disclosure.querySelector('summary').click();
      target.click();
    })()`)
  }
  await click('CatalogMCPs & Skills', '.nav-item')
  await click('Installed library', '[role=tab]')
  await until(
    () => evaluate('document.querySelector(".library-summary")?.textContent.includes("100 tools")'),
    'all tools in actual library UI',
  )
  const screenshotDirectory = join(__dirname, '..', '.mwide', 'test-results')
  await mkdir(screenshotDirectory, { recursive: true })
  const layout = async (name, width, height) => {
    window.setContentSize(width, height)
    await until(
      () => evaluate(`window.innerWidth === ${width} && window.innerHeight === ${height}`),
      name + ' viewport',
    )
    await new Promise((accept) => setTimeout(accept, 120))
    const geometry = await evaluate(`(() => {
      const elements = [...document.querySelectorAll('.tool-library-panel button, .tool-library-panel input, .tool-library-panel select')];
      return { width: innerWidth, height: innerHeight,
        scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight,
        bodyWidth: document.body.scrollWidth, bodyHeight: document.body.scrollHeight,
        controls: elements.filter(element => element.getClientRects().length).map(element => {const rect=element.getBoundingClientRect();return {label:element.getAttribute('aria-label') || element.textContent.trim() || element.placeholder,left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom};}) };
    })()`)
    assert.ok(
      geometry.scrollWidth <= geometry.width + 1 && geometry.bodyWidth <= geometry.width + 1,
      `${name}: document horizontal overflow`,
    )
    assert.ok(
      geometry.scrollHeight <= geometry.height + 1 && geometry.bodyHeight <= geometry.height + 1,
      `${name}: document vertical overflow`,
    )
    assert.ok(geometry.controls.length >= 3, `${name}: expected actionable library controls`)
    for (const control of geometry.controls)
      assert.ok(
        control.left >= -1 &&
          control.right <= width + 1 &&
          control.top >= -1 &&
          control.bottom <= height + 1,
        `${name}: clipped ${control.label} ${JSON.stringify(control)}`,
      )
    await writeFile(
      join(screenshotDirectory, name + '.png'),
      (await window.webContents.capturePage()).toPNG(),
    )
  }
  await layout('tool-library-production-1280', 1280, 800)
  await layout('tool-library-production-640', 640, 480)
  await evaluate('document.querySelector("[data-library-entry]").click()')
  await until(
    () => evaluate('Boolean(document.querySelector(".library-detail"))'),
    'real library detail',
  )
  await layout('tool-library-production-detail-640', 640, 480)
  assert.equal((await state()).catalog.length, 101)
  console.log(
    JSON.stringify({
      passed: true,
      application: 'production main/preload/renderer',
      entries: 100,
      skills: 70,
      mcps: 30,
      resources: resourceCount,
      longestSkillCharacters: longestSkill.text.length,
      existingProjectPreserved: true,
      projectToolsAutomaticallySelected: false,
      completeInstructionsPreserved: true,
      managedInstructionsReadOnly: true,
      accountOrNetworkRequired: false,
      userData: directory,
      screenshots: screenshotDirectory,
    }),
  )
}

setTimeout(() => {
  console.error('Tool library production desktop test exceeded 90 seconds.')
  app.exit(1)
}, 90_000).unref()
run()
  .then(() => app.exit(0))
  .catch((error) => {
    console.error(error)
    app.exit(1)
  })
