// Regenerates every raster icon from the single source of truth, public/atlas-icon.svg:
//   public/icons/icon-192.png, icon-512.png, icon-maskable-512.png   (PWA manifest)
//   build/icon.png (1024 px), build/icon.ico (16-256 px)             (electron-builder: Windows, macOS, Linux)
//
// The SVG rasteriser is deliberately not a project dependency (this runs once per logo change). Install it ad hoc:
//   npm install --no-save @resvg/resvg-js
//   node scripts/make-icons.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
let Resvg
try {
  ;({ Resvg } = await import('@resvg/resvg-js'))
} catch {
  console.error('Missing the SVG rasteriser. Run: npm install --no-save @resvg/resvg-js')
  process.exit(1)
}

const svg = fs.readFileSync(path.join(root, 'public', 'atlas-icon.svg'), 'utf8')
const render = (source, size) =>
  new Resvg(source, { fitTo: { mode: 'width', value: size }, background: 'rgba(0,0,0,0)' }).render().asPng()

// Maskable icons are cropped by the operating system to a circle or squircle: the artwork must sit inside the central 80%
// "safe zone" of a full-bleed square. The artwork is ~64% of the canvas, so it fits at full scale on a square background.
const artwork = svg.replace(/<rect[^>]*\/>/, '').replace(/<\/?svg[^>]*>/g, '')
const maskable = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><rect width="128" height="128" fill="#101827"/>${artwork}</svg>`

/** ICO container with PNG-compressed images (supported since Windows Vista). */
function ico(sizes) {
  const images = sizes.map(size => ({ size, data: render(svg, size) }))
  const header = Buffer.alloc(6)
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(images.length, 4)
  let offset = 6 + images.length * 16
  const entries = images.map(({ size, data }) => {
    const entry = Buffer.alloc(16)
    entry.writeUInt8(size >= 256 ? 0 : size, 0)
    entry.writeUInt8(size >= 256 ? 0 : size, 1)
    entry.writeUInt16LE(1, 4) // colour planes
    entry.writeUInt16LE(32, 6) // bits per pixel
    entry.writeUInt32LE(data.length, 8)
    entry.writeUInt32LE(offset, 12)
    offset += data.length
    return entry
  })
  return Buffer.concat([header, ...entries, ...images.map(image => image.data)])
}

const write = (relative, data) => {
  const file = path.join(root, relative)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, data)
  console.log(`wrote ${relative} (${data.length} bytes)`)
}
write('public/icons/icon-192.png', render(svg, 192))
write('public/icons/icon-512.png', render(svg, 512))
write('public/icons/icon-maskable-512.png', render(maskable, 512))
write('build/icon.png', render(svg, 1024))
write('build/icon.ico', ico([16, 24, 32, 48, 64, 128, 256]))
