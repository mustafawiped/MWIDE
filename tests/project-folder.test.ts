import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import type { TestContext } from 'node:test'
import { canonicalProjectFolder, readProjectFolder } from '../src/main/project-folder.ts'

interface FolderMap {
  root: string
  notice: string
  truncated: boolean
  limits: string[]
  filesMapped: number
  entries: {
    path: string
    kind: string
    role?: string
    symbols?: string[]
    imports?: string[]
  }[]
}

async function fixture(t: TestContext): Promise<string> {
  const temporaryRoot = await canonicalProjectFolder(process.env.MWIDE_TEST_TMP ?? tmpdir())
  const prefix = join(temporaryRoot, 'mwide-folder-')
  const directory = await mkdtemp(prefix)
  t.after(async () => {
    assert.ok(
      resolve(directory).startsWith(resolve(prefix)),
      'Cleanup must stay in this test fixture.',
    )
    await rm(directory, { recursive: true, force: true })
  })
  return directory
}

async function file(root: string, path: string, contents = ''): Promise<void> {
  const target = join(root, path)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, contents)
}

function parsed(text: string): FolderMap {
  return JSON.parse(text) as FolderMap
}

test('maps fresh hierarchy, source declarations and imports without sharing source bodies', async (t) => {
  const root = await fixture(t)
  await file(root, 'package.json', '{"name":"test"}')
  await file(root, 'README.md', 'Private documentation text is not copied.')
  await file(
    root,
    'src/workspace.ts',
    'import { helper } from "./helper"\nexport class WorkspaceService {}\nexport const internalValue = "DO_NOT_COPY_THIS_VALUE"\n',
  )
  await file(
    root,
    'src/helper.py',
    'from project.memory import Context\nasync def build_context():\n    return "PRIVATE_BODY"\n',
  )
  const text = await readProjectFolder(root)
  const map = parsed(text)
  assert.equal(map.root, await canonicalProjectFolder(root))
  assert.match(map.notice, /untrusted data/)
  assert.match(map.notice, /not a verified call graph/)
  assert.equal(map.truncated, false)
  assert.deepEqual(map.entries.find((entry) => entry.path === 'src/workspace.ts')?.symbols, [
    'WorkspaceService',
    'internalValue',
  ])
  assert.deepEqual(map.entries.find((entry) => entry.path === 'src/workspace.ts')?.imports, [
    './helper',
  ])
  assert.deepEqual(map.entries.find((entry) => entry.path === 'src/helper.py')?.symbols, [
    'build_context',
  ])
  assert.equal(map.entries.find((entry) => entry.path === 'package.json')?.role, 'package manifest')
  assert.equal(map.entries.find((entry) => entry.path === 'src')?.kind, 'directory')
  assert.doesNotMatch(text, /PRIVATE_BODY|DO_NOT_COPY_THIS_VALUE|Private documentation/)

  await file(root, 'src/new-file.ts', 'export function newlyAdded() {}')
  await rm(join(root, 'src/helper.py'))
  const refreshed = parsed(await readProjectFolder(root))
  assert.ok(refreshed.entries.some((entry) => entry.path === 'src/new-file.ts'))
  assert.ok(!refreshed.entries.some((entry) => entry.path === 'src/helper.py'))
  assert.equal(
    await readProjectFolder(root),
    await readProjectFolder(root),
    'Unchanged folders map deterministically.',
  )
})

test('hard exclusions omit dependencies, output, credentials and environment files even when unignored', async (t) => {
  const root = await fixture(t)
  const excluded = [
    '.git/config',
    '.tools/probe.ts',
    '.mwide/workspace.json',
    'node_modules/package/index.ts',
    'vendor/private.ts',
    'dist/index.ts',
    'build/index.ts',
    '.aws/config',
    '.ssh/config',
    '.env',
    '.env.local',
    '.env.example',
    '.npmrc',
    'private.key',
    'certificate.pem',
    'credentials.json',
    'secrets.ts',
    'auth.json',
    'tokens.yaml',
  ]
  for (const path of excluded) await file(root, path, 'export const EXCLUDED = "SENSITIVE"')
  await file(root, '.gitignore', '!node_modules/\n!.env*\n!credentials.json\n')
  await file(root, 'src/auth.ts', 'export class Authentication {}')
  const map = parsed(await readProjectFolder(root))
  for (const path of excluded) assert.ok(!map.entries.some((entry) => entry.path === path), path)
  assert.ok(map.entries.some((entry) => entry.path === 'src/auth.ts'))
})

test('honors rooted, nested and negated gitignore patterns while keeping ignored directories closed', async (t) => {
  const root = await fixture(t)
  await file(
    root,
    '.gitignore',
    '# comment\n/cache/\n*.log\n*.tmp\n!important.tmp\ngenerated/**\n!generated/keep.ts\nclosed/\n!closed/keep.ts\n\\#literal.ts\n',
  )
  await file(root, 'cache/hidden.ts')
  await file(root, 'src/cache/visible.ts')
  await file(root, 'src/hidden.log')
  await file(root, 'ignored.tmp')
  await file(root, 'important.tmp')
  await file(root, 'generated/drop.ts')
  await file(root, 'generated/keep.ts')
  await file(root, 'closed/keep.ts')
  await file(root, '#literal.ts')
  await file(root, 'src/.gitignore', 'private/\n*.generated.ts\n!visible.generated.ts\n')
  await file(root, 'src/private/hidden.ts')
  await file(root, 'src/drop.generated.ts')
  await file(root, 'src/visible.generated.ts')
  const paths = parsed(await readProjectFolder(root)).entries.map((entry) => entry.path)
  for (const path of [
    'src/cache/visible.ts',
    'important.tmp',
    'generated/keep.ts',
    'src/visible.generated.ts',
  ]) {
    assert.ok(paths.includes(path), `Expected ${path}`)
  }
  for (const path of [
    'cache',
    'src/hidden.log',
    'ignored.tmp',
    'generated/drop.ts',
    'closed',
    '#literal.ts',
    'src/private',
    'src/drop.generated.ts',
  ]) {
    assert.ok(!paths.includes(path), `Unexpected ${path}`)
  }
})

