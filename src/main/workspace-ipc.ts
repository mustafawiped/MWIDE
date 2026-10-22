import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import { mkdir, readFile, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import type { ModelProvider } from '../core/model.ts'
import { WorkspaceService } from '../core/workspace.ts'
import { CodexProvider } from '../providers/codex.ts'
import { OllamaProvider, validateOllamaUrl } from '../providers/ollama.ts'
import type { ChatEvent, Project, ProviderSettings } from '../shared/contracts.ts'
import {
  isTrustedRendererUrl,
  isTrustedSignInUrl,
  requireGrantedFolder,
  requireId,
  requireRecord,
} from './ipc-policy.ts'
import { canonicalProjectFolder } from './project-folder.ts'
import { FolderIndex } from './folder-index.ts'
import { parseCodeGraphQuery } from './codegraph-query.ts'
import { batchChatEvents } from './chat-events.ts'
import { WorkspaceStore } from './workspace-store.ts'
import { ToolLibrary } from './tool-library.ts'
import type { LibraryPack } from './tool-library.ts'
import { inspectLibraryMcp } from './mcp-inspector.ts'
import libraryPackFile from '../../resources/tool-library-pack.json?asset'

interface WorkspaceRuntime {
  dispose(): void
}

/** Keep filesystem, process, and provider access behind explicit workspace operations. */
export async function registerWorkspace(rendererUrl: string): Promise<WorkspaceRuntime> {
  let service: WorkspaceService | undefined
  let startupError: Error | undefined
  let codex: CodexProvider | undefined
  let indexOperation: AbortController | undefined
  let libraryOperation: AbortController | undefined
  let library: ToolLibrary | undefined
  let libraryError: unknown
  const ollamaProviders = new Map<string, OllamaProvider>()
  const selectedFolders = new Set<string>()
  const directory = app.getPath('userData')
  const folderIndex = new FolderIndex(join(__dirname, 'project-folder-worker.cjs'), {
    cacheDirectory: join(directory, 'code-index'),
  })
  const codexProfile = join(directory, 'codex-profile')
  const codexWorkspace = join(directory, 'codex-workspace')

  const getCodex = (): CodexProvider => {
    codex ??= new CodexProvider(codexProfile, codexWorkspace)
    return codex
  }
  const getOllama = (url: string): OllamaProvider => {
    const normalized = validateOllamaUrl(url)
    let provider = ollamaProviders.get(normalized)
    if (!provider) {
      provider = new OllamaProvider(normalized)
      ollamaProviders.set(normalized, provider)
    }
    return provider
  }
  const resolveProvider = (settings: ProviderSettings): ModelProvider =>
    settings.defaultProvider === 'codex' ? getCodex() : getOllama(settings.ollamaUrl)

  const delivery = batchChatEvents((event: ChatEvent): void => {
    for (const window of BrowserWindow.getAllWindows()) {
      const contents = window.webContents
      if (!contents.isDestroyed() && isTrustedRendererUrl(contents.getURL(), rendererUrl)) {
        contents.send('mwide:chat', event)
      }
    }
  })

  try {
    await mkdir(directory, { recursive: true })
    const store = await WorkspaceStore.open(join(directory, 'workspace.json'))
    service = new WorkspaceService(
      store,
      resolveProvider,
      delivery.emit,
      (path, signal, bytes, query) => folderIndex.read(path, signal, bytes, query),
    )
  } catch (error) {
    startupError = new Error(
      `The saved workspace could not be opened. Your files were preserved. ${error instanceof Error ? error.message : 'Check the application data folder and retry.'}`,
    )
  }

  // Installing a new reviewed pack imports it once, without changing project selections.
  // Library damage must never prevent access to personal projects and conversations.
  try {
    const pack = JSON.parse(await readFile(libraryPackFile, 'utf8')) as LibraryPack
    library = new ToolLibrary(join(await realpath(directory), 'tool-library'), pack)
    if (service && (await library.needsCatalogImport())) {
      await service.importToolLibrary(await library.catalog())
      await library.markCatalogImported()
    }
  } catch (error) {
    libraryError = error
  }

  function authorize(event: IpcMainInvokeEvent): void {
    if (
      event.sender.isDestroyed() ||
      !event.senderFrame ||
      event.senderFrame !== event.sender.mainFrame ||
      !isTrustedRendererUrl(event.senderFrame.url, rendererUrl)
    ) {
      throw new Error('This document is not allowed to access the workspace.')
    }
  }

  ipcMain.handle('mwide:request', async (event, method: unknown, input: unknown) => {
    authorize(event)
    if (startupError) throw startupError
    if (!service) throw new Error('The workspace is not ready. Restart MWIDE and retry.')
    switch (method) {
      case 'getState':
        return service.getState()
      case 'getToolLibrary':
        if (!library || libraryError)
          throw libraryError ?? new Error('The reviewed tool library is unavailable.')
        return library.state()
      case 'importToolLibrary': {
        if (!library || libraryError)
          throw libraryError ?? new Error('The reviewed tool library is unavailable.')
        const next = await service.importToolLibrary(await library.catalog())
        await library.markCatalogImported()
        return next
      }
      case 'inspectLibraryMcp': {
        if (!library || libraryError)
          throw libraryError ?? new Error('The reviewed tool library is unavailable.')
        if (libraryOperation) throw new Error('A library connection check is already running.')
        const request = requireRecord(input)
        const id = requireId(request.id)
        let root: string | undefined
        if (request.projectId !== undefined) {
          const projectId = requireId(request.projectId)
          root = (await service.getState()).projects.find(
            (project) => project.id === projectId,
          )?.folderPath
          if (!root) throw new Error('Select a saved project with a folder.')
        }
        const controller = new AbortController()
        libraryOperation = controller
        try {
          return await inspectLibraryMcp(library, id, root, controller.signal)
        } finally {
          if (libraryOperation === controller) libraryOperation = undefined
        }
      }
      case 'saveSettings':
        return service.saveSettings(input)
      case 'inspectProvider': {
        if (input !== 'codex' && input !== 'ollama') throw new Error('Unknown model provider.')
        const state = await service.getState()
        return (input === 'codex' ? getCodex() : getOllama(state.settings.ollamaUrl)).inspect()
      }
      case 'getCodexUsageLimits':
        return getCodex().getUsageLimits()
      case 'inspectProjectCode':
      case 'queryProjectCode': {
        const record = method === 'queryProjectCode' ? requireRecord(input) : undefined
        const id = requireId(record ? record.projectId : input)
        const state = await service.getState()
        const project = state.projects.find((item) => item.id === id)
        if (!project?.folderPath)
          throw new Error('Save a project folder before opening its code index.')
        if (indexOperation) throw new Error('A project code index operation is already running.')
        const controller = new AbortController()
        indexOperation = controller
        try {
          return await (record
            ? folderIndex.query(
                project.folderPath,
                parseCodeGraphQuery(record.query),
                controller.signal,
              )
            : folderIndex.inspect(project.folderPath, controller.signal))
        } finally {
          if (indexOperation === controller) indexOperation = undefined
        }
      }
      case 'selectProjectFolder': {
        const owner = BrowserWindow.fromWebContents(event.sender)
        if (!owner) throw new Error('The project window is no longer available.')
        const choice = await dialog.showOpenDialog(owner, {
          title: 'Choose project folder',
          properties: ['openDirectory'],
          buttonLabel: 'Use project folder',
        })
        if (choice.canceled || !choice.filePaths[0]) return null
        const folder = await canonicalProjectFolder(choice.filePaths[0])
        selectedFolders.add(folder)
        return folder
      }
      case 'signInCodex': {
        const login = await getCodex().login()
        if (!isTrustedSignInUrl(login.url))
          throw new Error('Codex returned an untrusted sign-in URL.')
        await shell.openExternal(login.url)
        return { message: 'Complete sign-in in your browser, then select Check connection.' }
      }
      case 'saveCatalogItem':
        return service.saveCatalogItem(input)
      case 'removeCatalogItem':
        return service.removeCatalogItem(requireId(input))
      case 'recommend':
        return service.recommend(input)
      case 'createProject': {
        const state = await service.getState()
        requireGrantedFolder(
          input,
          new Set([
            ...selectedFolders,
            ...state.projects.flatMap((project) =>
              project.folderPath ? [project.folderPath] : [],
            ),
          ]),
        )
        return service.createProject(input)
      }
      case 'updateProject': {
        const project = requireRecord(input)
        requireId(project.id)
        const state = await service.getState()
        requireGrantedFolder(
          input,
          new Set([
            ...selectedFolders,
            ...state.projects.flatMap((item) => (item.folderPath ? [item.folderPath] : [])),
          ]),
        )
        return service.updateProject(project as unknown as Project)
      }
      case 'createConversation':
        return service.createConversation(requireId(input))
      case 'sendMessage': {
        const message = requireRecord(input)
        requireId(message.conversationId)
        if (typeof message.content !== 'string') throw new Error('A message must contain text.')
        return service.sendMessage({
          conversationId: message.conversationId as string,
          content: message.content,
        })
      }
      case 'cancelMessage':
        return service.cancelMessage(requireId(input))
      case 'cancelOperation':
        libraryOperation?.abort(new DOMException('Connection check cancelled.', 'AbortError'))
        indexOperation?.abort(new DOMException('Project indexing cancelled.', 'AbortError'))
        return service.cancelOperation()
      default:
        throw new Error('Unknown workspace operation.')
    }
  })

  return {
    dispose(): void {
      ipcMain.removeHandler('mwide:request')
      service?.dispose()
      indexOperation?.abort()
      libraryOperation?.abort()
      delivery.dispose()
      folderIndex.dispose()
      codex?.dispose()
      for (const provider of ollamaProviders.values()) provider.dispose()
      ollamaProviders.clear()
      selectedFolders.clear()
    },
  }
}
