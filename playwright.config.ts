import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  workers: 1,
  // scripts/mac-verify.sh asks for a JSON report next to its logs, to list the failures in the Mac report
  reporter: process.env.ATELIER_E2E_JSON ? [['list'], ['json', { outputFile: process.env.ATELIER_E2E_JSON }]] : [['list']],
  use: { trace: 'retain-on-failure' }
})
