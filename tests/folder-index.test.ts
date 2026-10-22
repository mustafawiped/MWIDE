import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import type { TestContext } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { FolderIndex } from '../src/main/folder-index.ts'
import { canonicalProjectFolder } from '../src/main/project-folder.ts'

const scannerUrl = new URL('../src/main/project-folder-worker.ts', import.meta.url)

async function fixture(t: TestContext, extraStartup = '') {
  const base = await canonicalProjectFolder(process.env.MWIDE_TEST_TMP ?? tmpdir())
  const prefix = join(base, 'mwide-folder-worker-')
  const directory = await mkdtemp(prefix)
  const root = join(directory, 'project')
  const starts = join(directory, 'starts.txt')
  await mkdir(root)
  const workerPath = join(directory, 'worker.mjs')
  // Instrument startup without replacing the production worker or scanner.
  await writeFile(
    workerPath,
    `import { appendFileSync } from 'node:fs';\nappendFileSync(${JSON.stringify(starts)}, 'start\\n');\n${extraStartup}\nawait import(${JSON.stringify(scannerUrl.href)});\n`,
  )
  const index = new FolderIndex(workerPath)
  t.after(async () => {
    index.dispose()
    assert.ok(resolve(directory).startsWith(resolve(prefix)))
    await rm(directory, { recursive: true, force: true })
  })
  return {
    directory,
    root,
    index,
    async startCount() {
      return (await readFile(starts, 'utf8')).trim().split('\n').length
    },
  }
}

test('background maps reuse one worker and refresh added, removed and excluded files', async (t) => {
  const { index, root, startCount } = await fixture(t)
  await writeFile(join(root, 'before.ts'), 'export class Before {}')
  await writeFile(join(root, '.env'), 'SECRET=do-not-share')
  await writeFile(join(root, '.gitignore'), 'ignored.ts\n')
  await writeFile(join(root, 'ignored.ts'), 'export class Ignored {}')
  const first = await index.read(root)
  assert.match(first, /Before/)
  assert.doesNotMatch(first, /SECRET|ignored\.ts|\.env/)
  assert.match(first, /not a verified call graph/)
  await rm(join(root, 'before.ts'))
  await writeFile(join(root, 'after.ts'), 'export class After {}')
  const second = await index.read(root, undefined, 2_048)
  assert.match(second, /after\.ts/)
  assert.doesNotMatch(second, /before\.ts|Before/)
  assert.ok(Buffer.byteLength(second) <= 2_048)
  assert.ok(Buffer.byteLength(await index.read(root, undefined, 1_024)) <= 1_024)
  assert.equal(await startCount(), 1)
})

test('aborting active CPU work keeps the main event loop responsive and replaces the worker', async (t) => {
  const { index, root, startCount } = await fixture(t)
  await index.read(root)
  // Matching many bounded patterns is deliberately expensive, even with safe glob matching.
  await writeFile(
    join(root, '.gitignore'),
    Array.from({ length: 300 }, (_, value) => `${'*a'.repeat(80)}z${value}.ts`).join('\n'),
  )
  await Promise.all(
    Array.from({ length: 80 }, (_, value) =>
      writeFile(join(root, `${'a'.repeat(100)}-${value}.ts`), 'export class Example {}'),
    ),
  )
  const controller = new AbortController()
  let ticks = 0
  const heartbeat = setInterval(() => {
    ticks += 1
  }, 5)
  const started = performance.now()
  try {
    const pending = index.read(root, controller.signal)
    const rejected = assert.rejects(pending, { name: 'AbortError' })
    // Attach a handler immediately if the scan unexpectedly completes before cancellation.
    void rejected.catch(() => undefined)
    await delay(80)
    controller.abort()
    await rejected
  } finally {
    clearInterval(heartbeat)
  }
  assert.ok(ticks >= 3, `Only ${ticks} event loop heartbeats ran during background scanning.`)
  assert.ok(performance.now() - started < 1_000, 'Cancellation must not wait for scanner CPU work.')

  await rm(join(root, '.gitignore'))
  await writeFile(join(root, 'replacement.ts'), 'export class Replacement {}')
  const replacement = await index.read(root)
  assert.match(replacement, /Replacement/)
  assert.equal(await startCount(), 2, 'The aborted worker must not be reused.')
})

test('folder failures do not return a previous map and stored root redirections still fail closed', async (t) => {
  const { index, root, directory, startCount } = await fixture(t)
  await writeFile(join(root, 'visible.ts'), 'export class Visible {}')
  await index.read(root)
  await assert.rejects(index.read(join(root, 'missing')), /unavailable/)
  assert.match(await index.read(root), /Visible/)
  assert.equal(await startCount(), 1, 'A recoverable folder error should preserve the idle worker.')
  const outside = join(directory, 'outside')
  await mkdir(outside)
  await writeFile(join(outside, 'outside.ts'), 'export class Outside {}')
  await rename(root, join(directory, 'original-project'))
  await symlink(outside, root, process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(index.read(root), /location has changed/)
})

test('bounds requests, rejects overlapping reads and closes active work on dispose', async (t) => {
  const { index, root } = await fixture(t)
  await assert.rejects(index.read('x'.repeat(32_769)), /valid project folder/)
  await assert.rejects(index.read(root, undefined, Infinity), /1,024 bytes/)
  await assert.rejects(index.read(root, undefined, 512), /1,024 bytes/)
  const cancelled = new AbortController()
  cancelled.abort()
  await assert.rejects(index.read(root, cancelled.signal), { name: 'AbortError' })
  const pending = index.read(root)
  await assert.rejects(index.read(root), /already running/)
  const rejected = assert.rejects(pending, /index is closed/)
  index.dispose()
  await rejected
  await assert.rejects(index.read(root), /index is closed/)
  index.dispose()
})

test('a worker startup failure is recoverable on the next read', async (t) => {
  const marker = `new URL('./crashed-once', import.meta.url)`
  const { index, root, startCount } = await fixture(
    t,
    `import { existsSync, writeFileSync } from 'node:fs';\nif (!existsSync(${marker})) { writeFileSync(${marker}, 'yes'); throw new Error('Simulated scanner failure'); }`,
  )
  await assert.rejects(index.read(root), /Simulated scanner failure/)
  const map = JSON.parse(await index.read(root)) as { root: string }
  assert.equal(map.root, root)
  assert.equal(await startCount(), 2)
})

test('oversized worker responses are rejected without keeping a broken worker alive', async (t) => {
  const { index, root } = await fixture(
    t,
    `import { parentPort } from 'node:worker_threads';\nparentPort.on('message', request => parentPort.postMessage({type: 'result', id: request.id, value: 'x'.repeat(18001)}));`,
  )
  await assert.rejects(index.read(root), /invalid response/)
})
