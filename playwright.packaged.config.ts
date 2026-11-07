import { defineConfig } from '@playwright/test'

// Smoke tests of the installed apps (npm run test:packaged). Not part of `npm test` or `npm run test:e2e`.
export default defineConfig({
  testDir: 'tests/packaged',
  timeout: 90_000,
  workers: 1,
  // scripts/mac-verify.sh asks for a JSON report next to its logs, to list the failures in the Mac report
  reporter: process.env.ATELIER_E2E_JSON ? [['list'], ['json', { outputFile: process.env.ATELIER_E2E_JSON }]] : [['list']]
})
