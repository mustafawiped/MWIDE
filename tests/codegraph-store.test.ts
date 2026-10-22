import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  link,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  symlink,
  utimes,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import type { TestContext } from 'node:test'
import { CodeGraphStore } from '../src/main/codegraph-store.ts'
import { canonicalProjectFolder } from '../src/main/project-folder.ts'

async function fixture(
  t: TestContext,
): Promise<{ root: string; cache: string; store: CodeGraphStore }> {
  const temporaryRoot = await canonicalProjectFolder(process.env.MWIDE_TEST_TMP ?? tmpdir())
  const directory = await mkdtemp(join(temporaryRoot, 'mwide-codegraph-'))
  const root = join(directory, 'project')
  const cache = join(directory, 'cache')
  await mkdir(root)
  const store = new CodeGraphStore(cache)
  t.after(async () => {
    store.close()
    assert.ok(resolve(directory).startsWith(resolve(join(temporaryRoot, 'mwide-codegraph-'))))
    await rm(directory, { recursive: true, force: true })
  })
  return { root, cache, store }
}

async function file(root: string, path: string, source: string): Promise<void> {
  await mkdir(dirname(join(root, path)), { recursive: true })
  await writeFile(join(root, path), source)
}

test('persists AST extractions and refreshes unchanged files without source reads or parsing', async (t) => {
  const { root, cache, store } = await fixture(t)
  await file(root, '.gitignore', 'ignored/\n')
  await file(root, 'src/helper.ts', 'export function helper() { return "PRIVATE_VALUE" }')
  await file(
    root,
    'src/main.ts',
    'import { helper } from "./helper"; export function main() { return helper() }',
  )
  await file(root, 'README.md', 'Do not include documentation bodies.')
  const cold = await store.refresh(root)
  assert.equal(cold.parsedFiles, 2)
  assert.equal(cold.reusedFiles, 0)
  assert.equal(cold.skippedFiles, 2)
  assert.equal(cold.added.length, 4)
  assert.ok(cold.symbols >= 4)
  assert.ok(cold.edges >= 2)
  const warm = await store.refresh(root)
  assert.equal(warm.parsedFiles, 0)
  assert.equal(warm.reusedFiles, 2)
  assert.equal(warm.bytesRead, 0)
  assert.deepEqual(warm.added, [])
  assert.deepEqual(warm.modified, [])
  assert.deepEqual(warm.deleted, [])
  const cachedNames = store
    .query(root, { type: 'search', query: 'helper' })
    .symbols.map((symbol) => symbol.name)
  assert.ok(cachedNames.includes('helper'))
  store.close()
  const restarted = new CodeGraphStore(cache)
  try {
    const afterRestart = await restarted.refresh(root)
    assert.equal(afterRestart.parsedFiles, 0)
    assert.equal(afterRestart.reusedFiles, 2)
    assert.equal(afterRestart.bytesRead, 0)
    assert.equal(afterRestart.generation, warm.generation + 1)
    assert.deepEqual(
      restarted
        .query(root, { type: 'search', query: 'helper' })
        .symbols.map((symbol) => symbol.name),
      cachedNames,
    )
    const database = await readFile(
      join(
        cache,
        (await readdir(cache)).find((name) => name.endsWith('.sqlite'))!,
      ),
    )
    assert.ok(
      !database.includes(Buffer.from('PRIVATE_VALUE')),
      'Cache must not retain source bodies.',
    )
  } finally {
    restarted.close()
  }
})

test('hashes metadata changes without reparsing unchanged contents and detects mtime-restored edits', async (t) => {
  const { root, store } = await fixture(t)
  await file(root, 'main.ts', 'export function alpha() {}')
  await store.refresh(root)
  const before = await stat(join(root, 'main.ts'))
  await utimes(join(root, 'main.ts'), before.atime, new Date(before.mtimeMs + 5_000))
  const unchanged = await store.refresh(root)
  assert.equal(unchanged.parsedFiles, 0)
  assert.equal(unchanged.reusedFiles, 1)
  assert.ok(unchanged.bytesRead > 0)
  assert.deepEqual(unchanged.modified, [])
  await file(root, 'main.ts', 'export function bravo() {}')
  await utimes(join(root, 'main.ts'), before.atime, before.mtime)
  const changed = await store.refresh(root)
  assert.equal(changed.parsedFiles, 1)
  assert.deepEqual(changed.modified, ['main.ts'])
  assert.equal(store.query(root, { type: 'search', query: 'alpha' }).symbols.length, 0)
  assert.equal(store.query(root, { type: 'search', query: 'bravo' }).symbols.length, 1)
})

