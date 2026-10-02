// Real-browser end-to-end tests. They drive the BUILT application (`npm run build` first) exactly as a user's browser
// does: the production bundle in its own process, real HTTP, real cookies, the real Content-Security-Policy.
//
//   npm run build && npx playwright install chromium firefox webkit   # once
//   npm run test:e2e
//
// Where browsers cannot be downloaded (restricted networks, sandboxes) use `npm run test:e2e:restricted`, which supplies a
// Chromium that ships inside an npm package (see scripts/e2e-restricted.mjs and docs/DEVELOPMENT.md).
import { defineConfig, devices } from '@playwright/test'

const bundledChromium = process.env.ATLAS_E2E_CHROMIUM // set by scripts/e2e-restricted.mjs
const wanted = (process.env.ATLAS_E2E_BROWSERS || (bundledChromium ? 'chromium' : 'chromium,firefox,webkit')).split(',')

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.spec.ts',
  outputDir: 'tmp/e2e-results',
  // Every spec file starts its own server and data directory, so files can run side by side.
  fullyParallel: false,
  workers: process.env.CI ? 2 : 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never', outputFolder: 'tmp/e2e-report' }]] : 'list',
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // Deliberately NOT the "serverless" flag set shipped with the bundled Chromium: it disables web security, which would
    // hide exactly the CSP and cross-origin behaviour these tests exist to check.
    launchOptions: bundledChromium
      ? {
          executablePath: bundledChromium,
          args: ['--no-sandbox', '--disable-dev-shm-usage', '--force-color-profile=srgb', '--font-render-hinting=none']
        }
      : {}
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } }
  ].filter(project => wanted.includes(project.name))
})
