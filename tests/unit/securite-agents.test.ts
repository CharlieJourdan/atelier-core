// securite-agents (decision 0076), the app's side: what an agent or a person can write through the generic settings, and the
// links handed to yt-dlp. Money itself is the Cloud's (cloud/tests/cloud-security-agents.test.ts).
import { describe, expect, it } from 'vitest'
import { handleCall } from '../../src/main/ipc'
import { MAX_SETTING_BYTES } from '../../src/main/api/settings'
import { excerptArgs, probeArgs, probeVideo } from '../../src/engine/sourcing/providers/ytdlp'
import { memoryCore } from './helpers'
import { TECHNOLOGY_IDS } from '../../src/main/orchestra/technologies'
import { PRODUCTION_TOOLS } from '../../src/main/agents/tools-production'

describe('settings.set', () => {
  it('refuses the caches the main process writes from the Cloud, oversized values and malformed names', async () => {
    const { api } = memoryCore()
    for (const key of ['engines.cache', 'blueprint.cache', 'blueprint.applied']) {
      expect(await handleCall(api, 'settings.set', [key, { engines: [] }])).toMatchObject({ ok: false, error: { message: expect.stringMatching(/n’a pas pu aboutir/), detail: expect.stringMatching(/cannot be changed/) } })
    }
    expect(await handleCall(api, 'settings.set', ['ui.note', 'x'.repeat(MAX_SETTING_BYTES + 1)])).toMatchObject({ ok: false, error: { message: expect.stringMatching(/n’a pas pu aboutir/), detail: expect.stringMatching(/too large/) } })
    expect(await handleCall(api, 'settings.set', ['../db', 1])).toMatchObject({ ok: false })
    expect(await handleCall(api, 'settings.set', ['ui.lastView', 'board'])).toMatchObject({ ok: true })
  })
})

describe('yt-dlp links', () => {
  it('always come after `--`, so a « link » that looks like an option is never read as one', async () => {
    const evil = '--exec=calc.exe'
    for (const args of [probeArgs(evil), excerptArgs(evil, { startS: 0, endS: 5 }, 'out')]) {
      expect(args.at(-1)).toBe(evil)
      expect(args.at(-2)).toBe('--')
    }
    const ran: string[][] = []
    const run = (_cmd: string, args: string[]) => {
      ran.push(args)
      return Promise.resolve({ stdout: '{}', stderr: '' })
    }
    await expect(probeVideo(evil, { run })).rejects.toThrow(/http/)
    expect(ran).toEqual([])
  })
})

describe('an agent fooled by a prompt injection (a recipe, a channel page, a transcript)', () => {
  it('has no tool that reaches prices, credits, keys, settings or code: its worst case is a proposal the owner refuses', () => {
    const tools = [...TECHNOLOGY_IDS, ...PRODUCTION_TOOLS]
    expect(tools.length).toBeGreaterThan(30)
    for (const name of tools) expect(name, name).not.toMatch(/price|credit|wallet|billing|grant|secret|key|token|setting|cap|eval|shell|exec|script\.run|code/i)
  })
})