test('deletions and fresh nested exclusions remove stale symbols and caller edges', async (t) => {
  const { root, store } = await fixture(t)
  await file(root, 'src/helper.ts', 'export function helper() {}')
  await file(
    root,
    'src/main.ts',
    'import { helper } from "./helper"; export function main() { helper() }',
  )
  const cold = await store.refresh(root)
  const main = store
    .query(root, { type: 'search', query: 'main' })
    .symbols.find((symbol) => symbol.name === 'main')!
  assert.ok(
    store
      .query(root, { type: 'trace', symbolId: main.id, direction: 'outbound' })
      .symbols.some((symbol) => symbol.name === 'helper'),
  )
  await rm(join(root, 'src/helper.ts'))
  const deleted = await store.refresh(root)
  assert.deepEqual(deleted.deleted, ['src/helper.ts'])
  assert.ok(deleted.edges < cold.edges)
  assert.ok(
    !store
      .query(root, { type: 'trace', symbolId: main.id, direction: 'outbound' })
      .symbols.some((symbol) => symbol.name === 'helper'),
  )
  await file(root, 'src/helper.ts', 'export function helper() {}')
  await file(root, 'src/.gitignore', 'helper.ts\n')
  await store.refresh(root)
  assert.equal(store.query(root, { type: 'search', query: 'helper' }).symbols.length, 0)
  await file(root, 'src/.gitignore', 'main.ts\n')
  const policyChanged = await store.refresh(root)
  assert.ok(policyChanged.added.includes('src/helper.ts'))
  assert.ok(policyChanged.deleted.includes('src/main.ts'))
  assert.equal(
    store
      .query(root, { type: 'search', query: 'helper' })
      .symbols.filter((symbol) => symbol.name === 'helper').length,
    1,
  )
})

test('hard exclusions and secret filenames cannot be re-included by gitignore negation', async (t) => {
  const { root, store } = await fixture(t)
  for (const name of [
    'node_modules/vendor.ts',
    '.git/private.ts',
    '.env.ts',
    'credentials.ts',
    'secret.json',
    'auth.json',
    '.aws/config.ts',
  ]) {
    await file(root, name, 'export function forbiddenSecret() {}')
  }
  await file(root, '.gitignore', '!node_modules/\n!.env.ts\n!credentials.ts\n')
  await file(root, 'src/main.ts', 'export function allowed() {}')
  const status = await store.refresh(root)
  assert.equal(status.parsedFiles, 1)
  assert.equal(store.query(root, { type: 'search', query: 'forbiddenSecret' }).symbols.length, 0)
  assert.equal(store.query(root, { type: 'search', query: 'allowed' }).symbols.length, 1)
})

test('search paginates stable results and treats wildcard and SQL text as literal input', async (t) => {
  const { root, store } = await fixture(t)
  await file(
    root,
    'main.ts',
    Array.from({ length: 110 }, (_, index) => `export function item${index}() {}`).join('\n'),
  )
  await store.refresh(root)
  const first = store.query(root, { type: 'search', query: 'item', limit: 20 })
  const next = store.query(root, { type: 'search', query: 'item', limit: 20, offset: 20 })
  assert.equal(first.total, 110)
  assert.equal(first.symbols.length, 20)
  assert.equal(first.truncated, true)
  assert.equal(next.symbols.length, 20)
  assert.ok(!first.symbols.some((symbol) => next.symbols.some((other) => other.id === symbol.id)))
  assert.equal(store.query(root, { type: 'search', query: '%' }).total, 0)
  assert.equal(store.query(root, { type: 'search', query: "'; DROP TABLE symbols; --" }).total, 0)
  assert.equal(store.query(root, { type: 'search', query: 'item' }).total, 110)
})

test('traces cyclic calls in both directions with bounded depth and node count', async (t) => {
  const { root, store } = await fixture(t)
  await file(
    root,
    'main.ts',
    'export function alpha() { beta() }; export function beta() { gamma() }; export function gamma() { alpha() }',
  )
  await store.refresh(root)
  const alpha = store
    .query(root, { type: 'search', query: 'alpha' })
    .symbols.find((symbol) => symbol.name === 'alpha')!
  const one = store.query(root, {
    type: 'trace',
    symbolId: alpha.id,
    direction: 'outbound',
    depth: 1,
  })
  assert.deepEqual(one.symbols.map((symbol) => symbol.name).sort(), ['alpha', 'beta'])
  const inbound = store.query(root, {
    type: 'trace',
    symbolId: alpha.id,
    direction: 'inbound',
    depth: 1,
  })
  assert.deepEqual(inbound.symbols.map((symbol) => symbol.name).sort(), ['alpha', 'gamma'])
  const cycle = store.query(root, {
    type: 'trace',
    symbolId: alpha.id,
    direction: 'both',
    depth: 10,
  })
  assert.equal(cycle.symbols.length, 3)
  assert.equal(cycle.edges.length, 3)
  const capped = store.query(root, {
    type: 'trace',
    symbolId: alpha.id,
    direction: 'both',
    depth: 50,
    limit: 2,
  })
  assert.equal(capped.symbols.length, 2)
  assert.equal(capped.truncated, true)
  assert.deepEqual(
    store.query(root, { type: 'trace', symbolId: 'missing', direction: 'both' }).symbols,
    [],
  )
})

