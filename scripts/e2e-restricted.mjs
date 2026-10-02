// Runs the Playwright suite with a Chromium that ships inside an npm package, for machines that can reach the npm registry
// but not the browser download servers (restricted networks, CI sandboxes, this repository's own build environment).
//
//   npm install --no-save @sparticuz/chromium      # ~70 MB, not a dependency of the project
//   npm run build && npm run test:e2e:restricted -- [playwright args]
//
// The package is built for AWS Lambda; it unpacks its own copies of the system libraries Chromium needs when it believes it
// is running there, hence the environment variable. Its default argument list is NOT used (it disables web security).
// Only Chromium is available this way: Firefox and WebKit need the normal `npx playwright install`.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const from = process.env.ATLAS_E2E_CHROMIUM_FROM || root // a directory whose node_modules holds @sparticuz/chromium
const entry = path.join(from, 'node_modules', '@sparticuz', 'chromium', 'build', 'index.js')
if (!fs.existsSync(entry)) {
  console.error(
    `@sparticuz/chromium is not installed under ${from}.\nRun: npm install --no-save @sparticuz/chromium\n(or set ATLAS_E2E_CHROMIUM_FROM to a directory that has it)`
  )
  process.exit(2)
}
if (!fs.existsSync(path.join(root, 'dist-desktop', 'app.mjs'))) {
  console.error('The application is not built. Run: npm run build')
  process.exit(2)
}
process.env.AWS_EXECUTION_ENV ||= 'AWS_Lambda_nodejs22.x'
const { default: chromium } = await import(pathToFileURL(entry).href)
const executable = await chromium.executablePath()
const env = {
  ...process.env, // includes LD_LIBRARY_PATH / FONTCONFIG_PATH / HOME set by the package for the libraries it unpacked
  ATLAS_E2E_CHROMIUM: executable,
  ATLAS_E2E_BROWSERS: 'chromium'
}
const playwright = path.join(
  root,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'playwright.cmd' : 'playwright'
)
const child = spawn(playwright, ['test', ...process.argv.slice(2)], { cwd: root, env, stdio: 'inherit' })
child.on('exit', code => process.exit(code ?? 1))
