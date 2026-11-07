import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

// Files that launch Chromium, ffmpeg or a brain/child process for real. In a full run on a busy PC they starve each
// other (and everything else) and hit load timeouts although every assertion passes alone. They run as their own
// project, AFTER the light one, with a few workers only (groupOrder = the two projects never overlap).
const HEAVY = [
  'tests/unit/sfx.test.ts',
  'tests/unit/headless-rotate.test.ts',
  'tests/unit/brick-sandbox.test.ts',
  'tests/unit/engine-avatar-film.test.ts',
  'tests/unit/map-card.test.ts',
  'tests/unit/map3d-browser.test.ts',
  'tests/unit/visuals-distinct.test.ts',
  'tests/unit/visuals-stock.test.ts',
  'tests/unit/relay-brain.test.ts',
  'tests/unit/doc-cards.test.ts',
  'tests/unit/doc-cards-parchment.test.ts',
  'tests/unit/motion-browser.test.ts',
  'tests/unit/motion-browser-service.test.ts',
  'tests/unit/team-pc-cloud-backup.test.ts',
  'tests/unit/real-runs.test.ts',
  'tests/unit/quote-capture.test.ts',
  'tests/unit/recipes-api.test.ts',
  'tests/unit/demo-items.test.ts',
  'tests/unit/presenter-talk.test.ts',
  'tests/unit/engine-reddit-short.test.ts',
  'tests/unit/render-video-layer.test.ts',
  'tests/unit/engine-faceless-media.test.ts',
  'tests/unit/engine-p4-render.test.ts',
  'tests/unit/presenter-face.test.ts',
  'tests/unit/render-motion-overlay.test.ts',
  'tests/unit/motion-kit-templates.test.ts',
  'tests/unit/motion-kit-edit.test.ts',
  'tests/unit/local-worker.test.ts',
  'tests/unit/team-pc-keeper.test.ts',
  'tests/unit/channel-presenters.test.ts',
  'tests/unit/clip-make.test.ts',
  'tests/unit/voice-trim-engines.test.ts',
  'tests/unit/headless-boot.test.ts',
  'tests/unit/ingredients.test.ts',
  'tests/unit/style-agent.test.ts',
  'tests/unit/headless-cli.test.ts',
  'tests/unit/p5-executors.test.ts',
  'tests/unit/p5-resume.test.ts',
  'cloud/tests/cloud-job-concurrency.test.ts'
]

const shared = {
  setupFiles: [resolve(__dirname, 'tests/setup/temp-root.ts')],
  environment: 'node' as const,
  restoreMocks: true,
  // the 5 s default is a promise about a quiet PC; a busy one (other sessions, 80+ node processes) needs margin
  testTimeout: 30_000,
  hookTimeout: 60_000
}
const alias = { '@': resolve(__dirname, 'src/renderer') }

export default defineConfig({
  test: {
    // scripts/mac-verify.sh asks for a JSON report next to its logs, to list the failures in the Mac report
    ...(process.env.ATELIER_VITEST_JSON ? { reporters: ['default', 'json'], outputFile: { json: process.env.ATELIER_VITEST_JSON } } : {}),
    projects: [
      {
        resolve: { alias },
        test: {
          ...shared,
          name: 'unit',
          include: ['tests/unit/**/*.test.{ts,tsx}', 'cloud/tests/**/*.test.ts'],
          exclude: ['**/node_modules/**', ...HEAVY],
          maxWorkers: 8,
          sequence: { groupOrder: 1 }
        }
      },
      {
        resolve: { alias },
        test: {
          ...shared,
          name: 'heavy',
          include: HEAVY,
          maxWorkers: 4,
          testTimeout: 120_000,
          hookTimeout: 120_000,
          sequence: { groupOrder: 2 }
        }
      }
    ]
  }
})
