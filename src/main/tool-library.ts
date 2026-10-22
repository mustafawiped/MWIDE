import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile, lstat, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { CatalogItem } from '../shared/contracts.ts'
import type { ToolLibraryEntry, ToolLibraryState } from '../shared/tool-library.ts'

export interface LibraryFile {
  path: string
  sha256: string
  data: string
}
export interface LibraryMcpConfig {
  transport: 'stdio' | 'http'
  url?: string
  package?: { name: string; version: string; bin: string }
  native?: { sha256: string; name: string }
  python?: { name: string; version: string; module: string }
  args: string[]
  environment?: Record<string, string>
  requiresProject?: boolean
  requiresSetup?: boolean
}
export interface LibraryDefinition {
  entry: ToolLibraryEntry
  files?: LibraryFile[]
  mcp?: LibraryMcpConfig
}
export interface LibraryPack {
  version: 1
  revision: string
  entries: LibraryDefinition[]
}
export interface LibraryRuntime {
  command: string
  args: string[]
  cwd: string
  entrySha256?: string
  entryPath?: string
}
interface Installation {
  version: 1
  revision: string
  installedAt: string
  catalogImportedAt?: string
  entries: ToolLibraryEntry[]
  runtimes: Record<string, LibraryRuntime>
}

export function libraryHash(contents: Uint8Array | string): string {
  return createHash('sha256').update(contents).digest('hex')
}

function safeFile(root: string, path: string): string {
  if (
    !path ||
    isAbsolute(path) ||
    path.includes('\\') ||
    path.split('/').some((part) => !part || part === '.' || part === '..' || part.includes(':'))
  )
    throw new Error('Invalid installed resource path.')
  const target = resolve(root, path)
  const child = relative(root, target)
  if (child.startsWith('..') || isAbsolute(child))
    throw new Error('Installed resource escapes its library.')
  return target
}

export function validateLibraryPack(pack: LibraryPack): void {
  if (pack.version !== 1 || !pack.revision || pack.entries.length > 150)
    throw new Error('Unsupported toolkit pack.')
  const ids = new Set<string>()
  let bytes = 0
  for (const { entry, files, mcp } of pack.entries) {
    if (!/^[a-z0-9][a-z0-9-]{1,100}$/.test(entry.id) || ids.has(entry.id))
      throw new Error('Invalid or duplicate library identifier.')
    ids.add(entry.id)
    if (
      !entry.name ||
      entry.name.length > 120 ||
      !/^[a-zA-Z0-9_-][a-zA-Z0-9._-]{0,79}$/.test(entry.source.revision) ||
      !entry.source.license ||
      !entry.version
    )
      throw new Error('Missing or invalid source provenance revision.')
    const source = new URL(entry.source.url)
    if (source.protocol !== 'https:' || source.username || source.password)
      throw new Error('Library sources require public HTTPS URLs.')
    if (entry.kind === 'skill') {
      if (
        !files?.some((file) => file.path === 'SKILL.md') ||
        !files.some((file) => /license/i.test(file.path))
      )
        throw new Error('A skill needs its complete entry point and license.')
      const paths = new Set<string>()
      for (const file of files) {
        safeFile('/library', file.path)
        if (paths.has(file.path)) throw new Error('Duplicate skill resource.')
        paths.add(file.path)
        const content = Buffer.from(file.data, 'base64')
        bytes += content.length
        if (
          content.length > 4 * 1024 * 1024 ||
          bytes > 32 * 1024 * 1024 ||
          libraryHash(content) !== file.sha256
        )
          throw new Error('Skill resource integrity or size check failed.')
        if (
          file.path === 'SKILL.md' &&
          (content.includes(0) || content.toString('utf8').length > 128_000)
        )
          throw new Error('Unsupported skill entry point.')
      }
    } else if (entry.kind === 'mcp') {
      if (!mcp || !['stdio', 'http'].includes(mcp.transport))
        throw new Error('Missing MCP configuration.')
      if (mcp.url) {
        const endpoint = new URL(mcp.url)
        if (
          endpoint.protocol !== 'https:' ||
          endpoint.username ||
          endpoint.password ||
          endpoint.hash
        )
          throw new Error('MCP endpoints require HTTPS without credentials.')
      }
      if (mcp.transport === 'http' && !mcp.url) throw new Error('Missing remote MCP endpoint.')
      if (mcp.transport === 'stdio' && !mcp.package && !mcp.native && !mcp.python)
        throw new Error('Missing MCP runtime recipe.')
      if (
        mcp.package &&
        (!/^(@[a-z0-9-]+\/)?[a-z0-9._-]+$/.test(mcp.package.name) ||
          !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(mcp.package.version))
      )
        throw new Error('MCP packages must have an exact reviewed version.')
    } else throw new Error('Unknown toolkit kind.')
  }
}

