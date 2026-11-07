// Atlas orchestrates, with the fake LLM only (FakeProvider playing each agent, its tools run for real):
//   1. « Traduis ma chaîne Histoire en anglais » → Atlas asks a confirmation in the inbox → on approval it creates the channel
//      through the same `channels.create` the screens use (its team and channel memory come with it) → the new lead hands the
//      work out: the analyst looks at a sample video with eyes.look, the scriptwriter translates the script, then the
//      supervisor starts a production run (our engine, test nodes) that stops at its first gate. Every step is a durable
//      task with its parent; nothing is done twice, across a restart and across a crash after a tool ran.
//   2. « Ajoute une chaîne sur les énigmes historiques » → Atlas asks the onboarding questions through the inbox, Charlie
//      answers, Atlas confirms, creates the channel with its memory and gets the first topics from its researcher.
import { trackTemp } from '../setup/track-temp'
import { mkdirSync, mkdtempSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { createCore, type Core } from '../../src/main/core'
import { FakeProvider, type FakeReply } from '../../src/main/llm/fake'
import type { CompletionRequest, Provider } from '../../src/main/llm/types'
import { readPrompt } from '../../src/main/orchestra/fake-team'
import { MEDIA, hasFfmpeg } from './engine-node-helpers'
import { okTester, testCipher } from './helpers'
import { T0 } from './orchestra-helpers'
import { fixture, waitFor } from './z1-runs-fixtures'

const block = (actions: unknown[]): string => `\n\n\`\`\`atelier\n${JSON.stringify({ actions })}\n\`\`\``
const FR_SCRIPT = 'Le 5 décembre 1945, cinq avions décollent de Floride.\n\nAucun ne reviendra jamais.'
const EN_SCRIPT = 'On the fifth of December, nineteen forty-five, five planes took off from Florida.\n\nNone of them ever came back.'

/** Charlie's answers the task carries (the lines under « Charlie answered your question »). */
function answers(prompt: string): string[] {
  const at = prompt.indexOf('Charlie answered your question:')
  if (at < 0) return []
  return prompt
    .slice(at)
    .split('\n')
    .slice(1)
    .filter((l, i, all) => l.startsWith('- ') && all.slice(0, i).every((x) => x.startsWith('- ')))
}

interface World {
  core: () => Core
  clip: string
}

/** The team, scripted: what each agent answers and which tools it calls. */
function team(w: World) {
  const channelId = (name: string): number => {
    const db = w.core().db
    const row = db.prepare('SELECT id FROM channels WHERE name = ?').get(name) as { id: number } | undefined
    return row?.id ?? ((db.prepare('SELECT COALESCE(MAX(id), 0) AS m FROM channels').get() as { m: number }).m + 1)
  }
  return (req: CompletionRequest): FakeReply | string => {
    const s = readPrompt(req.system ?? '', req.prompt)
    const said = answers(req.prompt)
    // a new channel's goals analysis (agents-2): the lead refines the baseline once
    if (s.role === 'channel_lead' && s.kind === 'goals') {
      return { toolCalls: [{ name: 'goals_propose', args: { budgetCredits: 9000, reasons: 'Deux vidéos par semaine comme les concurrents.' } }], text: 'Proposé.' + block([{ type: 'done', result: 'Objectifs proposés.' }]) }
    }
    if (s.role === 'principal') {
      if (req.prompt.includes('Traduis ma chaîne')) {
        if (said.length === 0) {
          return 'Je peux créer la version anglaise.' + block([{ type: 'ask_human', kind: 'validate', question: 'Créer la chaîne « Histoire (EN) », traduction anglaise de Histoire ?', options: ['Valider', 'Annuler'] }])
        }
        if (s.children.length === 0) {
          const id = channelId('Histoire (EN)')
          return {
            toolCalls: [{ name: 'channel_create', args: { name: 'Histoire (EN)', language: 'en', translateFrom: 1, audience: 'English-speaking history fans' } }],
            text: 'Chaîne créée.' + block([{ type: 'delegate', to: `lead-${id}`, kind: 'plan', title: 'Lancer la chaîne traduite', brief: 'Analyse une vidéo exemple, traduis le script du vol 19, lance une vidéo test' }])
          }
        }
        return 'La chaîne anglaise tourne.' + block([{ type: 'done', result: `Histoire (EN) lancée : ${s.children.join(' / ')}` }])
      }
      if (req.prompt.includes('énigmes historiques')) {
        if (said.length === 0) {
          return 'Quelques questions avant de créer la chaîne.' + block([{ type: 'ask_human', kind: 'input', question: 'Quel nom, quelle langue, quel public, combien de vidéos par semaine ?' }])
        }
        if (said.length === 1) {
          return 'Je résume avant de créer.' + block([{ type: 'ask_human', kind: 'validate', question: 'Je crée « Énigmes de l’Histoire » (fr, passionnés 25-45 ans, 2 vidéos par semaine) ?', options: ['Valider', 'Modifier'] }])
        }
        if (s.children.length === 0) {
          const id = channelId('Énigmes de l’Histoire')
          return {
            toolCalls: [
              { name: 'channel_create', args: { name: 'Énigmes de l’Histoire', niche: 'énigmes historiques', language: 'fr', audience: 'passionnés d’histoire de 25 à 45 ans', notes: 'Rythme : 2 vidéos par semaine.' } },
              { name: 'memory_workspace', args: { text: 'Charlie lance une chaîne d’énigmes historiques, 2 vidéos par semaine.' } }
            ],
            text: 'Chaîne créée.' + block([{ type: 'delegate', to: `lead-${id}`, kind: 'topics', title: 'Premiers sujets', brief: '3 énigmes pour commencer' }])
          }
        }
        return 'Prêt.' + block([{ type: 'done', result: `Énigmes de l’Histoire prête : ${s.children.join(' / ')}` }])
      }
    }
    if (s.role === 'channel_lead' && s.channel?.startsWith('Histoire (EN')) {
      const id = channelId('Histoire (EN)')
      if (s.children.length === 0) {
        return (
          'Je répartis.' +
          block([
            { type: 'delegate', to: `competitor-analyst-${id}`, kind: 'look', title: 'Regarder la vidéo exemple', brief: w.clip },
            { type: 'delegate', to: `scriptwriter-${id}`, kind: 'script', title: 'Traduire le script du vol 19', brief: 'channel-1/scripts/le-vol-19.md' }
          ])
        )
      }
      if (s.children.length === 2) {
        return 'Script prêt, on lance la vidéo test.' + block([{ type: 'delegate', to: `production-supervisor-${id}`, kind: 'production', title: 'Vidéo test Flight 19', brief: `channel-${id}/scripts/flight-19.md` }])
      }
      return 'Tout est lancé.' + block([{ type: 'done', result: 'Analyse, script traduit, vidéo test à sa première validation.' }])
    }
    if (s.role === 'competitor_analyst') {
      return { toolCalls: [{ name: 'eyes_look', args: { file: w.clip, frames: 4 } }], text: 'Vu.' + block([{ type: 'done', result: 'Deux plans fixes et une coupe franche.' }]) }
    }
    if (s.role === 'scriptwriter') {
      return {
        toolCalls: [
          { name: 'script_brief', args: { teamFile: 'channel-1/scripts/le-vol-19.md', language: 'en' } },
          { name: 'script_save', args: { title: 'Flight 19', text: EN_SCRIPT, language: 'en' } }
        ],
        text: 'Translated.' + block([{ type: 'done', result: 'Script traduit et enregistré.' }])
      }
    }
    if (s.role === 'production_supervisor') {
      return {
        toolCalls: [{ name: 'production_start', args: { title: 'Flight 19 (EN)', topic: 'The disappearance of Flight 19', minutes: 1, scriptFile: s.brief } }],
        text: 'Run started.' + block([{ type: 'done', result: 'Vidéo test lancée, elle attend la validation du script.' }])
      }
    }
    if (s.role === 'channel_lead') {
      if (s.children.length === 0) return 'Je lance la recherche.' + block([{ type: 'delegate', role: 'researcher', kind: 'research', title: 'Trois premières énigmes' }])
      return 'Sujets prêts.' + block([{ type: 'done', result: s.children.join(' / ') }])
    }
    if (s.role === 'researcher') {
      return { toolCalls: [{ name: 'ideas_list', args: {} }], text: 'Trois sujets.' + block([{ type: 'done', result: 'Le masque de fer ; la colonie perdue de Roanoke ; le manuscrit de Voynich' }]) }
    }
    return 'ok' + block([{ type: 'done', result: 'ok' }])
  }
}

interface Scene {
  dir: string
  core: Core
  provider: Provider
  clock: { t: number }
  reopen: (provider?: Provider) => Core
  drain: () => Promise<void>
}

const fx = fixture()
afterAll(() => fx.cleanup())

function scene(makeProvider: (w: World) => Provider): Scene {
  const dir = trackTemp(mkdtempSync(path.join(tmpdir(), 'atelier-atlas-')))
  const clip = path.join(dir, 'sample.mp4')
  const clock = { t: T0 }
  let current: Core
  const world: World = { core: () => current, clip }
  const provider = makeProvider(world)
  const open = (p: Provider): Core =>
    createCore({
      paths: { userData: dir },
      cipher: testCipher(),
      tester: okTester,
      now: () => new Date(clock.t),
      productionRuns: { ...fx.productionRuns, dataDir: path.join(dir, 'production') },
      orchestra: { cronUtc: true, dataDir: path.join(dir, 'orchestra'), providers: () => p, terminal: { open: async () => false }, ...(MEDIA ? { services: { media: () => MEDIA } } : {}) }
    })
  current = open(provider)
  const s: Scene = {
    dir,
    core: current,
    provider,
    clock,
    reopen: (p = provider) => {
      current.close()
      current = open(p)
      s.core = current
      return current
    },
    drain: async () => {
      for (let i = 0; i < 40; i++) {
        const r = await current.orchestra.tick({ wait: true })
        if (r.started === 0 && r.bumped === 0 && current.orchestra.parts.queue.runnable(1).length === 0) break
      }
    }
  }
  const add = current.db.prepare("INSERT INTO channels (name, niche, standards) VALUES (?, ?, '')")
  add.run('Histoire', 'histoire')
  add.run('Mystères', 'mystères')
  current.orchestra.seed()
  const src = path.join(dir, 'orchestra', 'files', 'channel-1', 'scripts')
  mkdirSync(src, { recursive: true })
  writeFileSync(path.join(src, 'le-vol-19.md'), FR_SCRIPT)
  return s
}

async function makeClip(file: string): Promise<void> {
  await MEDIA!.run(
    'ffmpeg',
    ['-y', '-f', 'lavfi', '-i', 'color=c=red:s=320x240:d=1.5:r=25', '-f', 'lavfi', '-i', 'color=c=blue:s=320x240:d=1.5:r=25', '-filter_complex', '[0][1]concat=n=2:v=1:a=0', '-pix_fmt', 'yuv420p', file],
    { signal: new AbortController().signal }
  )
}

const principalOf = (core: Core) => core.orchestra.parts.tree.bySlug('principal')!

describe.skipIf(!hasFfmpeg)('Atlas: « Traduis ma chaîne Histoire en anglais »', () => {
  it('asks first, then creates the channel and its team, which looks, translates and starts a run stopped at its first gate', async () => {
    const s = scene((w) => new FakeProvider(team(w)))
    await makeClip(path.join(s.dir, 'sample.mp4'))
    const o = () => s.core.orchestra
    o().say({ agentId: principalOf(s.core).id, text: 'Traduis ma chaîne Histoire en anglais' })
    await s.drain()
    // 1. a confirmation in the inbox, nothing created yet
    const ask = o().inbox()
    expect(ask).toHaveLength(1)
    expect(ask[0]).toMatchObject({ kind: 'validate', options: ['Valider', 'Annuler'] })
    expect(ask[0]!.body).toContain('Histoire (EN)')
    expect(s.core.db.prepare("SELECT COUNT(*) AS n FROM channels WHERE name = 'Histoire (EN)'").get()).toEqual({ n: 0 })
    o().answer(ask[0]!.id, { choice: 'Valider' })
    await s.drain()
    // 2. the channel exists once, made like the screens make it, with its memory and its team
    const channels = s.core.db.prepare("SELECT id, name FROM channels WHERE name = 'Histoire (EN)'").all() as { id: number }[]
    expect(channels).toHaveLength(1)
    const en = channels[0]!.id
    const memory = o().contextBlock('channel', en).text
    expect(memory).toContain('Chaîne : Histoire (EN)')
    expect(memory).toContain('Langue : en')
    expect(memory).toContain('Traduit la chaîne : Histoire (#1)')
    expect(memory).toContain('Public : English-speaking history fans')
    const enTeam = o().agents().filter((a) => a.channelId === en).map((a) => a.slug)
    expect(enTeam).toEqual(expect.arrayContaining([`lead-${en}`, `competitor-analyst-${en}`, `scriptwriter-${en}`, `production-supervisor-${en}`]))
    // 3. the analyst looked with eyes.look: frames on disk under the workspace
    const frames = path.join(s.dir, 'orchestra', 'eyes')
    const look = o().tasks({ kind: 'look' })[0]!
    expect(look.status).toBe('done')
    const eyesRes = (s.provider as FakeProvider).toolResults.find((r) => r.name === 'eyes_look')!
    expect(eyesRes.isError).toBe(false)
    const shots = [...eyesRes.text.matchAll(/: (\S+\.jpg)$/gm)].map((m) => m[1]!)
    expect(shots).toHaveLength(4)
    for (const f of shots) expect(existsSync(f) && f.startsWith(frames)).toBe(true)
    // 4. the scriptwriter translated the French script and saved it as a team file
    const brief = (s.provider as FakeProvider).toolResults.find((r) => r.name === 'script_brief')!
    expect(brief.text).toContain(FR_SCRIPT.split('\n')[0])
    expect(brief.text).toContain('Write in: en')
    const scriptFile = path.join(s.dir, 'orchestra', 'files', `channel-${en}`, 'scripts', 'flight-19.md')
    expect(readFileSync(scriptFile, 'utf8')).toBe(EN_SCRIPT)
    // 5. the supervisor started ONE run of the new channel; it stops at its first gate
    const runs = s.core.context.productionRuns.list({ channelId: en })
    expect(runs).toHaveLength(1)
    const waiting = await waitFor(() => {
      const r = s.core.context.productionRuns.get(runs[0]!.id)
      return r.status === 'waiting' ? r : null
    }, 10_000, 'the run at its first gate')
    expect(waiting.waitingNodes).toEqual(['script'])
    expect(waiting.channelId).toBe(en)
    // 6. durable tasks with their parents, all done, none twice
    const all = o().tasks({ limit: 500 })
    const root = all.find((t) => t.kind === 'mention' && t.assigneeId === principalOf(s.core).id)!
    expect(root.status).toBe('done')
    expect(root.result).toMatch(/^Histoire \(EN\) lancée/)
    const leadTask = all.find((t) => t.parentId === root.id)!
    expect(leadTask).toMatchObject({ kind: 'plan', status: 'done', assigneeId: o().parts.tree.bySlug(`lead-${en}`)!.id })
    const kids = all.filter((t) => t.parentId === leadTask.id)
    expect(kids.map((t) => t.kind).sort()).toEqual(['look', 'production', 'script'])
    expect(kids.every((t) => t.status === 'done')).toBe(true)
    const keys = all.map((t) => `${t.assigneeId}|${t.title}`)
    expect(new Set(keys).size).toBe(keys.length)
    // Atlas's inbox item was answered; the principal said so in the Supervisor chat
    expect(o().inbox(true).find((i) => i.taskId === root.id)!.status).toBe('answered')
    // the new channel's goals were proposed (agents-2), refined by its lead, and wait for Charlie's confirmation
    expect(o().inbox(true).find((i) => i.title.startsWith('Objectifs proposés'))!.status).toBe('open')
    expect(o().parts.goals.get(en)).toMatchObject({ status: 'proposed', source: 'agent', budgetCredits: 9000, trigger: 'create' })
    s.core.close()
  }, 60_000)

  it('survives a restart in the middle and a crash after a tool ran: one channel, one run', async () => {
    let crashed = false
    const s = scene((w) => {
      const inner = new FakeProvider(team(w))
      // The principal's second turn: its tools run (the channel is created), then the CLI dies before answering.
      const wrapper: Provider = {
        id: 'crashy',
        acceptsTools: () => true,
        complete: (req, o) => inner.complete(req, o),
        async *stream(req, o) {
          const s2 = readPrompt(req.system ?? '', req.prompt)
          if (!crashed && s2.role === 'principal' && answers(req.prompt).length === 1 && s2.children.length === 0) {
            crashed = true
            await req.tools!.call('channel_create', { name: 'Histoire (EN)', language: 'en', translateFrom: 1 })
            throw new Error('Claude Code exited (code 1)')
          }
          yield* inner.stream(req, o)
        }
      }
      return wrapper
    })
    await makeClip(path.join(s.dir, 'sample.mp4'))
    s.core.orchestra.say({ agentId: principalOf(s.core).id, text: 'Traduis ma chaîne Histoire en anglais' })
    await s.drain()
    s.core.orchestra.answer(s.core.orchestra.inbox()[0]!.id, { choice: 'Valider' })
    await s.drain()
    expect(crashed).toBe(true)
    const root = s.core.orchestra.tasks({ kind: 'mention' })[0]!
    expect(root.status).toBe('failed') // waits for its backoff
    // the app quits and comes back, then the backoff passes: the retried turn finds the channel it had already made
    s.reopen()
    s.clock.t += 60_000
    await s.core.orchestra.tick({ wait: true }) // the principal: « already done » → delegates to the new lead
    expect((s.core.db.prepare("SELECT COUNT(*) AS n FROM channels WHERE name LIKE 'Histoire (EN)%'").get() as { n: number }).n).toBe(1)
    const en = (s.core.db.prepare("SELECT id FROM channels WHERE name = 'Histoire (EN)'").get() as { id: number }).id
    expect(s.core.orchestra.agents().filter((a) => a.slug === `lead-${en}`)).toHaveLength(1)
    await s.core.orchestra.tick({ wait: true }) // the lead hands out the look and the script
    const middle = s.core.orchestra.tasks({ limit: 500 })
    expect(middle.filter((t) => (t.kind === 'look' || t.kind === 'script') && t.status === 'queued')).toHaveLength(2)
    expect(middle.filter((t) => t.kind === 'production')).toHaveLength(0)
    // the app quits again with the specialists' work queued → it comes back and finishes
    s.reopen()
    await s.drain()
    expect(s.core.context.productionRuns.list({ channelId: en })).toHaveLength(1)
    const all = s.core.orchestra.tasks({ limit: 500 })
    expect(all.find((t) => t.id === root.id)!.status).toBe('done')
    expect(all.filter((t) => t.kind === 'production')).toHaveLength(1)
    expect(all.filter((t) => t.kind === 'plan' && t.parentId === root.id)).toHaveLength(1)
    s.core.close()
  }, 60_000)
})

describe('Atlas: « Ajoute une chaîne sur les énigmes historiques »', () => {
  it('asks the onboarding questions through the inbox, confirms, creates the channel with its memory, gets first topics', async () => {
    const s = scene((w) => new FakeProvider(team(w)))
    const o = () => s.core.orchestra
    o().say({ agentId: principalOf(s.core).id, text: 'Ajoute une chaîne sur les énigmes historiques' })
    await s.drain()
    const q = o().inbox()
    expect(q).toHaveLength(1)
    expect(q[0]).toMatchObject({ kind: 'input' })
    o().answer(q[0]!.id, { text: 'Nom : Énigmes de l’Histoire. Langue : fr. Public : passionnés d’histoire 25-45 ans. Rythme : 2 vidéos par semaine.' })
    await s.drain()
    // the channel is not made on an answer to a question: Atlas confirms first
    expect(s.core.db.prepare("SELECT COUNT(*) AS n FROM channels WHERE niche = 'énigmes historiques'").get()).toEqual({ n: 0 })
    const confirm = o().inbox()
    expect(confirm).toHaveLength(1)
    expect(confirm[0]).toMatchObject({ kind: 'validate' })
    o().answer(confirm[0]!.id, { choice: 'Valider' })
    await s.drain()
    const row = s.core.db.prepare("SELECT id, name, niche FROM channels WHERE niche = 'énigmes historiques'").get() as { id: number; name: string }
    expect(row.name).toBe('Énigmes de l’Histoire')
    const memory = o().contextBlock('channel', row.id).text
    expect(memory).toContain('Langue : fr')
    expect(memory).toContain('Public : passionnés d’histoire de 25 à 45 ans')
    expect(memory).toContain('Rythme : 2 vidéos par semaine.')
    expect(o().contextBlock('workspace').text).toContain('- Charlie lance une chaîne d’énigmes historiques, 2 vidéos par semaine.')
    const root = o().tasks({ kind: 'mention' })[0]!
    expect(root.status).toBe('done')
    expect(root.result).toContain('Le masque de fer')
    const research = o().tasks({ kind: 'research' })
    expect(research).toHaveLength(1)
    expect(research[0]!.assigneeId).toBe(o().parts.tree.bySlug(`researcher-${row.id}`)!.id)
    // the researcher's own prompt carried the new channel's memory
    const call = (s.provider as FakeProvider).calls.find((c) => (c.system ?? '').includes('(role: researcher, channel: Énigmes'))!
    expect(call.system).toContain('Channel memory (Énigmes de l’Histoire')
    expect(call.system).toContain('Niche : énigmes historiques')
    s.core.close()
  }, 60_000)

  it('refuses to create a channel before Charlie validated it', async () => {
    const s = scene(() => new FakeProvider(() => ({ toolCalls: [{ name: 'channel_create', args: { name: 'Pressée' } }], text: 'ok' + block([{ type: 'done', result: 'ok' }]) })))
    s.core.orchestra.enqueue({ assigneeId: principalOf(s.core).id, kind: 'plan', title: 'Créer vite' })
    await s.drain()
    const res = (s.provider as FakeProvider).toolResults[0]!
    expect(res).toMatchObject({ name: 'channel_create', isError: true })
    expect(res.text).toMatch(/has not validated this channel yet/)
    expect(s.core.db.prepare("SELECT COUNT(*) AS n FROM channels WHERE name = 'Pressée'").get()).toEqual({ n: 0 })
    s.core.close()
  }, 30_000)
})
