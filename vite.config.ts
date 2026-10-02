import { readFileSync } from 'node:fs'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

// Each build gets an id. The service worker is registered as /sw.js?v=<id>, so a new build gets a new cache and the old
// one is deleted on activation (no stale-asset risk after upgrades).
const build = `${pkg.version}-${Date.now().toString(36)}`

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  define: { __ATLAS_BUILD__: JSON.stringify(build), __ATLAS_DEV__: JSON.stringify(mode === 'development') },
  build: { sourcemap: false, chunkSizeWarningLimit: 700 }
}))
