// `npx vitest run -c vitest.vps.config.mts` (vps-rendu): the simulated team VPS. Every base pipeline launched for real on
// stand-in engines (free, no network) inside the box it runs in, measured step by step (wall time, peak memory of the whole
// box). Meant to run inside `docker run --cpus 4 --memory 8g` (scripts/vps-sim.mjs); not part of `npm test` (minutes long).
import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { alias: { '@': resolve(import.meta.dirname, 'src/renderer') } },
  test: {
    include: ['tests/vps/*.vps.ts'],
    environment: 'node',
    testTimeout: 3_600_000,
    hookTimeout: 120_000,
    fileParallelism: false
  }
})
