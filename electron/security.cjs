// Navigation rules for the desktop window, kept free of Electron imports so they can be unit-tested.

/** True when `url` is on exactly the origin of the local Atlas server (scheme + host + port, not a string prefix). */
function sameOrigin(url, origin) {
  try {
    return new URL(url).origin === origin
  } catch {
    return false
  }
}

/** Only web and mail links may be handed to the operating system. `file:`, `javascript:` and custom protocol handlers are refused. */
function isSafeExternalUrl(url) {
  try {
    const { protocol } = new URL(url)
    return protocol === 'https:' || protocol === 'http:' || protocol === 'mailto:'
  } catch {
    return false
  }
}

module.exports = { sameOrigin, isSafeExternalUrl }
