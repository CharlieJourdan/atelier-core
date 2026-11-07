// v2 is one app: no build flavours. Since lot P1 it has no external engine either: no engine module, no Studio
// screen, no <webview>, no `engine.*` IPC. Until our own engine exists (lots P2 to P7) the video
// producer's edit is held with a clear message instead of calling anything.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import config from '../../electron.vite.config'
import { PRODUCTION_HOLD } from '../../src/main/agents/runner'
import { FakeProvider } from '../../src/main/llm/fake'
import { PRODUCTION_PENDING_MESSAGE } from '../../src/main/production/pending'
import { API_METHODS } from '../../src/shared/api'
import { memoryCore } from './helpers'

const read = (rel: string): string => readFileSync(path.join(__dirname, '..', '..', rel), 'utf8')

describe('one app', () => {
  it('the build config defines no flavour for main, preload or renderer', () => {
    const cfg = config as unknown as Record<string, { define?: Record<string, string> } | undefined>
    // the beta: the only build-time value is the address of the Atelier Cloud a new install signs in to (configuration,
    // not a flavour: every build has the same features, and the person can change the address in Réglages)
    expect(Object.keys(cfg.main?.define ?? {})).toEqual(['__ATELIER_CLOUD_URL__'])
    for (const part of ['preload', 'renderer']) expect(cfg[part]?.define).toBeUndefined()
    expect(JSON.stringify(Object.keys(cfg).sort())).toBe(JSON.stringify(['main', 'preload', 'renderer']))
  })

  it('has no external engine: no engine.* method (its name is refused by scripts/cleanroom-check.mjs)', () => {
    const core = memoryCore()
    expect(API_METHODS.filter((m) => m.startsWith('engine.'))).toEqual([])
    expect(Object.keys(core.api).filter((m) => m.startsWith('engine.'))).toEqual([])
    core.close()
  })

  it('the window never enables <webview> and refuses any attach', () => {
    expect(read('src/main/electron/window.ts')).toContain('webviewTag: false')
    expect(read('src/main/electron/window.ts')).not.toMatch(/webviewTag: (true|opts)/)
    expect(read('src/main/electron/permissions.ts')).toContain("'will-attach-webview', (event) => event.preventDefault()")
    expect(read('src/main/index.ts')).toContain('refuseWebviews(mainWindow)')
  })
})

describe('the video producer until our engine exists', () => {
  it('holds the edit with one clear message and never calls a model for it; the owner can still upload it', async () => {
    const provider = new FakeProvider((req) => ({ text: `# Done\n\n${req.prompt.slice(0, 20)}` }))
    const core = memoryCore({ chatProvider: () => provider, retryDelayMs: 0 })
    const wf = core.context.workflow
    const ch = wf.channels.create({ name: 'C' })
    const v = wf.createVideo(ch.id, { title: 'T' }).video
    const d = (type: string) => wf.listDeliverables(v.id).find((x) => x.type === type)!
    const task = (type: string) => wf.listTasks({ videoId: v.id }).find((x) => x.deliverableId === d(type).id)!
    for (let i = 0; i < 10; i++) {
      core.runner.tick()
      await core.runner.idle()
      for (const x of wf.listDeliverables(v.id)) if (x.status === 'waiting_approval') wf.approve(x.id, { by: 'owner' })
      // the narration is a file: the owner uploads it (no engine voices it any more)
      if (d('narration').status === 'pending' && task('narration').status === 'ready') {
        wf.submitVersion(d('narration').id, { content: 'voice.mp3', author: 'owner', costUsd: 0 })
      }
    }
    expect(task('edit')).toMatchObject({ status: 'ready', holdReason: PRODUCTION_HOLD, attempts: 0 })
    expect(provider.calls.some((c) => c.prompt.includes('Make the Edit'))).toBe(false)
    const chat = core.chat
    const messages = chat.store.messages(chat.store.open({ kind: 'video', videoId: v.id }).id)
    const notes = messages.filter((m) => m.body.includes(PRODUCTION_PENDING_MESSAGE))
    expect(notes).toHaveLength(1) // said once, not at every tick
    // more ticks: still held, still one message
    core.runner.tick()
    await core.runner.idle()
    expect(chat.store.messages(chat.store.open({ kind: 'video', videoId: v.id }).id).filter((m) => m.body.includes(PRODUCTION_PENDING_MESSAGE))).toHaveLength(1)
    // "Try again" cannot help: refused with the same message, nothing posted again
    expect(() => core.runner.resume(task('edit').id)).toThrow(PRODUCTION_PENDING_MESSAGE)
    expect(task('edit').holdReason).toBe(PRODUCTION_HOLD)
    // the owner uploads the edit by hand: the hold is lifted with it
    wf.submitVersion(d('edit').id, { content: 'edit.mp4', author: 'owner', costUsd: 0 })
    expect(d('edit').status).not.toBe('pending')
    expect(task('edit').holdReason).toBeNull()
    expect(['waiting_approval', 'done']).toContain(task('edit').status)
    core.close()
  })
})
