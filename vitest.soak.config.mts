// `npm run pipelines:soak` (solidite): every base pipeline, many times, with random faults, on stand-in engines (free, no
// network). Not part of `npm test` (minutes long); SOAK_N runs per pipeline (default 2), SOAK_SEED to replay a sequence.
import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { alias: { '@': resolve(import.meta.dirname, 'src/renderer') } },
  test: {
    include: ['tests/soak/*.soak.ts'],
    environment: 'node',
    testTimeout: 3_600_000,
    hookTimeout: 120_000,
    fileParallelism: false
  }
})