/** Local installation state is separate from personal projects and provider credentials. */
export class ToolLibrary {
  readonly directory: string
  private readonly pack: LibraryPack
  private readonly definitions: Map<string, LibraryDefinition>
  constructor(directory: string, pack: LibraryPack) {
    validateLibraryPack(pack)
    this.directory = resolve(directory)
    this.pack = pack
    this.definitions = new Map(pack.entries.map((definition) => [definition.entry.id, definition]))
  }

  definition(id: string): LibraryDefinition {
    const entry = this.definitions.get(id)
    if (!entry) throw new Error('Unknown reviewed library entry.')
    return entry
  }

  private async installed(): Promise<Installation | undefined> {
    try {
      const data = JSON.parse(
        await readFile(join(this.directory, 'installation.json'), 'utf8'),
      ) as Installation
      if (
        data.version !== 1 ||
        !Array.isArray(data.entries) ||
        data.entries.length > 150 ||
        typeof data.runtimes !== 'object' ||
        !data.installedAt
      )
        throw new Error(
          'The toolkit installation record is damaged. Reinstall the reviewed pack; existing files were preserved.',
        )
      return data
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    }
  }

  private async secureDirectory(path: string): Promise<void> {
    await mkdir(this.directory, { recursive: true })
    const same = (a: string, b: string) =>
      process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
    if (
      (await lstat(this.directory)).isSymbolicLink() ||
      !same(await realpath(this.directory), this.directory)
    )
      throw new Error('The library directory was redirected by a link.')
    const child = relative(this.directory, path)
    if (child.startsWith('..') || isAbsolute(child))
      throw new Error('The library directory escapes its root.')
    let current = this.directory
    for (const part of child.split(sep).filter(Boolean)) {
      current = join(current, part)
      await mkdir(current, { recursive: true })
      if ((await lstat(current)).isSymbolicLink() || !same(await realpath(current), current))
        throw new Error('A library resource directory was redirected by a link.')
    }
  }

  async state(): Promise<ToolLibraryState> {
    const installed = await this.installed()
    return {
      installedAt: installed?.installedAt,
      entries: this.pack.entries.map(({ entry }) => {
        const record = installed?.entries.find(
          (item) => item.id === entry.id && item.version === entry.version,
        )
        return {
          ...entry,
          ...(record
            ? {
                state: record.state,
                detail: record.detail,
                verifiedAt: record.verifiedAt,
                toolCount: record.toolCount,
              }
            : {
                state: 'available' as const,
                detail: 'This reviewed package has not been installed in this MWIDE profile.',
              }),
        }
      }),
    }
  }

