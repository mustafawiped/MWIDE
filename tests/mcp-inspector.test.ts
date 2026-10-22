import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import type { TestContext } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { inspectLibraryMcp } from '../src/main/mcp-inspector.ts'
import { libraryHash, ToolLibrary } from '../src/main/tool-library.ts'
import type { LibraryPack } from '../src/main/tool-library.ts'
import type { ToolLibraryEntry } from '../src/shared/tool-library.ts'

type Mode = 'pages' | 'stall' | 'malformed' | 'oversized' | 'repeated-cursor' | 'many-tools'

async function fixture(t: TestContext, mode: Mode = 'pages') {
  const base = await realpath(process.env.MWIDE_TEST_TMP ?? tmpdir())
  const directory = await mkdtemp(join(base, 'mwide-mcp-inspector-'))
  const projectRoot = join(directory, 'project')
  const libraryDirectory = join(directory, 'library')
  const logPath = join(directory, 'server-log.jsonl')
  const scriptPath = join(
    libraryDirectory,
    'node-runtimes',
    'fixture-mcp',
    'node_modules',
    'fixture-mcp',
    'fixture-server.mjs',
  )
  await mkdir(projectRoot)
  const script = `
import {appendFileSync} from 'node:fs';
import {createInterface} from 'node:readline';
const logPath=${JSON.stringify(logPath)};
const mode=${JSON.stringify(mode)};
const log=value=>appendFileSync(logPath,JSON.stringify(value)+'\\n');
log({type:'start',pid:process.pid,cwd:process.cwd(),environment:{HOME:process.env.HOME,USERPROFILE:process.env.USERPROFILE,APPDATA:process.env.APPDATA,LOCALAPPDATA:process.env.LOCALAPPDATA,secret:process.env.MWIDE_INSPECTOR_SECRET}});
process.stdin.on('end',()=>process.exit(0));
const send=(id,result)=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',id,result})+'\\n');
const tool=index=>({name:'fixture_tool_'+index,description:'A capability that must never be invoked.',inputSchema:{type:'object',properties:{}}});
createInterface({input:process.stdin}).on('line',line=>{
  const message=JSON.parse(line);log({type:'request',method:message.method,params:message.params});
  if(message.method==='initialize'){send(message.id,{protocolVersion:message.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'mwide-test-fixture',version:'1.0.0'}});return;}
  if(message.method==='notifications/initialized'||message.method==='notifications/cancelled')return;
  if(message.method!=='tools/list'){log({type:'unexpected',method:message.method});process.exit(31);return;}
  if(mode==='stall')return;
  if(mode==='malformed'){send(message.id,{tools:'not-an-array'});return;}
  if(mode==='oversized'){process.stdout.write('x'.repeat(2*1024*1024+1024)+'\\n',()=>process.exit(0));return;}
  if(mode==='repeated-cursor'){send(message.id,{tools:[tool(1)],nextCursor:'same-page'});return;}
  if(mode==='many-tools'){send(message.id,{tools:Array.from({length:400},(_,index)=>tool(index)),nextCursor:'must-not-be-fetched'});return;}
  if(message.params?.cursor==='page-2')send(message.id,{tools:[tool(2)]});
  else send(message.id,{tools:[tool(1)],nextCursor:'page-2'});
});
`
  await mkdir(dirname(scriptPath), { recursive: true })
  await writeFile(scriptPath, script)
  const entry: ToolLibraryEntry = {
    id: 'fixture-mcp',
    kind: 'mcp',
    name: 'Fixture MCP',
    description: 'Local protocol fixture.',
    category: 'testing',
    tags: ['testing'],
    coding: true,
    version: '1.2.3',
    source: {
      url: 'https://github.com/example/fixture',
      repository: 'example/fixture',
      revision: 'b'.repeat(40),
      license: 'MIT',
    },
    state: 'installed',
    detail: 'Installed fixture.',
    requirements: [],
    access: ['capability discovery'],
  }
  const pack: LibraryPack = {
    version: 1,
    revision: 'fixture-1',
    entries: [
      {
        entry,
        mcp: {
          transport: 'stdio',
          package: { name: 'fixture-mcp', version: '1.2.3', bin: 'fixture-server.mjs' },
          args: [],
        },
      },
    ],
  }
  const library = new ToolLibrary(libraryDirectory, pack)
  await library.installFiles()
  await library.record([entry], {
    'fixture-mcp': {
      command: process.execPath,
      args: [scriptPath],
      cwd: projectRoot,
      entrySha256: libraryHash(script),
    },
  })
  const logs = async (): Promise<Record<string, unknown>[]> => {
    try {
      return (await readFile(logPath, 'utf8'))
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
  }
  t.after(async () => {
    for (const record of await logs())
      if (record.type === 'start' && typeof record.pid === 'number') {
        try {
          process.kill(record.pid)
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
        }
      }
    assert.ok(resolve(directory).startsWith(join(base, 'mwide-mcp-inspector-')))
    await rm(directory, { recursive: true, force: true })
  })
  return { directory, libraryDirectory, projectRoot, scriptPath, library, pack, entry, logs }
}

test('inspection initializes and lists paged capabilities without invoking any tool or inheriting secrets', async (t) => {
  const { library, libraryDirectory, logs, projectRoot } = await fixture(t)
  const previous = process.env.MWIDE_INSPECTOR_SECRET
  process.env.MWIDE_INSPECTOR_SECRET = 'must-not-reach-the-server'
  t.after(() => {
    if (previous === undefined) delete process.env.MWIDE_INSPECTOR_SECRET
    else process.env.MWIDE_INSPECTOR_SECRET = previous
  })
  const result = await inspectLibraryMcp(library, 'fixture-mcp', projectRoot)
  assert.equal(result.connected, true, result.detail)
  assert.deepEqual(
    result.tools.map((tool) => tool.name),
    ['fixture_tool_1', 'fixture_tool_2'],
  )
  assert.match(result.detail, /no tools were invoked/i)
  const records = await logs()
  const methods = records
    .filter((record) => record.type === 'request')
    .map((record) => record.method)
  assert.deepEqual(methods, ['initialize', 'notifications/initialized', 'tools/list', 'tools/list'])
  assert.equal(
    records.some((record) => record.type === 'unexpected'),
    false,
  )
  const startup = records.find((record) => record.type === 'start')!
  const environment = startup.environment as Record<string, string | undefined>
  const privateHome = join(libraryDirectory, 'profiles', 'fixture-mcp')
  for (const key of ['HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA'])
    assert.equal(environment[key], privateHome)
  assert.equal(startup.cwd, privateHome)
  assert.equal(environment.secret, undefined)
})

test('setup, project and installation gates do not spawn the configured runtime', async (t) => {
  const { library, pack, entry, libraryDirectory, logs } = await fixture(t)
  pack.entries[0].mcp!.requiresSetup = true
  pack.entries[0].entry.requirements = ['A test account must be configured.']
  let result = await inspectLibraryMcp(new ToolLibrary(libraryDirectory, pack), 'fixture-mcp')
  assert.equal(result.connected, false)
  assert.match(result.detail, /setup/i)
  pack.entries[0].mcp!.requiresSetup = false
  pack.entries[0].mcp!.requiresProject = true
  result = await inspectLibraryMcp(new ToolLibrary(libraryDirectory, pack), 'fixture-mcp')
  assert.equal(result.connected, false)
  assert.match(result.detail, /project.*folder/i)
  await library.record([{ ...entry, state: 'error', detail: 'Fixture installation failed.' }], {})
  result = await inspectLibraryMcp(library, 'fixture-mcp')
  assert.equal(result.connected, false)
  assert.match(result.detail, /installation failed/i)
  assert.deepEqual(await logs(), [])
})

test('unknown entries and changed executable source cannot be inspected', async (t) => {
  const { library, scriptPath, logs } = await fixture(t)
  await assert.rejects(inspectLibraryMcp(library, 'not-reviewed'), /unknown|reviewed/i)
  await writeFile(scriptPath, 'throw new Error("unreviewed code must not execute")')
  await assert.rejects(inspectLibraryMcp(library, 'fixture-mcp'), /entry point changed|reviewed/i)
  assert.deepEqual(await logs(), [])
})

test('a forged installation command is ignored in favor of the host Node and reviewed entry point', async (t) => {
  const { library, libraryDirectory, scriptPath } = await fixture(t)
  const recordPath = join(libraryDirectory, 'installation.json')
  const record = JSON.parse(await readFile(recordPath, 'utf8'))
  const forgedCommand = join(libraryDirectory, 'unreviewed-command-must-not-run.exe')
  record.runtimes['fixture-mcp'].command = forgedCommand
  record.runtimes['fixture-mcp'].cwd = join(libraryDirectory, 'unreviewed-cwd')
  await writeFile(recordPath, JSON.stringify(record))
  const runtime = await library.runtime('fixture-mcp')
  assert.equal(runtime?.command, process.execPath)
  assert.deepEqual(runtime?.args, [scriptPath])
  assert.equal(runtime?.cwd, join(libraryDirectory, 'profiles', 'fixture-mcp'))
  const result = await inspectLibraryMcp(library, 'fixture-mcp')
  assert.equal(result.connected, true, result.detail)
  assert.equal(
    JSON.parse(await readFile(recordPath, 'utf8')).runtimes['fixture-mcp'].command,
    forgedCommand,
    'Inspection must not rewrite the damaged record.',
  )
})

test('forged runtime arguments and missing integrity are rejected before spawning a process', async (t) => {
  const { library, libraryDirectory, logs } = await fixture(t)
  const recordPath = join(libraryDirectory, 'installation.json')
  const original = JSON.parse(await readFile(recordPath, 'utf8'))
  const forged = structuredClone(original)
  forged.runtimes['fixture-mcp'].args = ['--eval', 'process.exit(99)']
  await writeFile(recordPath, JSON.stringify(forged))
  await assert.rejects(
    inspectLibraryMcp(library, 'fixture-mcp'),
    /arguments.*reviewed|reviewed.*package/i,
  )
  const missingIntegrity = structuredClone(original)
  delete missingIntegrity.runtimes['fixture-mcp'].entrySha256
  await writeFile(recordPath, JSON.stringify(missingIntegrity))
  await assert.rejects(inspectLibraryMcp(library, 'fixture-mcp'), /integrity.*missing|reinstall/i)
  assert.deepEqual(
    await logs(),
    [],
    'Rejected records must not start even the reviewed fixture server.',
  )
})

test('cancelling a stalled inspection closes its child process promptly', async (t) => {
  const { library, logs } = await fixture(t, 'stall')
  const controller = new AbortController()
  const pending = inspectLibraryMcp(library, 'fixture-mcp', undefined, controller.signal)
  const rejected = assert.rejects(pending, { name: 'AbortError' })
  void rejected.catch(() => undefined)
  for (let attempt = 0; attempt < 100; attempt++) {
    if ((await logs()).some((record) => record.method === 'tools/list')) break
    await delay(20)
  }
  assert.ok(
    (await logs()).some((record) => record.method === 'tools/list'),
    'Fixture must reach its stalled protocol request.',
  )
  const started = performance.now()
  controller.abort(new DOMException('Test inspection cancelled.', 'AbortError'))
  await rejected
  assert.ok(performance.now() - started < 3_000)
  const startup = (await logs()).find((record) => record.type === 'start')!
  let running = true
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      process.kill(startup.pid as number, 0)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') {
        running = false
        break
      }
      throw error
    }
    await delay(20)
  }
  assert.equal(running, false, 'Cancelled MCP fixture must not remain running.')
})

test('malformed and oversized protocol responses fail without exposing capabilities', async (t) => {
  for (const mode of ['malformed', 'oversized'] as const) {
    const { library } = await fixture(t, mode)
    const result = await inspectLibraryMcp(library, 'fixture-mcp')
    assert.equal(result.connected, false, mode)
    assert.deepEqual(result.tools, [])
    assert.ok(result.detail.length < 500)
  }
})

test('unending capability pagination is rejected and large capability lists are bounded', async (t) => {
  const repeated = await fixture(t, 'repeated-cursor')
  const failure = await inspectLibraryMcp(repeated.library, 'fixture-mcp')
  assert.equal(failure.connected, false)
  assert.deepEqual(failure.tools, [])
  assert.ok((await repeated.logs()).filter((record) => record.method === 'tools/list').length <= 10)
  const many = await fixture(t, 'many-tools')
  const success = await inspectLibraryMcp(many.library, 'fixture-mcp')
  assert.equal(success.connected, true, success.detail)
  assert.equal(success.tools.length, 300)
  assert.match(success.detail, /limited/i)
  assert.equal(
    (await many.logs()).filter((record) => record.method === 'tools/list').length,
    1,
    'Reaching the capability limit must stop pagination immediately.',
  )
})
