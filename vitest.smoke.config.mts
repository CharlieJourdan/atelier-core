// Real-world smoke scripts (scripts/smoke-*.ts). Not part of `npm test`: they call the real Claude Code CLI.
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['scripts/smoke-*.ts'],
    environment: 'node',
    testTimeout: 600_000,
    hookTimeout: 60_000,
    fileParallelism: false
  }
})
