// The Unicode font the PDF embeds (Latin, Arabic, Persian, Hebrew), read once from the web build or the source tree.
import fs from 'node:fs'
import path from 'node:path'

let cached: { regular: Uint8Array; bold: Uint8Array } | null | undefined

export function loadFonts(directories: string[]): { regular: Uint8Array; bold: Uint8Array } | null {
  if (cached !== undefined) return cached
  for (const dir of directories) {
    try {
      const regular = fs.readFileSync(path.join(dir, 'AtlasSans-Regular.ttf'))
      const bold = fs.readFileSync(path.join(dir, 'AtlasSans-Bold.ttf'))
      cached = { regular, bold }
      return cached
    } catch {
      /* try the next place */
    }
  }
  return null // not cached: the next export tries again (a late build, a repaired install)
}

export const resetFontCache = () => {
  cached = undefined
}
