import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, mkdir, mkdtemp, readFile, unlink, writeFile } from 'node:fs/promises'
import { cpus, release } from 'node:os'
import { delimiter, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { performance } from 'node:perf_hooks'
import {
  codegraphFixture,
  deletedFixture,
  editedFixture,
  scoreEdges,
} from './codegraph-fixture.mjs'

const script = fileURLToPath(import.meta.url)
const workspace = resolve(dirname(script), '..')
const round = (value) => Math.round(value * 1000) / 1000

if (process.argv[2] === '--mwide') {
  const { CodeGraphStore } = await import('../src/main/codegraph-store.ts')
  const [root, cache, phase] = process.argv.slice(3)
  const store = new CodeGraphStore(cache)
  try {
    if (phase === 'resident') await store.refresh(root)
    const started = performance.now()
    const status = await store.refresh(root)
    const refreshMs = performance.now() - started
    const queryStarted = performance.now()
    const symbols = new Map()
    for (let offset = 0; ; offset += 100) {
      const page = store.query(root, { type: 'search', query: '', limit: 100, offset })
      for (const symbol of page.symbols) symbols.set(symbol.id, symbol)
      if (offset + page.symbols.length >= page.total) break
    }
    const edges = new Map()
    for (const symbol of symbols.values()) {
      const trace = store.query(root, {
        type: 'trace',
        symbolId: symbol.id,
        direction: 'outbound',
        depth: 1,
        limit: 500,
      })
      if (trace.truncated) throw new Error('Benchmark graph query unexpectedly truncated.')
      for (const edge of trace.edges) {
        if (edge.type !== 'CALLS') continue
        const from = symbols.get(edge.from)
        const to = symbols.get(edge.to)
        if (!from || !to) throw new Error('Benchmark graph has a dangling edge.')
        const pair = [`${from.file}:${from.startLine}`, `${to.file}:${to.startLine}`]
        edges.set(pair.join(' -> '), pair)
      }
    }
    const { root: _root, ...publicStatus } = status
    process.stdout.write(
      JSON.stringify({
        refreshMs: round(refreshMs),
        queryMs: round(performance.now() - queryStarted),
        status: publicStatus,
        edges: [...edges.values()],
      }),
    )
  } finally {
    store.close()
  }
  process.exit(0)
}

async function resolveReferenceBinary() {
  if (process.env.MWIDE_REFERENCE_BINARY) return resolve(process.env.MWIDE_REFERENCE_BINARY)
  const name = process.platform === 'win32' ? 'codebase-memory-mcp.exe' : 'codebase-memory-mcp'
  for (const directory of (process.env.PATH ?? '').split(delimiter)) {
    if (!directory) continue
    const candidate = join(directory, name)
    try {
      await access(candidate)
      return candidate
    } catch {
      /* Search the remaining PATH entries. */
    }
  }
  throw new Error('Set MWIDE_REFERENCE_BINARY or put codebase-memory-mcp on PATH.')
}

const binary = await resolveReferenceBinary()
if (process.argv[2] === '--summarize') {
  const report = JSON.parse(
    await readFile(process.argv[3] ?? join(workspace, 'docs', 'codegraph-benchmark.json'), 'utf8'),
  )
  await writeReports(report)
  process.exit(0)
}

function timed(operation) {
  const started = performance.now()
  const value = operation()
  return { value, wallMs: round(performance.now() - started) }
}
function unwrap(envelope) {
  if (envelope.isError) throw new Error(JSON.stringify(envelope))
  if (envelope.structuredContent) return envelope.structuredContent
  for (const content of envelope.content ?? []) {
    if (content.type === 'text') {
      try {
        return JSON.parse(content.text)
      } catch {
        /* Older versions return plain text. */
      }
    }
  }
  return envelope
}
function timings(value, path = '', depth = 0) {
  if (!value || typeof value !== 'object' || depth > 8) return {}
  const found = {}
  for (const [key, item] of Object.entries(value)) {
    const name = path ? `${path}.${key}` : key
    if (typeof item === 'number' && /duration|elapsed|time.*ms|seconds/i.test(key))
      found[name] = item
    else if (item && typeof item === 'object') Object.assign(found, timings(item, name, depth + 1))
  }
  return found
}
const samples = Number(process.env.MWIDE_BENCH_SAMPLES ?? 5)
if (!Number.isSafeInteger(samples) || samples < 1 || samples > 10)
  throw new Error('MWIDE_BENCH_SAMPLES must be an integer between 1 and 10.')
await mkdir(join(workspace, '.tools'), { recursive: true })
const base = await mkdtemp(join(workspace, '.tools', 'codegraph-benchmark-'))
const fixture = codegraphFixture()
const changed = editedFixture(fixture)
const removed = deletedFixture(changed)
const fixtureHash = createHash('sha256').update(JSON.stringify(fixture)).digest('hex')
const results = []
const owned = new Set()
let argumentOrdinal = 0
const reference = async (root, method, args) => {
  const argumentFile = join(base, `arguments-${argumentOrdinal++}.json`)
  await writeFile(argumentFile, JSON.stringify(args))
  const output = timed(() =>
    execFileSync(binary, ['cli', '--quiet', '--json', method, '--args-file', argumentFile], {
      env: { ...process.env, CBM_ALLOWED_ROOT: root },
      windowsHide: true,
      encoding: 'utf8',
      timeout: 90_000,
      maxBuffer: 16 * 1024 * 1024,
    }),
  )
  const value = unwrap(JSON.parse(output.value))
  return { value, wallMs: output.wallMs, internalTimings: timings(value) }
}
const mwide = (root, cache, phase) => {
  const output = timed(() =>
    execFileSync(
      process.execPath,
      ['--experimental-strip-types', script, '--mwide', root, cache, phase],
      {
        windowsHide: true,
        encoding: 'utf8',
        timeout: 90_000,
        maxBuffer: 16 * 1024 * 1024,
      },
    ),
  )
  return { ...JSON.parse(output.value), wallMs: output.wallMs }
}
const index = (root, project) =>
  reference(root, 'index_repository', {
    repo_path: root,
    name: project,
    mode: 'fast',
    persistence: false,
  })
const graph = async (root, project) => {
  const output = await reference(root, 'query_graph', {
    project,
    query:
      'MATCH (a)-[:CALLS]->(b) RETURN a.file_path, a.start_line, b.file_path, b.start_line LIMIT 10000',
    format: 'json',
    max_rows: 10000,
  })
  if (output.value.has_more || output.value.truncated)
    throw new Error('Reference graph query unexpectedly truncated.')
  if (!Array.isArray(output.value.rows))
    throw new Error(`Unsupported reference graph result: ${JSON.stringify(output.value)}`)
  return {
    ...output,
    edges: output.value.rows.map(([a, al, b, bl]) => [
      `${a.replaceAll('\\', '/')}:${Number(al)}`,
      `${b.replaceAll('\\', '/')}:${Number(bl)}`,
    ]),
  }
}
async function populate(root, sources) {
  for (const [file, source] of Object.entries(sources)) {
    const path = join(root, file)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, source)
  }
}
function publicMwide(value, expected) {
  const { edges, ...metrics } = value
  const quality = scoreEdges(edges, expected)
  if (quality.falsePositives || quality.falseNegatives) {
    throw new Error(
      `MWIDE static fixture regression: ${quality.falsePositives} false positives, ${quality.falseNegatives} missing relationships.`,
    )
  }
  return { ...metrics, quality }
}
function publicReference(value, queried, expected) {
  return {
    wallMs: value.wallMs,
    internalTimings: value.internalTimings,
    queryWallMs: queried.wallMs,
    quality: scoreEdges(queried.edges, expected),
  }
}
try {
  for (let sample = 0; sample < samples; sample++) {
    const root = join(base, `sample-${sample + 1}`, 'project')
    const cache = join(base, `sample-${sample + 1}`, 'mwide-cache')
    const project = `mwide-benchmark-run-${Date.now()}-${sample + 1}`
    owned.add(project)
    await populate(root, fixture.sources)
    process.stdout.write(`Sample ${sample + 1}/${samples}: cold indexing\n`)
    let oursCold, referenceCold
    if (sample % 2 === 0) {
      oursCold = mwide(root, cache, 'single')
      referenceCold = await index(root, project)
    } else {
      referenceCold = await index(root, project)
      oursCold = mwide(root, cache, 'single')
    }
    const referenceColdGraph = await graph(root, project)
    const oursResident = mwide(root, cache, 'resident')
    const oursRestart = mwide(root, cache, 'single')
    const referenceWarm = await index(root, project)
    const referenceWarmGraph = await graph(root, project)
    process.stdout.write(`Sample ${sample + 1}/${samples}: one-file edit\n`)
    await writeFile(join(root, 'units/unit010.ts'), changed.sources['units/unit010.ts'])
    const oursEdited = mwide(root, cache, 'single')
    const referenceEdited = await index(root, project)
    const referenceEditedGraph = await graph(root, project)
    process.stdout.write(`Sample ${sample + 1}/${samples}: one-file deletion\n`)
    await unlink(join(root, 'units/unit127.ts'))
    const oursDeleted = mwide(root, cache, 'single')
    const referenceDeleted = await index(root, project)
    const referenceDeletedGraph = await graph(root, project)
    results.push({
      sample: sample + 1,
      coldOrder: sample % 2 === 0 ? 'mwide-first' : 'reference-first',
      mwide: {
        cold: publicMwide(oursCold, fixture.expected),
        residentWarm: publicMwide(oursResident, fixture.expected),
        restart: publicMwide(oursRestart, fixture.expected),
        edit: publicMwide(oursEdited, changed.expected),
        delete: publicMwide(oursDeleted, removed.expected),
      },
      reference: {
        cold: publicReference(referenceCold, referenceColdGraph, fixture.expected),
        warm: publicReference(referenceWarm, referenceWarmGraph, fixture.expected),
        edit: publicReference(referenceEdited, referenceEditedGraph, changed.expected),
        delete: publicReference(referenceDeleted, referenceDeletedGraph, removed.expected),
      },
    })
    process.stdout.write(`Sample ${sample + 1}/${samples}: deleting owned reference index\n`)
    await reference(root, 'delete_project', { project })
    owned.delete(project)
  }
} finally {
  for (const project of owned) {
    if (!project.startsWith('mwide-benchmark-run-'))
      throw new Error('Refusing unrelated reference cleanup.')
    try {
      await reference(base, 'delete_project', { project })
    } catch (error) {
      process.stderr.write(`Owned benchmark index cleanup failed: ${error.message}\n`)
    }
  }
}
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
const report = {
  generatedAt: new Date().toISOString(),
  fixture: {
    files: Object.keys(fixture.sources).length,
    bytes: Object.values(fixture.sources).reduce(
      (total, text) => total + Buffer.byteLength(text),
      0,
    ),
    sha256: fixtureHash,
    expectedCalls: new Set(fixture.expected.map((pair) => pair.join(' -> '))).size,
  },
  environment: {
    platform: process.platform,
    architecture: process.arch,
    node: process.version,
    reference: 'codebase-memory-mcp 0.11.0',
    referenceMode: 'fast',
    samples,
  },
  methodology: [
    'Identical deterministic TypeScript/JavaScript sources and explicit positive/negative static-call ground truth; no fixture source executed.',
    'Five new project roots by default. Cold engine order alternates to reduce OS filesystem cache bias. Warm filesystem caches are not flushed.',
    'MWIDE cold/restart/edit/delete wall time includes fresh Node process, module loading, refresh, complete public graph search/trace retrieval, and process shutdown. Internal refresh/query durations are listed separately.',
    'Reference wall time includes a fresh installed CLI process and index_repository. Complete CALLS retrieval is timed as a separate fresh CLI query. This includes CLI/RPC admission overhead; it is not an isolated parser throughput comparison.',
    'MWIDE residentWarm primes a persisted index and measures another refresh in the same process; only its internal refresh duration is comparable to the running desktop service, not reference CLI wall time.',
    'After one import-target edit and one terminal file deletion, both engines reindex and all returned CALLS edges are rescored. Source coordinates disambiguate duplicate names.',
    'Only benchmark-owned reference project indexes are deleted. Existing indexes, sessions and reference cache configuration are untouched.',
    'This is a small TS/JS static-resolution workload. It does not establish superiority across languages, semantic/type inference, MCP tool breadth, large repositories, memory use, or real AI answer quality.',
  ],
  medians: {
    mwide: Object.fromEntries(
      ['cold', 'residentWarm', 'restart', 'edit', 'delete'].map((phase) => [
        phase,
        {
          wallMs: median(results.map((item) => item.mwide[phase].wallMs)),
          refreshMs: median(results.map((item) => item.mwide[phase].refreshMs)),
          queryMs: median(results.map((item) => item.mwide[phase].queryMs)),
        },
      ]),
    ),
    reference: Object.fromEntries(
      ['cold', 'warm', 'edit', 'delete'].map((phase) => [
        phase,
        {
          wallMs: median(results.map((item) => item.reference[phase].wallMs)),
          queryWallMs: median(results.map((item) => item.reference[phase].queryWallMs)),
        },
      ]),
    ),
  },
  results,
}
await mkdir(join(workspace, 'docs'), { recursive: true })
await writeFile(
  join(workspace, 'docs', 'codegraph-benchmark.json'),
  `${JSON.stringify(report, null, 2)}\n`,
)
await writeReports(report)