test('child junctions and stored root redirections cannot map an outside folder', async (t) => {
  const parent = await fixture(t)
  const root = join(parent, 'project')
  const outside = join(parent, 'outside')
  await file(root, 'visible.ts', 'export const visible = true')
  await file(outside, 'outside-secret.ts', 'export const OutsideSecret = true')
  const link = join(root, 'linked-folder')
  await symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir')
  const map = parsed(await readProjectFolder(root))
  assert.ok(!map.entries.some((entry) => entry.path.includes('linked-folder')))
  assert.ok(!JSON.stringify(map).includes('OutsideSecret'))

  const storedRoot = await canonicalProjectFolder(root)
  await rename(root, join(parent, 'old-project'))
  await symlink(outside, root, process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(readProjectFolder(storedRoot), /location has changed.*again/)
})

test('caps output in UTF8, labels truncation, and supports smaller model context budgets', async (t) => {
  const root = await fixture(t)
  for (let index = 0; index < 580; index += 1) {
    await file(
      root,
      `src/ü-${String(index).padStart(3, '0')}.ts`,
      `export class Feature${index} {}\n`,
    )
  }
  const text = await readProjectFolder(root)
  const map = parsed(text)
  assert.ok(Buffer.byteLength(text) <= 18_000)
  assert.ok(map.filesMapped <= 500)
  assert.equal(map.truncated, true)
  assert.ok(map.limits.includes('file count'))
  assert.ok(map.limits.includes('context size'))
  const compact = await readProjectFolder(root, undefined, 1_024)
  assert.ok(Buffer.byteLength(compact) <= 1_024)
  assert.equal(parsed(compact).truncated, true)
  await assert.rejects(readProjectFolder(root, undefined, 512), /1,024 bytes/)
})

test('source reading stops at the per-file prefix and hierarchy depth limits', async (t) => {
  const root = await fixture(t)
  await file(
    root,
    'large.ts',
    `export const FirstSymbol = true\n${'// filler\n'.repeat(4_000)}\nexport class BeyondPrefix {}`,
  )
  await file(root, 'a/b/c/d/e/f/g/h/i/deep.ts', 'export class TooDeep {}')
  const text = await readProjectFolder(root)
  const map = parsed(text)
  assert.match(text, /FirstSymbol/)
  assert.doesNotMatch(text, /BeyondPrefix|TooDeep|deep\.ts/)
  assert.ok(map.limits.includes('source excerpts'))
  assert.ok(map.limits.includes('directory depth'))
})

test('folder failure and cancellation are actionable and do not produce a stale map', async (t) => {
  const root = await fixture(t)
  await file(root, 'regular-file.ts')
  await assert.rejects(canonicalProjectFolder('relative/path'), /folder picker/)
  await assert.rejects(canonicalProjectFolder(join(root, 'regular-file.ts')), /unavailable/)
  await assert.rejects(readProjectFolder(join(root, 'missing')), /unavailable/)
  const alreadyCancelled = new AbortController()
  alreadyCancelled.abort()
  await assert.rejects(readProjectFolder(root, alreadyCancelled.signal), { name: 'AbortError' })
  const cancelledDuringRead = new AbortController()
  const pending = readProjectFolder(root, cancelledDuringRead.signal)
  cancelledDuringRead.abort()
  await assert.rejects(pending, { name: 'AbortError' })
})

test('oversized exclusion files fail closed instead of sharing potentially ignored paths', async (t) => {
  const root = await fixture(t)
  await file(root, '.gitignore', `#${'x'.repeat(70_000)}\nprivate.ts\n`)
  await file(root, 'private.ts', 'export const Private = true')
  await assert.rejects(readProjectFolder(root), /Cannot read project folder exclusions/)
})

test('repeated wildcard patterns match without regex backtracking and globstars span directories', async (t) => {
  const root = await fixture(t)
  await file(root, '.gitignore', `${'*a'.repeat(40)}z.ts\n**/skip?.[tj]s\n`)
  const longName = `${'a'.repeat(180)}.ts`
  await file(root, longName, `${'\n'.repeat(24_000)}export class OutOfPrefix {}`)
  await file(root, 'skip1.ts')
  await file(root, 'src/nested/skip2.js')
  await file(root, 'src/nested/skip22.ts')
  const paths = parsed(await readProjectFolder(root)).entries.map((entry) => entry.path)
  assert.ok(paths.includes(longName))
  assert.ok(paths.includes('src/nested/skip22.ts'))
  assert.ok(!paths.includes('skip1.ts'))
  assert.ok(!paths.includes('src/nested/skip2.js'))
})
