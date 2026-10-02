// The renderer is untrusted web content: expose the smallest possible surface.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('atlasDesktop', {
  isDesktop: true,
  platform: process.platform,
  // First-run setup token, so the person installing the app is not asked to find it in a console.
  getSetupToken: () => ipcRenderer.invoke('atlas:setup-token')
})

// Menu items ask the page to navigate; the page decides what to do with it.
ipcRenderer.on('atlas:navigate', (_event, page) => {
  if (typeof page === 'string') window.dispatchEvent(new CustomEvent('atlas:navigate', { detail: page }))
})