test('call traces ignore import dependencies and repeated edges do not hide neighbours', async (t) => {
  const { root, store } = await fixture(t)
  await file(root, 'dependency.ts', 'export function importedOnly() {}')
  await file(
    root,
    'main.ts',
    `import { importedOnly } from './dependency';\nexport function child() {}\nexport function finalChild() {}\nexport function main() {\n${'child();\n'.repeat(2_100)}finalChild();\n}`,
  )
  await store.refresh(root)
  const main = store
    .query(root, { type: 'search', query: 'main' })
    .symbols.find((symbol) => symbol.name === 'main')!
  const traced = store.query(root, {
    type: 'trace',
    symbolId: main.id,
    direction: 'outbound',
    depth: 1,
  })
  assert.deepEqual(traced.symbols.map((symbol) => symbol.name).sort(), [
    'child',
    'finalChild',
    'main',
  ])
  assert.ok(traced.edges.every((edge) => edge.type === 'CALLS'))
  assert.equal(traced.edges.length, 2_000)
  assert.equal(
    traced.truncated,
    true,
    'Clipped edges must be reported, even with only three nodes.',
  )
  const module = store
    .query(root, { type: 'search', query: 'main.ts' })
    .symbols.find((symbol) => symbol.kind === 'module')!
  assert.ok(
    !store
      .query(root, { type: 'trace', symbolId: module.id, direction: 'outbound' })
      .symbols.some((symbol) => symbol.name === 'importedOnly'),
  )
})

test('large change name lists stay bounded while counters and fanout limits remain honest', async (t) => {
  const { root, store } = await fixture(t)
  await Promise.all(
    Array.from({ length: 105 }, (_, index) =>
      file(root, `file${index}.ts`, `export function leaf${index}() {}`),
    ),
  )
  await file(
    root,
    'hub.ts',
    `${Array.from({ length: 550 }, (_, index) => `function leaf${index}() {}`).join('\n')}\nexport function hub() { ${Array.from({ length: 550 }, (_, index) => `leaf${index}();`).join('\n')} }`,
  )
  const status = await store.refresh(root)
  assert.equal(status.added.length, 100)
  assert.equal(status.changes.added, 106)
  assert.equal(status.changeListTruncated, true)
  assert.equal(
    status.truncated,
    false,
    'Change name clipping does not mean the code graph is incomplete.',
  )
  const hub = store
    .query(root, { type: 'search', query: 'hub' })
    .symbols.find((symbol) => symbol.name === 'hub')!
  const traced = store.query(root, {
    type: 'trace',
    symbolId: hub.id,
    direction: 'outbound',
    limit: 50_000,
  })
  assert.equal(traced.symbols.length, 500)
  assert.equal(traced.truncated, true)
})

test('parse errors are reported as partial coverage and unsupported file locations remain visible', async (t) => {
  const { root, store } = await fixture(t)
  await file(root, 'broken.ts', 'export function incomplete( {')
  await file(root, 'src/worker.py', 'def unsupported():\n pass')
  const status = await store.refresh(root)
  assert.equal(status.partialFiles, 1)
  assert.equal(status.skippedFiles, 1)
  const context = JSON.parse(store.context(root, 18_000))
  assert.ok(
    context.files.some(
      (file: { path: string; coverage: string }) =>
        file.path === 'src/worker.py' && file.coverage === 'unsupported language',
    ),
  )
})

test('context is byte bounded, query relevant and explicitly reports incomplete coverage', async (t) => {
  const { root, store } = await fixture(t)
  await file(
    root,
    'a-overview.ts',
    Array.from({ length: 70 }, (_, index) => `export function unimportant${index}() {}`).join('\n'),
  )
  await file(
    root,
    'z-payments.ts',
    'export function settlePayment() { validatePayment() }; export function validatePayment() { return "DO_NOT_COPY_SOURCE" }',
  )
  await file(root, 'worker.py', 'def unsupported_python():\n pass')
  await store.refresh(root)
  for (const budget of [1_024, 2_048, 4_000, 18_000]) {
    const context = store.context(root, budget, 'Please review the `settlePayment()` function.')
    assert.ok(Buffer.byteLength(context) <= budget)
    const body = JSON.parse(context)
    assert.equal(body.root, root)
    assert.match(body.notice, /untrusted data/)
    assert.equal(body.coverage.skippedFiles, 1)
    assert.doesNotMatch(context, /DO_NOT_COPY_SOURCE|unsupported_python/)
    if (budget >= 2_048) assert.match(context, /settlePayment/)
  }
  const result = JSON.parse(store.context(root, 4_000, 'settlePayment'))
  assert.equal(result.entries[0].file, 'z-payments.ts')
  assert.ok(
    result.entries[0].declarations.some(
      (symbol: { name: string }) => symbol.name === 'validatePayment',
    ),
  )
  assert.equal(result.truncated, true)
})

