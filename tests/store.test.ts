import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, rm, rmdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import type { TestContext } from 'node:test'
import { WorkspaceStore } from '../src/main/workspace-store.ts'
import { initialState } from '../src/core/validation.ts'
import type { Project } from '../src/shared/contracts.ts'

async function fixture(t: TestContext): Promise<{ directory: string; file: string }> {
  const prefix = join(process.env.MWIDE_TEST_TMP ?? tmpdir(), 'mwide-store-')
  const directory = await mkdtemp(prefix)
  t.after(async () => {
    assert.ok(directory.startsWith(prefix), 'Cleanup must stay in this test fixture.')
    await rm(directory, { recursive: true, force: true })
  })
  return { directory, file: join(directory, 'workspace.json') }
}

function project(id: string): Project {
  return {
    id,
    name: `Project ${id}`,
    description: 'A project brief.',
    rules: '',
    architecture: '',
    catalogIds: [],
    createdAt: '2026-10-22T12:00:00.000Z',
  }
}

test('missing workspace starts empty; concurrent updates serialize and reload without loss', async (t) => {
  const { directory } = await fixture(t)
  const file = join(directory, 'nested', 'workspace.json')
  const store = await WorkspaceStore.open(file)
  assert.deepEqual(store.snapshot(), initialState())
  await Promise.all(
    Array.from({ length: 16 }, (_, index) =>
      store.update((draft) => {
        draft.projects.push(project(`project-${index}`))
      }),
    ),
  )
  assert.deepEqual(
    store.snapshot().projects.map((item) => item.id),
    Array.from({ length: 16 }, (_, index) => `project-${index}`),
  )
  const loaded = await WorkspaceStore.open(file)
  assert.deepEqual(loaded.snapshot(), store.snapshot())
  const snapshot = loaded.snapshot()
  snapshot.projects[0].description = 'Mutated outside the store'
  snapshot.settings.codexModel = 'external-change'
  assert.notDeepEqual(snapshot, loaded.snapshot())
})

test('canonical project text survives write and reload exactly; retained mutation references cannot change committed state', async (t) => {
  const { file } = await fixture(t)
  const store = await WorkspaceStore.open(file)
  const canonical = {
    ...project('canonical'),
    name: '  Canonical name  ',
    description: '  Original description.\n\nKeep formatting.  \n',
    architecture: '\n  domain → application → adapters\n',
    rules: '  Keep these rules exactly.\n',
  }
  let retained: Project | undefined
  const write = store.update((draft) => {
    draft.projects.push(canonical)
    retained = draft.projects[0]
  })
  await write
  assert.ok(retained)
  retained.description = 'Changed after commit'
  const loaded = await WorkspaceStore.open(file)
  assert.equal(
    loaded.snapshot().projects[0].description,
    '  Original description.\n\nKeep formatting.  \n',
  )
  assert.equal(loaded.snapshot().projects[0].architecture, canonical.architecture)
  assert.equal(loaded.snapshot().projects[0].rules, canonical.rules)
  assert.equal(loaded.snapshot().projects[0].name, canonical.name)
  assert.deepEqual(store.snapshot(), loaded.snapshot())
})

test('failed mutations and validation do not change disk or poison the next queued update', async (t) => {
  const { file } = await fixture(t)
  const store = await WorkspaceStore.open(file)
  await store.update((draft) => {
    draft.projects.push(project('saved'))
  })
  const saved = await readFile(file, 'utf8')
  const rejected = store.update((draft) => {
    draft.projects[0].name = 'Discard'
    throw new Error('Mutation failed')
  })
  const invalid = store.update((draft) => {
    draft.projects[0].catalogIds = ['missing-entry']
  })
  await assert.rejects(rejected, /Mutation failed/)
  await assert.rejects(invalid, /catalog entry/)
  assert.equal(await readFile(file, 'utf8'), saved)
  assert.equal(store.snapshot().projects[0].name, 'Project saved')
  await store.update((draft) => {
    draft.projects.push(project('next'))
  })
  assert.equal((await WorkspaceStore.open(file)).snapshot().projects.length, 2)
})

test('failed atomic rename keeps committed memory intact, removes its temporary file, and permits retry', async (t) => {
  const { directory, file } = await fixture(t)
  const store = await WorkspaceStore.open(file)
  await mkdir(file)
  await assert.rejects(
    store.update((draft) => {
      draft.projects.push(project('failed-write'))
    }),
  )
  assert.deepEqual(store.snapshot(), initialState())
  assert.deepEqual(await readdir(directory), ['workspace.json'])
  await rmdir(file)
  await store.update((draft) => {
    draft.projects.push(project('retry'))
  })
  assert.equal((await WorkspaceStore.open(file)).snapshot().projects[0].id, 'retry')
})

test('malformed JSON, unknown envelopes, invalid state, and unsupported versions are preserved', async (t) => {
  const { file } = await fixture(t)
  const variants = [
    '{broken',
    JSON.stringify({ version: 2, state: initialState() }),
    JSON.stringify({ version: 1, state: initialState(), extra: true }),
    JSON.stringify({
      version: 1,
      state: { ...initialState(), conversations: [{ id: 'orphan', projectId: 'missing' }] },
    }),
    'null',
  ]
  for (const contents of variants) {
    await writeFile(file, contents, 'utf8')
    await assert.rejects(WorkspaceStore.open(file))
    assert.equal(await readFile(file, 'utf8'), contents)
  }
})
