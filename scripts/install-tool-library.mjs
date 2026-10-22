import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { access, lstat, mkdir, readFile, realpath, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ToolLibrary, libraryHash } from '../src/main/tool-library.ts'

const execute = promisify(execFile)
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const reviewedPath = join(repository, 'data', 'research', 'mcp-candidates.json')
const packPath = join(repository, 'resources', 'tool-library-pack.json')
const originalProfile = process.env.USERPROFILE || homedir()
const defaultDirectory = join(originalProfile, 'AppData', 'Roaming', 'MWIDE', 'tool-library')
const defaultPython = join(
  originalProfile,
  '.cache',
  'codex-runtimes',
  'codex-primary-runtime',
  'dependencies',
  'python',
  'python.exe',
)

function options(args) {
  const result = { directory: defaultDirectory, python: defaultPython, retryErrors: false }
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--retry-errors') {
      result.retryErrors = true
      continue
    }
    if (!['--data-directory', '--python'].includes(args[index]) || !args[index + 1]) {
      throw new Error(
        'Usage: node scripts/install-tool-library.mjs [--data-directory ABSOLUTE_PATH] [--python ABSOLUTE_PYTHON_EXECUTABLE] [--retry-errors]',
      )
    }
    const value = args[++index]
    if (!isAbsolute(value)) throw new Error('Installer paths must be absolute.')
    if (args[index - 1] === '--python') result.python = resolve(value)
    else result.directory = resolve(value)
  }
  return result
}

function contained(root, path) {
  const child = relative(root, path)
  return !child.startsWith('..') && !isAbsolute(child)
}

async function privateDirectory(path) {
  const absolute = resolve(path)
  const parents = []
  for (let current = absolute; dirname(current) !== current; current = dirname(current))
    parents.push(current)
  for (const current of parents.reverse()) {
    try {
      const metadata = await lstat(current)
      if (!metadata.isDirectory() || metadata.isSymbolicLink())
        throw new Error(`Installer directory is not a regular directory: ${current}`)
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
      await mkdir(current, { mode: 0o700 })
    }
  }
  const canonical = await realpath(absolute)
  if (canonical.toLowerCase() !== absolute.toLowerCase())
    throw new Error('Installer directory resolves to a different location.')
  return absolute
}

async function fileHash(path) {
  const metadata = await lstat(path)
  if (!metadata.isFile() || metadata.isSymbolicLink())
    throw new Error('Runtime entry point must be a regular file.')
  return libraryHash(await readFile(path))
}

async function regularExecutable(path) {
  if (!isAbsolute(path)) throw new Error('An absolute executable path is required.')
  await fileHash(path)
  return path
}

async function npmCli() {
  const candidates = [
    join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    join(dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ]
  if (process.platform === 'win32') {
    try {
      const { stdout } = await execute(
        join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'where.exe'),
        ['npm.cmd'],
        { windowsHide: true, timeout: 10_000 },
      )
      for (const path of stdout.trim().split(/\r?\n/))
        if (isAbsolute(path))
          candidates.push(join(dirname(path), 'node_modules', 'npm', 'bin', 'npm-cli.js'))
    } catch {
      // Use only known npm entry-point layouts; never execute a shell or an arbitrary shim.
    }
  }
  for (const path of candidates) {
    try {
      await access(path)
      await fileHash(path)
      return resolve(path)
    } catch {
      /* Try the next standard layout. */
    }
  }
  throw new Error(
    'The npm CLI entry point could not be located. Install a supported Node.js runtime with npm.',
  )
}

