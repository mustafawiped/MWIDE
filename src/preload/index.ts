import { contextBridge, ipcRenderer } from 'electron'
import type { ChatEvent, DesktopBridge, WorkspaceBridge } from '../shared/contracts'

const workspace: WorkspaceBridge = Object.freeze<WorkspaceBridge>({
  getState: () => ipcRenderer.invoke('mwide:request', 'getState'),
  saveSettings: (settings) => ipcRenderer.invoke('mwide:request', 'saveSettings', settings),
  inspectProvider: (id) => ipcRenderer.invoke('mwide:request', 'inspectProvider', id),
  signInCodex: () => ipcRenderer.invoke('mwide:request', 'signInCodex'),
  saveCatalogItem: (item) => ipcRenderer.invoke('mwide:request', 'saveCatalogItem', item),
  removeCatalogItem: (id) => ipcRenderer.invoke('mwide:request', 'removeCatalogItem', id),
  recommend: (project) => ipcRenderer.invoke('mwide:request', 'recommend', project),
  createProject: (project) => ipcRenderer.invoke('mwide:request', 'createProject', project),
  updateProject: (project) => ipcRenderer.invoke('mwide:request', 'updateProject', project),
  createConversation: (projectId) =>
    ipcRenderer.invoke('mwide:request', 'createConversation', projectId),
  sendMessage: (input) => ipcRenderer.invoke('mwide:request', 'sendMessage', input),
  cancelMessage: (id) => ipcRenderer.invoke('mwide:request', 'cancelMessage', id),
  cancelOperation: () => ipcRenderer.invoke('mwide:request', 'cancelOperation'),
  summarizeConversation: (id) => ipcRenderer.invoke('mwide:request', 'summarizeConversation', id),
  onChatEvent: (listener) => {
    const receive = (_event: Electron.IpcRendererEvent, event: ChatEvent): void => listener(event)
    ipcRenderer.on('mwide:chat', receive)
    return () => ipcRenderer.removeListener('mwide:chat', receive)
  },
})

const desktopBridge: DesktopBridge = Object.freeze({
  platform: process.platform,
  workspace,
})

contextBridge.exposeInMainWorld('mwide', desktopBridge)