async function writeReports(report) {
  const results = report.results
  const summarize = (values) => {
    const ordered = [...values].sort((a, b) => a - b)
    return {
      median: ordered[Math.floor(ordered.length / 2)],
      p95: ordered[Math.ceil(ordered.length * 0.95) - 1],
      max: ordered.at(-1),
    }
  }
  const processor = cpus()
  report.environment = {
    ...report.environment,
    osRelease: release(),
    cpuModel: processor[0]?.model ?? 'unavailable',
    logicalCpus: processor.length,
    referenceBinary: binary.split(/[\\/]/).at(-1),
    referenceSha256: createHash('sha256')
      .update(await readFile(binary))
      .digest('hex'),
  }
  try {
    const output = execFileSync(binary, ['--version'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 10_000,
    })
    report.environment.referenceVersionFromCli =
      output.match(/\b\d+\.\d+\.\d+(?:[-+][\w.-]+)?\b/)?.[0] ?? 'unavailable'
  } catch {
    report.environment.referenceVersionFromCli = 'unavailable'
  }
  report.sourceHashes = Object.fromEntries(
    await Promise.all(
      [
        'src/main/codegraph-parser.ts',
        'src/main/codegraph-linker.ts',
        'src/main/codegraph-store.ts',
        'src/main/codegraph-files.ts',
        'src/shared/codegraph.ts',
        'tests/codegraph-fixture.mjs',
        'tests/benchmark-codegraph.mjs',
      ].map(async (file) => [
        file,
        createHash('sha256')
          .update(await readFile(join(workspace, file)))
          .digest('hex'),
      ]),
    ),
  )
  report.statistics = { mwide: {}, reference: {} }
  for (const phase of ['cold', 'residentWarm', 'restart', 'edit', 'delete'])
    report.statistics.mwide[phase] = {
      refreshMs: summarize(results.map((item) => item.mwide[phase].refreshMs)),
      queryMs: summarize(results.map((item) => item.mwide[phase].queryMs)),
      wallMs: summarize(results.map((item) => item.mwide[phase].wallMs)),
    }
  for (const phase of ['cold', 'warm', 'edit', 'delete']) {
    const values = results.map(
      (item) => item.reference[phase].wallMs + item.reference[phase].queryWallMs,
    )
    report.medians.reference[phase].totalWallMs = round(summarize(values).median)
    report.statistics.reference[phase] = {
      indexWallMs: summarize(results.map((item) => item.reference[phase].wallMs)),
      queryWallMs: summarize(results.map((item) => item.reference[phase].queryWallMs)),
      totalWallMs: summarize(values),
    }
  }
  for (const line of [
    'Reference total wall time is index CLI wall plus complete CALLS query CLI wall, matching the work included in MWIDE child wall time. Engine-specific transport/startup designs differ.',
    'Statistics use nearest-rank p95; with five samples p95 equals max. This small sample does not establish a latency distribution or confidence interval.',
    'Source and reference binary SHA-256 hashes are captured when the report is finalized; OS and CPU metadata describe this machine. The installed reference cache/server may be shared and CLI admission overhead is included.',
    'Ground truth covers unambiguous static declaration relationships, not every possible runtime dispatch. Dynamic receivers are expected unresolved. Type-only invocation and missing static-method cases are intentional invalid-program negatives; the fixture is parsed, never typechecked or executed.',
  ])
    if (!report.methodology.includes(line)) report.methodology.push(line)
  await writeFile(
    join(workspace, 'docs', 'codegraph-benchmark.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  )
  const quality = (engine, phase) => results.map((item) => item[engine][phase].quality)
  const range = (values) => `${Math.min(...values)}–${Math.max(...values)}`
  const table = [
    '| Phase | MWIDE internal refresh median (ms) | MWIDE child incl. full query median (ms) | Reference index + full query median (ms) |',
    '|---|---:|---:|---:|',
  ]
  for (const [ours, theirs] of [
    ['cold', 'cold'],
    ['restart', 'warm'],
    ['edit', 'edit'],
    ['delete', 'delete'],
  ]) {
    table.push(
      `| ${ours} / ${theirs} | ${report.medians.mwide[ours].refreshMs} | ${report.medians.mwide[ours].wallMs} | ${report.medians.reference[theirs].totalWallMs} |`,
    )
  }
  const qualityTable = [
    '| Engine / phase | Correct / expected calls | False positive calls | Precision | Recall |',
    '|---|---:|---:|---:|---:|',
  ]
  for (const engine of ['mwide', 'reference']) {
    for (const phase of ['cold', 'edit', 'delete']) {
      const data = quality(engine, phase)
      qualityTable.push(
        `| ${engine} / ${phase} | ${range(data.map((item) => item.truePositives))} / ${range(data.map((item) => item.expected))} | ${range(data.map((item) => item.falsePositives))} | ${range(data.map((item) => round(item.precision * 100)))}% | ${range(data.map((item) => round(item.recall * 100)))}% |`,
      )
    }
  }
  const tails = [
    '| Engine / phase | Median end-to-end (ms) | p95 (ms) | Max (ms) |',
    '|---|---:|---:|---:|',
  ]
  for (const [ours, theirs] of [
    ['cold', 'cold'],
    ['restart', 'warm'],
    ['edit', 'edit'],
    ['delete', 'delete'],
  ]) {
    const a = report.statistics.mwide[ours].wallMs
    const b = report.statistics.reference[theirs].totalWallMs
    tails.push(`| MWIDE / ${ours} | ${round(a.median)} | ${round(a.p95)} | ${round(a.max)} |`)
    tails.push(`| Reference / ${theirs} | ${round(b.median)} | ${round(b.p95)} | ${round(b.max)} |`)
  }
  await writeFile(
    join(workspace, 'docs', 'codegraph-benchmark.md'),
    `# Code graph benchmark\n\nMeasured ${report.generatedAt}. Reproduce with \`node --experimental-strip-types tests/benchmark-codegraph.mjs\`. Set \`MWIDE_REFERENCE_BINARY\` to the reference executable, or put \`codebase-memory-mcp\` on PATH. Raw ${report.environment.samples}-sample data, source hashes and the complete methodology are in [codegraph-benchmark.json](codegraph-benchmark.json).\n\nMachine: ${report.environment.platform} ${report.environment.osRelease}, ${report.environment.cpuModel}, ${report.environment.logicalCpus} logical CPUs, Node ${report.environment.node}. Reference: ${report.environment.reference}, fast indexing mode.\n\nFixture: ${report.fixture.files} files, ${report.fixture.bytes} UTF-8 bytes, ${report.fixture.expectedCalls} expected unique call relationships; SHA-256 \`${report.fixture.sha256}\`. Includes local calls, recursion, arrows, renamed imports, relative JavaScript extension substitution, class/static/this calls, export barrels/cycles, parameter/block/var shadowing, erased type imports, strings/comments, and unknown receivers.\n\n${table.join('\n')}\n\nMWIDE resident warm refresh median: **${report.medians.mwide.residentWarm.refreshMs} ms**. This excludes process startup and is not directly compared with the reference CLI.\n\n${tails.join('\n')}\n\nNearest-rank p95 equals max with only five samples.\n\n${qualityTable.join('\n')}\n\n${report.methodology.map((line) => `- ${line}`).join('\n')}\n`,
  )
  process.stdout.write(`Report: docs/codegraph-benchmark.json and docs/codegraph-benchmark.md\n`)
}
