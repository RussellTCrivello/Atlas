const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { app: electronApp, BrowserWindow, Menu, dialog, ipcMain, session, shell } = require('electron')
const { isSafeExternalUrl, sameOrigin } = require('./security.cjs')

const devToolsAllowed = !electronApp.isPackaged || process.env.ATLAS_DEVTOOLS === '1'
let mainWindow = null
let running = null // the embedded Atlas server
let origin = ''
let quitting = false
const setupToken = crypto.randomBytes(16).toString('base64url')

const appRoot = () => (electronApp.isPackaged ? electronApp.getAppPath() : path.join(__dirname, '..'))
const dataDir = () => path.join(electronApp.getPath('userData'), 'data')
const stateFile = () => path.join(electronApp.getPath('userData'), 'desktop.json')

// ---- one instance only: two servers on one data directory would overwrite each other's changes -------------------------
if (!electronApp.requestSingleInstanceLock()) {
  electronApp.quit()
} else {
  electronApp.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(stateFile(), 'utf8'))
  } catch {
    return {}
  }
}
function writeState(state) {
  try {
    fs.mkdirSync(path.dirname(stateFile()), { recursive: true })
    fs.writeFileSync(stateFile(), JSON.stringify(state))
  } catch {
    /* the remembered port is a convenience only */
  }
}

/** A stable but unpredictable port: remembered between launches (so the page origin, and what the browser stores for it, stays the same). */
function preferredPort() {
  if (process.env.PORT) return Number(process.env.PORT)
  const saved = Number(readState().port)
  return Number.isInteger(saved) && saved >= 1024 ? saved : 49152 + crypto.randomInt(0, 16000)
}

async function loadServerModule() {
  process.env.NODE_ENV = 'production'
  process.env.ATLAS_ROOT = appRoot()
  process.env.ATLAS_STATIC_DIR = path.join(appRoot(), 'dist')
  process.env.ATLAS_DATA_DIR = dataDir()
  process.env.ATLAS_HOST = '127.0.0.1'
  process.env.ATLAS_SETUP_TOKEN = setupToken
  process.env.PORT = String(preferredPort())
  return import(pathToFileURL(path.join(appRoot(), 'dist-desktop', 'app.mjs')).href)
}

async function startAtlas() {
  const server = await loadServerModule()
  const config = server.loadConfig(process.env)
  try {
    running = await server.startServer(config, { portFallback: true })
  } catch (error) {
    const recovered = await offerRecovery(error, server, config)
    if (!recovered) throw error
    running = await server.startServer(config, { portFallback: true })
  }
  origin = new URL(running.url).origin
  writeState({ ...readState(), port: running.port })
  return running
}

/** An unreadable store is never replaced silently; the person decides, with the backups listed. */
async function offerRecovery(error, server, config) {
  if (!error || (error.name !== 'StoreCorruptError' && error.name !== 'StoreMissingError')) return false
  const backups = (error.backups || [])
    .slice(0, 5)
    .map(b => `  ${b.createdAt}  ${b.reason}`)
    .join('\n')
  const { response } = await dialog.showMessageBox({
    type: 'error',
    title: 'Atlas cannot open your data',
    message: 'Your Atlas data file could not be read.',
    detail: `${error.message}\n\nNothing was changed or deleted.${backups ? `\n\nNewest backups:\n${backups}` : ''}`,
    buttons: backups ? ['Restore the newest backup', 'Open the data folder', 'Quit'] : ['Open the data folder', 'Quit'],
    defaultId: 0,
    cancelId: backups ? 2 : 1
  })
  const choice = backups ? ['restore', 'folder', 'quit'][response] : ['folder', 'quit'][response]
  if (choice === 'restore') {
    server.restoreBackup(config, 'latest')
    return true
  }
  if (choice === 'folder') await shell.openPath(config.dataDir)
  return false
}

function createMenu() {
  const isMac = process.platform === 'darwin'
  const go = page => () => mainWindow?.webContents.send('atlas:navigate', page)
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        // Printing a report built from the data (the page decides which one); never a picture of the window.
        { label: 'Print…', accelerator: 'CmdOrCtrl+P', click: () => mainWindow?.webContents.send('atlas:print') },
        ...(isMac ? [] : [{ type: 'separator' }, { role: 'quit' }])
      ]
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(devToolsAllowed ? [{ type: 'separator' }, { role: 'toggleDevTools' }] : [])
      ]
    },
    {
      label: 'Go',
      submenu: [
        { label: 'Overview', accelerator: 'CmdOrCtrl+1', click: go('overview') },
        { label: 'Projects', accelerator: 'CmdOrCtrl+2', click: go('projects') },
        { label: 'My work', accelerator: 'CmdOrCtrl+3', click: go('tasks') },
        { label: 'People', accelerator: 'CmdOrCtrl+4', click: go('people') },
        { label: 'Reports', accelerator: 'CmdOrCtrl+Alt+R', click: go('reports') }
      ]
    },
    { role: 'windowMenu' }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function hardenSession() {
  // The window only needs its own page: it asks for no camera, microphone, location, notifications or device access.
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  session.defaultSession.setPermissionCheckHandler(() => false)
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1120,
    minHeight: 740,
    show: false,
    title: 'Atlas Workspace',
    backgroundColor: '#101827',
    icon: path.join(appRoot(), 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: devToolsAllowed,
      webviewTag: false,
      spellcheck: true
    }
  })
  mainWindow.once('ready-to-show', () => mainWindow.show())
  mainWindow.on('closed', () => {
    mainWindow = null
  })
  const contents = mainWindow.webContents
  // Links open in the system browser; the app window never navigates away from the local server.
  contents.setWindowOpenHandler(({ url }) => {
    if (sameOrigin(url, origin)) return { action: 'allow' }
    if (isSafeExternalUrl(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  const guard = (event, url) => {
    if (sameOrigin(url, origin)) return
    event.preventDefault()
    if (isSafeExternalUrl(url)) shell.openExternal(url)
  }
  contents.on('will-navigate', guard)
  contents.on('will-redirect', guard)
  return mainWindow.loadURL(origin)
}

// The setup token is only ever given to our own page.
ipcMain.handle('atlas:setup-token', event => (sameOrigin(event.senderFrame?.url || '', origin) ? setupToken : ''))

electronApp.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', event => event.preventDefault())
})

electronApp.whenReady().then(async () => {
  if (process.platform === 'win32') electronApp.setAppUserModelId('ai.arena.atlasworkspace')
  hardenSession()
  createMenu()
  try {
    await startAtlas()
    await createWindow()
  } catch (error) {
    dialog.showErrorBox('Atlas failed to start', String(error && error.message ? error.message : error))
    electronApp.quit()
  }
})

electronApp.on('window-all-closed', () => {
  if (process.platform !== 'darwin') electronApp.quit()
})

electronApp.on('activate', () => {
  if (running && BrowserWindow.getAllWindows().length === 0) void createWindow()
})

// Flush queued audit events and sessions and release the data-directory lock before exiting.
electronApp.on('before-quit', event => {
  if (quitting || !running) return
  event.preventDefault()
  quitting = true
  running
    .close()
    .catch(() => {})
    .finally(() => electronApp.quit())
})
