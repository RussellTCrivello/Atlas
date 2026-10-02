export function getDesktopBridge() {
  return window.atlasDesktop || window.electronAPI || null
}

export function detectDisplayMode() {
  if (getDesktopBridge()) return 'electron'
  if (window.matchMedia?.('(display-mode: standalone)').matches) return 'standalone'
  if (window.opener && window.name === 'atlas-desktop') return 'desktop'
  return 'browser'
}
