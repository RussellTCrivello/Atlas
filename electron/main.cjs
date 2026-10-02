const { app: electronApp, BrowserWindow, shell, dialog, Menu } = require('electron')
const path = require('node:path')
const net = require('node:net')
const http = require('node:http')
const { pathToFileURL } = require('node:url')

let mainWindow
let atlasPort
let serverStarted = false

function appRoot() {
  return electronApp.isPackaged ? electronApp.getAppPath() : path.join(__dirname, '..')
}

function findOpenPort(start = 5173) {
  return new Promise(resolve => {
    const server = net.createServer()
    server.unref()
    server.on('error', () => resolve(findOpenPort(start + 1)))
    server.listen(start, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
  })
}

function waitForServer(port, timeout = 15000) {
  const startedAt = Date.now()
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const request = http.get(`http://127.0.0.1:${port}/api/setup/status`, response => {
        response.resume()
        if (response.statusCode && response.statusCode < 500) resolve()
        else retry()
      })
      request.on('error', retry)
      request.setTimeout(900, () => { request.destroy(); retry() })
    }
    const retry = () => {
      if (Date.now() - startedAt > timeout) reject(new Error('Atlas local application did not start in time.'))
      else setTimeout(attempt, 250)
    }
    attempt()
  })
}

async function startAtlasServer() {
  if (serverStarted) return atlasPort
  atlasPort = await findOpenPort(Number(process.env.PORT || 5173))
  const root = appRoot()
  process.env.NODE_ENV = 'production'
  process.env.PORT = String(atlasPort)
  process.env.ATLAS_ROOT = root
  process.env.ATLAS_STATIC_DIR = path.join(root, 'dist')
  process.env.ATLAS_DATA_DIR = path.join(electronApp.getPath('userData'), 'data')
  await import(pathToFileURL(path.join(root, 'dist-desktop', 'app.mjs')).href)
  await waitForServer(atlasPort)
  serverStarted = true
  return atlasPort
}

function createMenu() {
  const template = [
    { label: 'Atlas', submenu: [
      { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: () => mainWindow?.reload() },
      { label: 'Open DevTools', accelerator: 'CmdOrCtrl+Shift+I', click: () => mainWindow?.webContents.openDevTools({ mode: 'detach' }) },
      { type: 'separator' },
      { label: 'Quit', role: 'quit' }
    ]},
    { label: 'Reports', submenu: [
      { label: 'Open Reports', accelerator: 'CmdOrCtrl+Alt+R', click: () => mainWindow?.webContents.executeJavaScript("window.dispatchEvent(new CustomEvent('atlas:navigate',{detail:'reports'}))") },
      { label: 'Print', accelerator: 'CmdOrCtrl+P', click: () => mainWindow?.webContents.print() }
    ]}
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

async function createWindow() {
  const port = await startAtlasServer()
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1120,
    minHeight: 740,
    show: false,
    title: 'Atlas Workspace',
    backgroundColor: '#101827',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })
  mainWindow.once('ready-to-show', () => mainWindow.show())
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(`http://127.0.0.1:${port}`)) return { action: 'allow' }
    shell.openExternal(url)
    return { action: 'deny' }
  })
  await mainWindow.loadURL(`http://127.0.0.1:${port}`)
}

electronApp.whenReady().then(async () => {
  createMenu()
  try { await createWindow() }
  catch (error) { dialog.showErrorBox('Atlas failed to start', error.message); electronApp.quit() }
})

electronApp.on('window-all-closed', () => {
  if (process.platform !== 'darwin') electronApp.quit()
})

electronApp.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
