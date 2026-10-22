import { app, BrowserWindow, ipcMain, shell } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { ModelProvider } from '../core/model.ts'
import { WorkspaceService } from '../core/workspace.ts'
import { CodexProvider } from '../providers/codex.ts'
import { OllamaProvider, validateOllamaUrl } from '../providers/ollama.ts'
import type { ChatEvent, Project, ProviderSettings } from '../shared/contracts.ts'
import { isTrustedRendererUrl, isTrustedSignInUrl, requireId, requireRecord } from './ipc-policy.ts'
import { WorkspaceStore } from './workspace-store.ts'

interface WorkspaceRuntime {
  dispose(): void
}

/** Keep filesystem, process, and provider access behind explicit workspace operations. */
export async function registerWorkspace(rendererUrl: string): Promise<WorkspaceRuntime> {
  let service: WorkspaceService | undefined
  let startupError: Error | undefined
  let codex: CodexProvider | undefined
  const ollamaProviders = new Map<string, OllamaProvider>()
  const directory = app.getPath('userData')
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

  const emit = (event: ChatEvent): void => {
    for (const window of BrowserWindow.getAllWindows()) {
      const contents = window.webContents
      if (!contents.isDestroyed() && isTrustedRendererUrl(contents.getURL(), rendererUrl)) {
        contents.send('mwide:chat', event)
      }
    }
  }

  try {
    await mkdir(directory, { recursive: true })
    const store = await WorkspaceStore.open(join(directory, 'workspace.json'))
    service = new WorkspaceService(store, resolveProvider, emit)
  } catch (error) {
    startupError = new Error(
      `The saved workspace could not be opened. Your files were preserved. ${error instanceof Error ? error.message : 'Check the application data folder and retry.'}`,
    )
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
      case 'saveSettings':
        return service.saveSettings(input)
      case 'inspectProvider': {
        if (input !== 'codex' && input !== 'ollama') throw new Error('Unknown model provider.')
        const state = await service.getState()
        return (input === 'codex' ? getCodex() : getOllama(state.settings.ollamaUrl)).inspect()
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
      case 'createProject':
        return service.createProject(input)
      case 'updateProject': {
        const project = requireRecord(input)
        requireId(project.id)
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
        return service.cancelOperation()
      case 'summarizeConversation':
        return service.summarizeConversation(requireId(input))
      default:
        throw new Error('Unknown workspace operation.')
    }
  })

  return {
    dispose(): void {
      ipcMain.removeHandler('mwide:request')
      service?.dispose()
      codex?.dispose()
      for (const provider of ollamaProviders.values()) provider.dispose()
      ollamaProviders.clear()
    },
  }
}