test('cancelled refresh preserves the last complete graph generation', async (t) => {
  const { root, store } = await fixture(t)
  await file(root, 'main.ts', 'export function original() {}')
  const status = await store.refresh(root)
  await file(root, 'main.ts', 'export function changed() {}')
  const controller = new AbortController()
  const pending = store.refresh(root, controller.signal)
  setImmediate(() => controller.abort())
  await assert.rejects(pending, { name: 'AbortError' })
  const result = store.query(root, { type: 'search', query: 'original' })
  assert.equal(result.symbols.length, 1)
  assert.equal(result.status.generation, status.generation)
  assert.equal(store.query(root, { type: 'search', query: 'changed' }).symbols.length, 0)
  const next = await store.refresh(root)
  assert.equal(next.generation, status.generation + 1)
})

test('corrupt database is preserved with an actionable rebuild error', async (t) => {
  const { root, cache, store } = await fixture(t)
  await mkdir(cache)
  const key = process.platform === 'win32' ? resolve(root).toLowerCase() : resolve(root)
  const path = join(cache, `${createHash('sha256').update(key).digest('hex')}.sqlite`)
  const original = Buffer.from('This is not a SQLite database. Preserve it.')
  await writeFile(path, original)
  await assert.rejects(store.refresh(root), /existing cache was preserved.*move/i)
  assert.deepEqual(await readFile(path), original)
})

test('separate project roots never share declarations or database generations', async (t) => {
  const { root, store } = await fixture(t)
  const other = join(dirname(root), 'other')
  await mkdir(other)
  await file(root, 'same.ts', 'export function alpha() {}')
  await file(other, 'same.ts', 'export function bravo() {}')
  await store.refresh(root)
  await store.refresh(other)
  assert.equal(store.query(root, { type: 'search', query: 'bravo' }).symbols.length, 0)
  assert.equal(store.query(other, { type: 'search', query: 'alpha' }).symbols.length, 0)
})

test('idle project connections are bounded and evicted graphs reopen from persisted extractions', async (t) => {
  const { root, store } = await fixture(t)
  await file(root, 'main.ts', 'export function firstProject() {}')
  await store.refresh(root)
  for (let index = 0; index < 8; index += 1) {
    const other = join(dirname(root), `project${index}`)
    await mkdir(other)
    await file(other, 'main.ts', `export function project${index}() {}`)
    await store.refresh(other)
  }
  assert.throws(
    () => store.query(root, { type: 'search', query: 'firstProject' }),
    /Refresh this project/,
  )
  const status = await store.refresh(root)
  assert.equal(status.parsedFiles, 0)
  assert.equal(status.reusedFiles, 1)
  assert.equal(status.bytesRead, 0)
  assert.equal(store.query(root, { type: 'search', query: 'firstProject' }).symbols.length, 1)
})

test('source size caps skip complete files and report truncation rather than parse a prefix', async (t) => {
  const { root, store } = await fixture(t)
  await file(
    root,
    'large.ts',
    `export function shouldNotIndexPrefix() {}\n${' '.repeat(256 * 1_024)}`,
  )
  const status = await store.refresh(root)
  assert.equal(status.truncated, true)
  assert.equal(status.bytesRead, 0)
  assert.equal(status.parsedFiles, 0)
  assert.equal(status.skippedFiles, 1)
  assert.equal(
    store.query(root, { type: 'search', query: 'shouldNotIndexPrefix' }).symbols.length,
    0,
  )
})

test('skips symlinks and hardlinks and refuses redirected selected roots', async (t) => {
  const { root, store } = await fixture(t)
  const outside = join(dirname(root), 'outside')
  await mkdir(outside)
  await file(outside, 'private.ts', 'export function outsideSecret() {}')
  await file(root, 'main.ts', 'export function safe() {}')
  await link(join(outside, 'private.ts'), join(root, 'hardlink.ts'))
  await symlink(outside, join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir')
  await store.refresh(root)
  assert.equal(store.query(root, { type: 'search', query: 'outsideSecret' }).symbols.length, 0)
  const moved = `${root}-moved`
  await rename(root, moved)
  await symlink(outside, root, process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(store.refresh(root), /location has changed/)
  assert.equal(store.query(root, { type: 'search', query: 'safe' }).symbols.length, 1)
})