async function atomicJson(path, data) {
  await privateDirectory(dirname(path))
  try {
    if ((await lstat(path)).isSymbolicLink())
      throw new Error('The installation record was replaced with a link.')
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  const temporary = `${path}.${randomUUID()}.tmp`
  await writeFile(temporary, JSON.stringify(data, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
  await rename(temporary, path)
}

function reviewedDefinition(definition, reviewed) {
  const config = definition.mcp
  const id = definition.entry.id.replace(/^mcp-/, '')
  const candidate = reviewed.entries.find((entry) => entry.id === id)
  if (!candidate || !config) throw new Error(`Unreviewed MCP identifier: ${definition.entry.id}`)
  const args = config.args || []
  if (
    args.length > 40 ||
    args.some((value) => typeof value !== 'string' || value.includes('\0') || value.length > 4_000)
  )
    throw new Error('Invalid reviewed runtime arguments.')
  const expectedArgs =
    candidate.package?.registry === 'npm'
      ? candidate.config.args.slice(1)
      : candidate.package?.registry === 'pypi'
        ? candidate.config.args.slice(5)
        : candidate.config.args || []
  if (JSON.stringify(args) !== JSON.stringify(expectedArgs))
    throw new Error(`MCP arguments differ from the reviewed recipe: ${id}`)
  if (config.package) {
    const expected = candidate.package
    if (
      expected?.registry !== 'npm' ||
      expected.name !== config.package.name ||
      expected.version !== config.package.version ||
      expected.entrypoint !== config.package.bin ||
      !/^sha512-[A-Za-z0-9+/=]+$/.test(expected.integrity)
    )
      throw new Error(`MCP package differs from reviewed metadata: ${id}`)
    return candidate
  }
  if (config.python) {
    const expected = candidate.package
    if (
      expected?.registry !== 'pypi' ||
      expected.name !== config.python.name ||
      expected.version !== config.python.version ||
      expected.entrypoint !== config.python.module
    )
      throw new Error(`Python MCP differs from reviewed metadata: ${id}`)
    return candidate
  }
  if (config.native) {
    if (
      candidate.package?.registry !== 'native-existing' ||
      config.native.sha256.toLowerCase() !== candidate.package.sha256.toLowerCase() ||
      config.native.name !== candidate.package.executable
    )
      throw new Error(`Native MCP differs from reviewed metadata: ${id}`)
    return candidate
  }
  if (config.transport === 'http' && config.url === candidate.config.url) return candidate
  throw new Error(`MCP connection differs from reviewed metadata: ${id}`)
}

async function run(command, args, cwd, environment) {
  const { stdout, stderr } = await execute(command, args, {
    cwd,
    env: environment,
    windowsHide: true,
    timeout: 15 * 60_000,
    maxBuffer: 4 * 1_024 * 1_024,
  })
  return { stdout, stderr }
}

async function installNpm(definition, candidate, directory, cli, environment) {
  const config = definition.mcp
  const prefix = await privateDirectory(join(directory, 'node-runtimes', definition.entry.id))
  const expected = candidate.package
  const manifest = {
    name: `mwide-tool-${definition.entry.id}`,
    version: '1.0.0',
    private: true,
    dependencies: { [expected.name]: expected.version },
  }
  const manifestPath = join(prefix, 'package.json')
  try {
    const existing = JSON.parse(await readFile(manifestPath, 'utf8'))
    if (JSON.stringify(existing) !== JSON.stringify(manifest))
      throw new Error(
        'The managed package manifest has changed. Preserve it and use a fresh MWIDE library directory.',
      )
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    await atomicJson(manifestPath, manifest)
  }
  const registry = await fetch(
    `https://registry.npmjs.org/${encodeURIComponent(expected.name)}/${encodeURIComponent(expected.version)}`,
    { signal: AbortSignal.timeout(30_000) },
  )
  if (!registry.ok) throw new Error(`Official npm metadata returned HTTP ${registry.status}.`)
  const metadata = await registry.json()
  if (
    metadata.name !== expected.name ||
    metadata.version !== expected.version ||
    metadata.dist?.integrity !== expected.integrity ||
    metadata.dist?.tarball !== expected.tarball
  )
    throw new Error('The official npm package integrity differs from the reviewed artifact.')
  await run(
    process.execPath,
    [
      cli,
      'install',
      '--ignore-scripts',
      '--omit=dev',
      '--no-audit',
      '--no-fund',
      '--save-exact',
      '--package-lock=true',
      '--registry=https://registry.npmjs.org/',
      `--userconfig=${join(directory, 'installer-home', 'user.npmrc')}`,
      `--globalconfig=${join(directory, 'installer-home', 'global.npmrc')}`,
    ],
    prefix,
    environment,
  )
  const packageRoot = join(prefix, 'node_modules', ...expected.name.split('/'))
  const packageJson = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'))
  if (packageJson.name !== expected.name || packageJson.version !== expected.version)
    throw new Error('Installed npm package version mismatch.')
  const lock = JSON.parse(await readFile(join(prefix, 'package-lock.json'), 'utf8'))
  const lockEntry = lock.packages?.[`node_modules/${expected.name}`]
  if (lockEntry?.integrity !== expected.integrity || lockEntry.version !== expected.version)
    throw new Error('The installed package lock does not match reviewed integrity.')
  const entryPath = resolve(packageRoot, config.package.bin)
  if (!contained(packageRoot, entryPath))
    throw new Error('The runtime entry point escapes its package.')
  const entrySha256 = await fileHash(entryPath)
  const cwd = await privateDirectory(join(directory, 'server-data', definition.entry.id))
  return {
    command: process.execPath,
    args: [entryPath, ...config.args],
    cwd,
    entrySha256,
    entryPath,
  }
}

async function installPython(definition, directory, python, environment) {
  const config = definition.mcp
  const prefix = join(directory, 'python-runtimes', definition.entry.id)
  const parent = await privateDirectory(dirname(prefix))
  if (!contained(parent, prefix))
    throw new Error('Python environment path escapes managed storage.')
  const venvPython = join(
    prefix,
    process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
  )
  try {
    await access(venvPython)
  } catch {
    await run(python, ['-m', 'venv', prefix], parent, environment)
  }
  await regularExecutable(venvPython)
  const wheelArguments = []
  if (definition.entry.id === 'serena') {
    const wheels = await privateDirectory(join(directory, 'reviewed-wheels'))
    await run(
      venvPython,
      [join(repository, 'scripts', 'prepare-python-wheels.py'), wheels],
      prefix,
      environment,
    )
    wheelArguments.push('--find-links', wheels)
  }
  await run(
    venvPython,
    [
      '-m',
      'pip',
      'install',
      '--only-binary=:all:',
      '--disable-pip-version-check',
      '--no-input',
      '--no-compile',
      ...wheelArguments,
      `${config.python.name}==${config.python.version}`,
    ],
    prefix,
    environment,
  )
  const { stdout } = await run(
    venvPython,
    [
      '-c',
      'import importlib.metadata,sys; print(importlib.metadata.version(sys.argv[1]))',
      config.python.name,
    ],
    prefix,
    environment,
  )
  if (stdout.trim() !== config.python.version)
    throw new Error('Installed Python MCP version mismatch.')
  await run(venvPython, ['-m', 'pip', 'check'], prefix, environment)
  const module = config.python.module.replace(/\.exe$/, '')
  if (!/^[A-Za-z0-9_.-]+$/.test(module)) throw new Error('Invalid reviewed Python executable name.')
  const entryPath = join(
    prefix,
    process.platform === 'win32' ? 'Scripts' : 'bin',
    module + (process.platform === 'win32' ? '.exe' : ''),
  )
  const entrySha256 = await fileHash(entryPath)
  return {
    command: entryPath,
    args: config.args,
    cwd: await privateDirectory(join(directory, 'server-data', definition.entry.id)),
    entrySha256,
    entryPath,
  }
}

async function existingNative(definition, directory) {
  const expected = definition.mcp.native
  const path = join(
    originalProfile,
    'AppData',
    'Local',
    'Programs',
    'codebase-memory-mcp',
    expected.name,
  )
  if ((await fileHash(path)).toLowerCase() !== expected.sha256.toLowerCase())
    throw new Error('The existing native MCP executable does not match the reviewed SHA-256.')
  return {
    command: path,
    args: definition.mcp.args,
    cwd: await privateDirectory(join(directory, 'server-data', definition.entry.id)),
    entrySha256: expected.sha256,
    entryPath: path,
  }
}

async function main() {
  const configuration = options(process.argv.slice(2))
  if (configuration.directory === defaultDirectory) {
    // Windows packaged hosts can virtualize Roaming without exposing a reparse point.
    // Resolve the OS-owned base once, then enforce all writes below its MWIDE child.
    await mkdir(dirname(defaultDirectory), { recursive: true })
    configuration.directory = join(await realpath(dirname(defaultDirectory)), 'tool-library')
  }
  const [pack, reviewed] = await Promise.all([
    readFile(packPath, 'utf8').then(JSON.parse),
    readFile(reviewedPath, 'utf8').then(JSON.parse),
  ])
  if (
    pack.entries.length !== 100 ||
    pack.entries.filter((definition) => definition.entry.kind === 'skill').length !== 70 ||
    pack.entries.filter((definition) => definition.entry.kind === 'mcp').length !== 30
  )
    throw new Error('Expected the reviewed 70-Skill, 30-MCP pack.')
  const candidates = new Map(
    pack.entries
      .filter((definition) => definition.entry.kind === 'mcp')
      .map((definition) => [definition.entry.id, reviewedDefinition(definition, reviewed)]),
  )
  const directory = await privateDirectory(configuration.directory)
  const privateHome = await privateDirectory(join(directory, 'installer-home'))
  const environment = {
    PATH: process.env.PATH || '',
    SystemRoot: process.env.SystemRoot || 'C:\\Windows',
    WINDIR: process.env.WINDIR || 'C:\\Windows',
    COMSPEC: process.env.COMSPEC || 'C:\\Windows\\System32\\cmd.exe',
    TEMP: await privateDirectory(join(directory, 'temp')),
    TMP: join(directory, 'temp'),
    HOME: privateHome,
    USERPROFILE: privateHome,
    APPDATA: await privateDirectory(join(privateHome, 'AppData', 'Roaming')),
    LOCALAPPDATA: await privateDirectory(join(privateHome, 'AppData', 'Local')),
    npm_config_cache: await privateDirectory(join(directory, 'npm-cache')),
    PIP_CACHE_DIR: await privateDirectory(join(directory, 'pip-cache')),
    PIP_INDEX_URL: 'https://pypi.org/simple',
    PIP_CONFIG_FILE: process.platform === 'win32' ? 'NUL' : '/dev/null',
    PIP_DISABLE_PIP_VERSION_CHECK: '1',
    PYTHONUTF8: '1',
  }
  const library = new ToolLibrary(directory, pack)
  await library.installFiles()
  await writeFile(join(privateHome, 'user.npmrc'), '', { mode: 0o600 })
  await writeFile(join(privateHome, 'global.npmrc'), '', { mode: 0o600 })
  const entries = (await library.state()).entries
  const runtimes = {}
  for (const definition of pack.entries.filter((item) => item.mcp)) {
    const existing = await library.runtime(definition.entry.id)
    if (existing) runtimes[definition.entry.id] = existing
  }
  const report = {
    version: 1,
    revision: pack.revision,
    directory,
    startedAt: new Date().toISOString(),
    node: process.version,
    python: configuration.python,
    skillsInstalled: 0,
    npmInstalled: 0,
    pythonInstalled: 0,
    nativeRegistered: 0,
    remoteRegistered: 0,
    needsSetup: 0,
    connected: 0,
    errors: 0,
    entries: [],
  }
  let cli
  let python
  for (const definition of pack.entries) {
    const entry = { ...definition.entry, verifiedAt: undefined, toolCount: undefined }
    const reuse =
      configuration.retryErrors &&
      !['error', 'available'].includes(entries.find((existing) => existing.id === entry.id).state)
    try {
      if (entry.kind === 'skill') {
        entry.state = 'installed'
        entry.detail =
          'Complete reviewed Skill files and license installed; supporting scripts were not executed.'
        report.skillsInstalled += 1
      } else {
        const config = definition.mcp
        const candidate = candidates.get(entry.id)
        if (config.package) {
          cli ??= await npmCli()
          if (!reuse || !runtimes[entry.id])
            runtimes[entry.id] = await installNpm(
              definition,
              candidate,
              directory,
              cli,
              environment,
            )
          report.npmInstalled += 1
        } else if (config.python) {
          python ??= await regularExecutable(configuration.python)
          if (!reuse || !runtimes[entry.id])
            runtimes[entry.id] = await installPython(definition, directory, python, environment)
          report.pythonInstalled += 1
        } else if (config.native) {
          if (!reuse || !runtimes[entry.id])
            runtimes[entry.id] = await existingNative(definition, directory)
          report.nativeRegistered += 1
        } else report.remoteRegistered += 1
        const needsSetup =
          config.requiresProject ||
          config.requiresSetup ||
          candidate.auth.required ||
          candidate.parameters?.some((parameter) => parameter.required)
        entry.state = needsSetup ? 'needs-setup' : 'installed'
        entry.detail =
          config.transport === 'http'
            ? 'Official remote endpoint registered in MWIDE; no server binary installed and no connection verified.'
            : 'Pinned MCP runtime installed or verified locally; tools have not been invoked and connection has not been verified.'
        if (needsSetup) {
          report.needsSetup += 1
          entry.detail += ' Project or account setup is required.'
        }
      }
      entries[entries.findIndex((existing) => existing.id === entry.id)] = entry
      report.entries.push({
        id: entry.id,
        kind: entry.kind,
        state: entry.state,
        detail: entry.detail,
        runtimeInstalled: Boolean(runtimes[entry.id]),
      })
      process.stdout.write(JSON.stringify({ id: entry.id, state: entry.state }) + '\n')
    } catch (error) {
      entry.state = 'error'
      entry.detail = `Installation incomplete; existing files preserved. ${String(error.message).slice(0, 1_000)}`
      entries[entries.findIndex((existing) => existing.id === entry.id)] = entry
      report.errors += 1
      report.entries.push({ id: entry.id, kind: entry.kind, state: 'error', detail: entry.detail })
      process.stdout.write(
        JSON.stringify({ id: entry.id, state: 'error', detail: entry.detail }) + '\n',
      )
    }
    // Persist each completed item so an interrupted installer does not lose honest installation state.
    await library.record(entries, runtimes)
  }
  report.finishedAt = new Date().toISOString()
  report.catalogEntries = (await library.catalog()).length
  const reportPath = join(directory, 'installation-report.json')
  await atomicJson(reportPath, report)
  await atomicJson(
    join(repository, '.mwide', 'test-results', 'tool-library-installation.json'),
    report,
  )
  process.stdout.write(
    JSON.stringify({
      complete: true,
      reportPath,
      skillsInstalled: report.skillsInstalled,
      npmInstalled: report.npmInstalled,
      pythonInstalled: report.pythonInstalled,
      nativeRegistered: report.nativeRegistered,
      remoteRegistered: report.remoteRegistered,
      needsSetup: report.needsSetup,
      connected: 0,
      errors: report.errors,
    }) + '\n',
  )
  if (report.errors) process.exitCode = 1
}

main().catch((error) => {
  process.stderr.write(`MWIDE tool library installation stopped: ${error.message}\n`)
  process.exitCode = 1
})
