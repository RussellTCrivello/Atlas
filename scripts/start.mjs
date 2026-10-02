// Production launcher: `npm start`. Works on every OS (no POSIX-only `VAR=value cmd` syntax) and fails with a clear
// message when the project has not been built yet.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const bundle = path.join(root, 'dist-desktop', 'app.mjs')
const web = path.join(root, 'dist', 'index.html')
if (!fs.existsSync(bundle) || !fs.existsSync(web)) {
  console.error('Atlas has not been built yet. Run "npm run build" first (or "npm run preview" to build and start).')
  process.exit(1)
}
process.env.NODE_ENV = 'production'
const { main } = await import(pathToFileURL(bundle).href)
await main()
