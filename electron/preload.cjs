const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('atlasDesktop', {
  platform: process.platform,
  versions: process.versions,
  isDesktop: true
})
