import { app, BrowserWindow, Menu, session } from 'electron'
import { join } from 'node:path'

async function createWindow(): Promise<void> {
  const window = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 980,
    minHeight: 700,
    title: 'MWIDE',
    backgroundColor: '#111318',
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

  const rendererUrl = process.env.ELECTRON_RENDERER_URL

  if (!app.isPackaged && rendererUrl) {
    await window.loadURL(rendererUrl)
  } else {
    await window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function handleStartupError(error: unknown): void {
  console.error('MWIDE could not open its window.', error)
  app.quit()
}

app.setName('MWIDE')

app
  .whenReady()
  .then(async () => {
    Menu.setApplicationMenu(null)
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) =>
      callback(false),
    )
    session.defaultSession.setPermissionCheckHandler(() => false)

    await createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        void createWindow().catch(handleStartupError)
      }
    })
  })
  .catch(handleStartupError)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
