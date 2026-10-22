import assert from 'node:assert/strict'
import {
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import type { TestContext } from 'node:test'
import { libraryHash, ToolLibrary, validateLibraryPack } from '../src/main/tool-library.ts'
import type { LibraryFile, LibraryPack } from '../src/main/tool-library.ts'
import type { ToolLibraryEntry } from '../src/shared/tool-library.ts'

const revision = 'a'.repeat(40)
const entry = (id = 'fixture-skill'): ToolLibraryEntry => ({
  id,
  kind: 'skill',
  name: 'Fixture skill',
  description: 'A complete test-only instruction package.',
  category: 'testing',
  tags: ['testing'],
  coding: true,
  version: revision,
  source: {
    url: 'https://github.com/example/fixture/blob/' + revision + '/SKILL.md',
    repository: 'example/fixture',
    revision,
    license: 'MIT',
  },
  state: 'installed',
  detail: 'Installed from the reviewed test fixture.',
  requirements: [],
  access: ['instructions'],
})
const file = (path: string, contents: string | Uint8Array): LibraryFile => ({
  path,
  data: Buffer.from(contents).toString('base64'),
  sha256: libraryHash(contents),
})
const skillText =
  '---\nname: fixture-skill\ndescription: Test-only skill.\n---\n' +
  'Preserve complete instructions and supporting resources.\n'.repeat(500) +
  '\nEND-OF-COMPLETE-SKILL\n'
const pack = (): LibraryPack => ({
  version: 1,
  revision: 'fixture-pack-1',
  entries: [
    {
      entry: entry(),
      files: [
        file('SKILL.md', skillText),
        file('LICENSE.upstream', 'MIT License\nCopyright test fixture\n'),
        file('references/binary.dat', new Uint8Array([0, 1, 2, 255])),
      ],
    },
  ],
})

async function fixture(t: TestContext) {
  const base = await realpath(process.env.MWIDE_TEST_TMP ?? tmpdir())
  const directory = await mkdtemp(join(base, 'mwide-tool-library-'))
  const libraryDirectory = join(directory, 'library')
  t.after(async () => {
    assert.ok(resolve(directory).startsWith(join(base, 'mwide-tool-library-')))
    await rm(directory, { recursive: true, force: true })
  })
  return { directory, libraryDirectory }
}

test('reviewed packs reject modified content, duplicate IDs/resources and missing provenance', () => {
  assert.doesNotThrow(() => validateLibraryPack(pack()))
  const tampered = pack()
  tampered.entries[0].files![0].data = Buffer.from('different instructions').toString('base64')
  assert.throws(() => validateLibraryPack(tampered), /integrity/i)
  const duplicateId = pack()
  duplicateId.entries.push(structuredClone(duplicateId.entries[0]))
  assert.throws(() => validateLibraryPack(duplicateId), /duplicate/i)
  const duplicatePath = pack()
  duplicatePath.entries[0].files!.push(file('SKILL.md', skillText))
  assert.throws(() => validateLibraryPack(duplicatePath), /duplicate/i)
  const noLicense = pack()
  noLicense.entries[0].files = noLicense.entries[0].files!.filter(
    (resource) => !/license/i.test(resource.path),
  )
  assert.throws(() => validateLibraryPack(noLicense), /license/i)
  const noRevision = pack()
  noRevision.entries[0].entry.source.revision = ''
  assert.throws(() => validateLibraryPack(noRevision), /provenance/i)
  const noVersion = pack()
  noVersion.entries[0].entry.version = ''
  assert.throws(() => validateLibraryPack(noVersion), /provenance/i)
})

test('resource paths and revision directories cannot escape their installed library', () => {
  for (const path of [
    '../escape.txt',
    '/escape.txt',
    'C:/escape.txt',
    'nested\\escape.txt',
    'a/./b',
    'a//b',
    'a/../b',
  ]) {
    const unsafe = pack()
    unsafe.entries[0].files!.push(file(path, 'should never be written'))
    assert.throws(() => validateLibraryPack(unsafe), /path|escape/i, path)
  }
  for (const unsafeRevision of ['../../outside', '/outside', 'C:\\outside', 'a/../outside']) {
    const unsafe = pack()
    unsafe.entries[0].entry.source.revision = unsafeRevision
    assert.throws(() => validateLibraryPack(unsafe), /revision|provenance|path/i, unsafeRevision)
  }
})

test('package validation bounds entry counts and rejects oversized or binary Skill entry points', () => {
  const tooMany = pack()
  tooMany.entries = Array.from({ length: 151 }, (_, index) => ({
    ...structuredClone(pack().entries[0]),
    entry: entry(`skill-${index}`),
  }))
  assert.throws(() => validateLibraryPack(tooMany), /pack|size|limit/i)
  const longEntry = pack()
  longEntry.entries[0].files![0] = file('SKILL.md', 'a'.repeat(128_001))
  assert.throws(() => validateLibraryPack(longEntry), /entry point/i)
  const binaryEntry = pack()
  binaryEntry.entries[0].files![0] = file('SKILL.md', new Uint8Array([1, 0, 2]))
  assert.throws(() => validateLibraryPack(binaryEntry), /entry point/i)
  const hugeResource = pack()
  hugeResource.entries[0].files!.push(file('too-large.txt', Buffer.alloc(4 * 1024 * 1024 + 1)))
  assert.throws(() => validateLibraryPack(hugeResource), /size|integrity/i)
})

test('MCP recipes require pinned packages and credential-free HTTPS endpoints', () => {
  const mcp = pack()
  mcp.entries = [
    {
      entry: { ...entry('fixture-mcp'), kind: 'mcp' },
      mcp: {
        transport: 'stdio',
        package: { name: '@example/server', version: '1.2.3', bin: 'server' },
        args: [],
      },
    },
  ]
  assert.doesNotThrow(() => validateLibraryPack(mcp))
  for (const version of ['latest', '^1.2.3', '~1.2.3', '1', '*']) {
    const unpinned = structuredClone(mcp)
    unpinned.entries[0].mcp!.package!.version = version
    assert.throws(() => validateLibraryPack(unpinned), /exact|version|review/i)
  }
  for (const url of [
    'http://example.com/mcp',
    'https://user:password@example.com/mcp',
    'https://example.com/mcp#secret',
  ]) {
    const unsafe = structuredClone(mcp)
    unsafe.entries[0].mcp = { transport: 'http', url, args: [] }
    assert.throws(() => validateLibraryPack(unsafe), /HTTPS|credentials/i)
  }
})

test('installation records, complete instructions and binary supporting resources survive reload', async (t) => {
  const { libraryDirectory } = await fixture(t)
  const reviewed = pack()
  const library = new ToolLibrary(libraryDirectory, reviewed)
  assert.equal((await library.state()).entries[0].state, 'available')
  assert.deepEqual(await library.catalog(), [])
  await library.installFiles()
  const resourceDirectory = join(libraryDirectory, 'skills', 'fixture-skill', revision)
  assert.equal(await readFile(join(resourceDirectory, 'SKILL.md'), 'utf8'), skillText)
  assert.deepEqual(
    await readFile(join(resourceDirectory, 'references', 'binary.dat')),
    Buffer.from([0, 1, 2, 255]),
  )
  const runtime = { command: process.execPath, args: ['test-only.js'], cwd: libraryDirectory }
  await library.record([entry()], { 'fixture-skill': runtime })
  const reloaded = new ToolLibrary(libraryDirectory, reviewed)
  const state = await reloaded.state()
  assert.equal(state.entries[0].state, 'installed')
  assert.ok(state.installedAt)
  assert.equal(
    await reloaded.runtime('fixture-skill'),
    undefined,
    'Skills never authorize a process runtime.',
  )
  const items = await reloaded.catalog()
  assert.equal(items.length, 1)
  assert.equal(items[0].libraryId, 'fixture-skill')
  assert.ok(items[0].instructions.endsWith(skillText))
  assert.ok(items[0].instructions.length > 16_000)
  assert.match(items[0].instructions, /END-OF-COMPLETE-SKILL/)
  assert.match(items[0].instructions, /instructions only/i)
})

test('catalog import rechecks the installed Skill hash rather than trusting the record', async (t) => {
  const { libraryDirectory } = await fixture(t)
  const library = new ToolLibrary(libraryDirectory, pack())
  await library.installFiles()
  await library.record([entry()], {})
  const target = join(libraryDirectory, 'skills', 'fixture-skill', revision, 'SKILL.md')
  await writeFile(target, 'unreviewed replacement')
  await assert.rejects(library.catalog(), /changed|integrity|reviewed/i)
  assert.equal(await readFile(target, 'utf8'), 'unreviewed replacement')
})

test('a replaced parent directory cannot redirect a Skill installation outside the library', async (t) => {
  const { directory, libraryDirectory } = await fixture(t)
  const outside = join(directory, 'outside')
  const skillDirectory = join(libraryDirectory, 'skills', 'fixture-skill')
  await mkdir(outside)
  await mkdir(skillDirectory, { recursive: true })
  await symlink(
    outside,
    join(skillDirectory, revision),
    process.platform === 'win32' ? 'junction' : 'dir',
  )
  const library = new ToolLibrary(libraryDirectory, pack())
  await assert.rejects(library.installFiles(), /link|path|location|library/i)
  await assert.rejects(lstat(join(outside, 'SKILL.md')), { code: 'ENOENT' })
})

test('reinstalling an MCP descriptor refuses hard links and preserves the outside file', async (t) => {
  const { directory, libraryDirectory } = await fixture(t)
  const reviewed = pack()
  reviewed.entries = [
    {
      entry: { ...entry('fixture-mcp'), kind: 'mcp' },
      mcp: { transport: 'http', url: 'https://example.com/mcp', args: [] },
    },
  ]
  const outside = join(directory, 'outside-important.json')
  const original = '{"preserve":"outside target"}\n'
  await writeFile(outside, original)
  const servers = join(libraryDirectory, 'servers')
  await mkdir(servers, { recursive: true })
  await link(outside, join(servers, 'fixture-mcp.json'))
  const library = new ToolLibrary(libraryDirectory, reviewed)
  await assert.rejects(library.installFiles(), /descriptor|link/i)
  assert.equal(await readFile(outside, 'utf8'), original)
})

test('a redirected MCP descriptor directory cannot write outside managed storage', async (t) => {
  const { directory, libraryDirectory } = await fixture(t)
  const reviewed = pack()
  reviewed.entries = [
    {
      entry: { ...entry('fixture-mcp'), kind: 'mcp' },
      mcp: { transport: 'http', url: 'https://example.com/mcp', args: [] },
    },
  ]
  const outside = join(directory, 'outside-servers')
  await mkdir(outside)
  await mkdir(libraryDirectory)
  const preserved = join(outside, 'fixture-mcp.json')
  await writeFile(preserved, 'outside descriptor must survive')
  await symlink(
    outside,
    join(libraryDirectory, 'servers'),
    process.platform === 'win32' ? 'junction' : 'dir',
  )
  const library = new ToolLibrary(libraryDirectory, reviewed)
  await assert.rejects(library.installFiles(), /directory|link|redirect/i)
  assert.equal(await readFile(preserved, 'utf8'), 'outside descriptor must survive')
})

test('damaged installation records are reported and preserved without rewriting user files', async (t) => {
  const { libraryDirectory } = await fixture(t)
  await mkdir(libraryDirectory)
  const path = join(libraryDirectory, 'installation.json')
  const damaged = '{"version":1,"entries":"not-an-array","runtimes":{},"installedAt":"invalid"}'
  await writeFile(path, damaged)
  const library = new ToolLibrary(libraryDirectory, pack())
  await assert.rejects(library.state(), /damaged|installation/i)
  assert.equal(await readFile(path, 'utf8'), damaged)
  await writeFile(path, '{invalid-json')
  await assert.rejects(library.state(), SyntaxError)
  assert.equal(await readFile(path, 'utf8'), '{invalid-json')
})
