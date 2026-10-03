// Operations launcher behind `npm run backup:data | restore:data | check:data | admin:reset-password | ...`.
// Runs the TypeScript sources through tsx when it is installed (development) and the built bundle otherwise
// (production installs without devDependencies), so these commands work in both.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tsx = path.join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs')
const bundle = path.join(root, 'dist-desktop', 'app.mjs')
const args = process.argv.slice(2)
let command
if (fs.existsSync(tsx)) command = [process.execPath, tsx, path.join(root, 'app.tsx'), ...args]
else if (fs.existsSync(bundle)) command = [process.execPath, bundle, ...args]
else {
  console.error('Neither tsx (npm install) nor the built bundle (npm run build) is available.')
  process.exit(1)
}
const result = spawnSync(command[0], command.slice(1), { stdio: 'inherit', cwd: process.cwd(), env: process.env })
process.exit(result.status ?? 1)
