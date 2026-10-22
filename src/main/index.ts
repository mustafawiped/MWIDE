/// <reference types="electron-vite/node" />

import { app, BrowserWindow, Menu, session } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import appIcon from '../renderer/src/assets/mwide-app-icon-256.png?asset'
import { registerWorkspace } from './workspace-ipc.ts'

const rendererFile = join(__dirname, '../renderer/index.html')
const developmentUrl = !app.isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined
const rendererUrl = developmentUrl ?? pathToFileURL(rendererFile).href
let workspace: Awaited<ReturnType<typeof registerWorkspace>> | undefined

async function createWindow(): Promise<void> {
  const window = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 980,
    minHeight: 700,
    title: 'MWIDE',
    icon: appIcon,
    backgroundColor: '#fafaf9',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webviewTag: false,
    },
  })

  window.setMenu(null)
  window.once('ready-to-show', () => window.show())

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  window.webContents.on('will-frame-navigate', (event) => event.preventDefault())
  window.webContents.on('will-redirect', (event) => event.preventDefault())
  window.webContents.on('will-attach-webview', (event) => event.preventDefault())
  window.webContents.on('page-title-updated', (event) => event.preventDefault())

  if (developmentUrl) {
    await window.loadURL(developmentUrl)
  } else {
    await window.loadFile(rendererFile)
  }
}

function handleStartupError(error: unknown): void {
  console.error('MWIDE could not open its window.', error)
  app.quit()
}

app.setName('MWIDE')

const ownsWorkspace = app.requestSingleInstanceLock()
if (!ownsWorkspace) app.quit()
app.on('second-instance', () => {
  const window = BrowserWindow.getAllWindows()[0]
  if (!window) return
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
})

app
  .whenReady()
  .then(async () => {
    if (!ownsWorkspace) return
    Menu.setApplicationMenu(null)
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) =>
      callback(false),
    )
    session.defaultSession.setPermissionCheckHandler(() => false)

    workspace = await registerWorkspace(rendererUrl)
    await createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        void createWindow().catch(handleStartupError)
      }
    })
  })
  .catch(handleStartupError)

app.on('before-quit', () => workspace?.dispose())

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