  /** Copy a reviewed, hash-verified bundle. This never executes Skill scripts or downloads packages. */
  async installFiles(): Promise<void> {
    await this.secureDirectory(this.directory)
    for (const definition of this.pack.entries) {
      const base = join(
        this.directory,
        'skills',
        definition.entry.id,
        definition.entry.source.revision.slice(0, 40),
      )
      for (const file of definition.files ?? []) {
        const target = safeFile(base, file.path)
        await this.secureDirectory(dirname(target))
        // The revision directory is private and newly owned. Never follow an existing link.
        try {
          if ((await lstat(target)).isSymbolicLink())
            throw new Error('A library resource was replaced with a link.')
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        }
        const contents = Buffer.from(file.data, 'base64')
        if (libraryHash(contents) !== file.sha256)
          throw new Error('Skill integrity verification failed.')
        const temporary = `${target}.${randomUUID()}.tmp`
        await writeFile(temporary, contents, { flag: 'wx', mode: 0o600 })
        await rename(temporary, target)
      }
      if (definition.mcp) {
        const target = join(this.directory, 'servers', `${definition.entry.id}.json`)
        await this.secureDirectory(dirname(target))
        try {
          const metadata = await lstat(target)
          if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink > 1)
            throw new Error('An MCP descriptor was replaced with a link.')
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        }
        const temporary = `${target}.${randomUUID()}.tmp`
        await writeFile(
          temporary,
          JSON.stringify({ source: definition.entry.source, config: definition.mcp }, null, 2),
          { flag: 'wx', mode: 0o600 },
        )
        await rename(temporary, target)
      }
    }
  }

  /** Called by the explicit operator installer after actual package installation and checks. */
  async record(
    entries: ToolLibraryEntry[],
    runtimes: Record<string, LibraryRuntime>,
  ): Promise<void> {
    const data: Installation = {
      version: 1,
      revision: this.pack.revision,
      installedAt: new Date().toISOString(),
      entries,
      runtimes,
    }
    await this.secureDirectory(this.directory)
    const target = join(this.directory, 'installation.json')
    const temporary = `${target}.${randomUUID()}.tmp`
    await writeFile(temporary, JSON.stringify(data, null, 2), { flag: 'wx', mode: 0o600 })
    await rename(temporary, target)
  }

  async needsCatalogImport(): Promise<boolean> {
    const installed = await this.installed()
    return Boolean(installed && !installed.catalogImportedAt)
  }

  async markCatalogImported(): Promise<void> {
    const installed = await this.installed()
    if (!installed) return
    installed.catalogImportedAt = new Date().toISOString()
    const target = join(this.directory, 'installation.json')
    const temporary = `${target}.${randomUUID()}.tmp`
    await writeFile(temporary, JSON.stringify(installed, null, 2), { flag: 'wx', mode: 0o600 })
    await rename(temporary, target)
  }

  async runtime(id: string): Promise<LibraryRuntime | undefined> {
    const config = this.definition(id).mcp
    const runtime = (await this.installed())?.runtimes[id]
    if (!runtime || !config) return undefined
    const same = (a: string, b: string) =>
      process.platform === 'win32'
        ? resolve(a).toLowerCase() === resolve(b).toLowerCase()
        : resolve(a) === resolve(b)
    if (!runtime.entrySha256 || !/^[a-f\d]{64}$/i.test(runtime.entrySha256))
      throw new Error(
        'The MCP runtime integrity record is missing. Reinstall the reviewed package.',
      )
    let entry: string
    let command: string
    let args: string[]
    if (config.package) {
      entry = safeFile(
        join(
          this.directory,
          'node-runtimes',
          id,
          'node_modules',
          ...config.package.name.split('/'),
        ),
        config.package.bin,
      )
      command = process.execPath
      args = [entry, ...config.args]
    } else if (config.python) {
      const name = config.python.module.replace(/\.exe$/, '')
      if (!/^[\w.-]+$/.test(name)) throw new Error('Invalid reviewed Python entry point.')
      entry = join(
        this.directory,
        'python-runtimes',
        id,
        process.platform === 'win32' ? 'Scripts' : 'bin',
        `${name}${process.platform === 'win32' ? '.exe' : ''}`,
      )
      command = entry
      args = [...config.args]
    } else if (config.native) {
      if (
        !isAbsolute(runtime.command) ||
        runtime.entrySha256.toLowerCase() !== config.native.sha256.toLowerCase()
      )
        throw new Error('The native MCP runtime does not match the reviewed binary.')
      entry = runtime.command
      command = entry
      args = [...config.args]
    } else return undefined
    if (
      JSON.stringify(runtime.args) !== JSON.stringify(args) ||
      (runtime.entryPath !== undefined && !same(runtime.entryPath, entry))
    )
      throw new Error('The MCP runtime arguments differ from its reviewed package. Reinstall it.')
    if (!config.native) {
      const canonical = await realpath(entry)
      if (!same(canonical, entry) || (await lstat(entry)).isSymbolicLink())
        throw new Error('The MCP runtime path was redirected.')
    }
    // The recorded command is never an authority: Node comes from this host; other
    // entry points come from the managed layout or a hash-pinned native binary.
    return {
      command,
      args,
      cwd: join(this.directory, 'profiles', id),
      entryPath: entry,
      entrySha256: runtime.entrySha256,
    }
  }

  async catalog(): Promise<CatalogItem[]> {
    const state = await this.state()
    const items: CatalogItem[] = []
    for (const entry of state.entries.filter(
      (item) => item.state !== 'available' && item.state !== 'error',
    )) {
      const definition = this.definition(entry.id)
      let instructions: string
      if (entry.kind === 'skill') {
        const resource = definition.files!.find((file) => file.path === 'SKILL.md')!
        const path = safeFile(
          join(this.directory, 'skills', entry.id, entry.source.revision.slice(0, 40)),
          'SKILL.md',
        )
        if (
          (await lstat(path)).isSymbolicLink() ||
          !relative(this.directory, await realpath(path)).startsWith('skills')
        )
          throw new Error('Installed skill path changed.')
        const content = await readFile(path)
        if (libraryHash(content) !== resource.sha256)
          throw new Error(
            `Installed Skill ${entry.name} changed. Reinstall its reviewed source before importing.`,
          )
        instructions = `Source: ${entry.source.url}\nRevision: ${entry.source.revision}\nLicense: ${entry.source.license}\nThis Skill supplies instructions only. Referenced scripts require an execution-capable agent and explicit project permissions.\n\n${content.toString('utf8')}`
      } else
        instructions = `MCP package: ${entry.name}\nSource: ${entry.source.url}\nVersion: ${entry.version}\nStatus: ${entry.detail}\nAccess: ${entry.access.join(', ')}\nSetup: ${entry.requirements.join('; ') || 'No account required.'}\nThis installed server is not automatically connected to the chat model. Checking a connection lists capabilities without invoking tools.`
      items.push({
        id: `library-${entry.id}`,
        libraryId: entry.id,
        kind: entry.kind,
        name: entry.name,
        description: entry.description,
        instructions,
      })
    }
    return items
  }
}
