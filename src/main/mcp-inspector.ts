import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import { mkdir, readFile, realpath } from 'node:fs/promises'
import { isAbsolute, join, relative } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { ToolLibraryInspection } from '../shared/tool-library.ts'
import { canonicalProjectFolder } from './project-folder.ts'
import { libraryHash, ToolLibrary } from './tool-library.ts'

/** Inspection negotiates MCP and lists capabilities. It never invokes a tool or signs in. */
export async function inspectLibraryMcp(
  library: ToolLibrary,
  id: string,
  projectRoot?: string,
  signal?: AbortSignal,
): Promise<ToolLibraryInspection> {
  const definition = library.definition(id)
  const config = definition.mcp
  if (!config) throw new Error('Select an installed MCP server.')
  const result = (
    connected: boolean,
    detail: string,
    tools: ToolLibraryInspection['tools'] = [],
  ): ToolLibraryInspection => ({
    id,
    connected,
    detail,
    checkedAt: new Date().toISOString(),
    tools,
  })
  const entry = (await library.state()).entries.find((item) => item.id === id)!
  if (entry.state === 'available' || entry.state === 'error') return result(false, entry.detail)
  if (config.requiresSetup)
    return result(false, `Installed configuration needs setup: ${entry.requirements.join('; ')}`)
  if (config.requiresProject && !projectRoot)
    return result(false, 'Select a saved project with a folder before checking this server.')
  const root = projectRoot ? await canonicalProjectFolder(projectRoot) : undefined
  const timeout = AbortSignal.timeout(25_000)
  const abort = signal ? AbortSignal.any([signal, timeout]) : timeout
  abort.throwIfAborted()
  const client = new Client(
    { name: 'MWIDE-library-inspector', version: '1.0.0' },
    { capabilities: { roots: { listChanged: false } }, listMaxPages: 10 },
  )
  client.setRequestHandler('roots/list', async () => ({
    roots: root ? [{ uri: pathToFileURL(root).href, name: 'Selected MWIDE project' }] : [],
  }))
  let transport: StdioClientTransport | StreamableHTTPClientTransport
  if (config.transport === 'http') {
    const endpoint = new URL(config.url!)
    transport = new StreamableHTTPClientTransport(endpoint, {
      requestInit: { redirect: 'error' },
      fetch: async (input, init) => {
        const requested = new URL(input)
        if (requested.origin !== endpoint.origin || requested.protocol !== 'https:')
          throw new Error('The MCP server requested an unexpected network destination.')
        const response = await fetch(input, { ...init, redirect: 'error', signal: abort })
        if (!response.body) return response
        let bytes = 0
        const bounded = response.body.pipeThrough(
          new TransformStream<Uint8Array, Uint8Array>({
            transform(chunk, controller) {
              bytes += chunk.byteLength
              if (bytes > 2 * 1024 * 1024)
                throw new Error('MCP inspection response exceeds its limit.')
              controller.enqueue(chunk)
            },
          }),
        )
        return new Response(bounded, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        })
      },
    })
  } else {
    const runtime = await library.runtime(id)
    if (!runtime || !isAbsolute(runtime.command))
      return result(false, 'The MCP runtime is not installed. Run the reviewed toolkit installer.')
    if (runtime.entrySha256) {
      const executable =
        runtime.entryPath ?? (config.native || config.python ? runtime.command : runtime.args[0])
      if (!executable || libraryHash(await readFile(executable)) !== runtime.entrySha256)
        throw new Error('The installed MCP entry point changed. Reinstall its reviewed package.')
    }
    const home = join(library.directory, 'profiles', id)
    await mkdir(home, { recursive: true })
    const relativeProfile = relative(await realpath(library.directory), await realpath(home))
    if (relativeProfile.startsWith('..') || isAbsolute(relativeProfile))
      throw new Error('The MCP profile path changed.')
    const environment: Record<string, string> = {
      HOME: home,
      USERPROFILE: home,
      APPDATA: home,
      LOCALAPPDATA: home,
      ELECTRON_RUN_AS_NODE: '1',
      DO_NOT_TRACK: '1',
      NO_COLOR: '1',
      OTEL_SDK_DISABLED: 'true',
      ...config.environment,
    }
    for (const [key, value] of Object.entries(environment))
      environment[key] = value
        .replaceAll('${dataDirectory}', home)
        .replaceAll('${projectRoot}', root ?? '')
    const args = runtime.args.map((argument) => {
      if (argument.includes('${projectRoot}') && !root)
        throw new Error('This MCP requires a saved project folder.')
      return argument.replaceAll('${projectRoot}', root ?? '').replaceAll('${dataDirectory}', home)
    })
    transport = new StdioClientTransport({
      command: runtime.command,
      args,
      cwd: home,
      env: environment,
      stderr: 'pipe',
      maxBufferSize: 2 * 1024 * 1024,
    })
    // Drain untrusted diagnostics without sending them to logs or the renderer.
    transport.stderr?.on('data', () => undefined)
  }
  const cancel = () => {
    void client.close().catch(() => undefined)
  }
  abort.addEventListener('abort', cancel, { once: true })
  try {
    await client.connect(transport, { signal: abort, timeout: 20_000 })
    const tools: ToolLibraryInspection['tools'] = []
    const cursors = new Set<string>()
    let cursor: string | undefined
    let limited = false
    for (let page = 0; page < 10; page++) {
      const response = await client.request(
        { method: 'tools/list', params: cursor ? { cursor } : {} },
        {
          signal: abort,
          timeout: 15_000,
        },
      )
      for (const tool of response.tools) {
        if (tools.length >= 300) {
          limited = true
          break
        }
        tools.push({
          name: tool.name.slice(0, 200),
          description: (tool.description ?? '').slice(0, 1000),
        })
      }
      cursor = response.nextCursor
      if (!cursor || limited) break
      if (cursors.has(cursor)) throw new Error('The MCP server repeated its capability page.')
      cursors.add(cursor)
      if (page === 9) limited = true
    }
    return result(
      true,
      `${tools.length} capabilities verified${limited ? ' (list limited)' : ''}. The inspection session is closed; no tools were invoked.`,
      tools,
    )
  } catch (error) {
    if (signal?.aborted) throw signal.reason
    return result(
      false,
      timeout.aborted
        ? 'Connection check timed out. The server session was closed.'
        : `Connection check failed. Review setup and retry. ${(error instanceof Error ? error.message : 'Unknown MCP response.').slice(0, 300)}`,
    )
  } finally {
    abort.removeEventListener('abort', cancel)
    await client.close().catch(() => undefined)
    await transport.close().catch(() => undefined)
  }
}
