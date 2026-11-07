// equipe-3-chaines, the whole path on the app's own runtime (fakes only): Charlie writes « lance-moi 3 vidéos, une par chaîne,
// avec ces scripts » to Atlas with his scripts; Atlas calls videos_order; each channel gets its video made from HIS script
// word for word (the [PUB] marker kept for the pipeline), its run passes its own checkpoints (nobody to answer them), is
// checked, and Charlie is told in his inbox once per video — with no other step by anyone.
import { afterEach, describe, expect, it } from 'vitest'
import type { Pipeline } from '../../src/engine/pipeline-schema'
import type { RecipeDocument } from '../../src/shared/api'
import { fakeTeamReply } from '../../src/main/agents/fake-team'
import { FakeProvider } from '../../src/main/llm/fake'
import { drain, rig, type Rig } from './orchestra-helpers'
import { fixture, waitFor, type Fixture } from './z1-runs-fixtures'

const block = (actions: unknown[]): string => `\n\n\`\`\`atelier\n${JSON.stringify({ actions })}\n\`\`\``

/** The fixture's engine: topic (owner checkpoint) → the script → voice → render → package (owner checkpoint). */
const teamDoc = (doc: Pipeline): Pipeline => ({
  $schema: 'atelier.pipeline/1',
  id: doc.id,
  version: doc.version,
  name: doc.name,
  format: { kind: 'youtube_long', aspect: '16:9', minutes: { default: 1, min: 0.5, max: 30 } },
  inputs: [
    { id: 'topic', kind: 'text', required: true, label: 'Sujet' },
    { id: 'script', kind: 'text', required: true, label: 'Script' }
  ],
  budget: { default: 'usage_max' },
  nodes: [
    { id: 'research', type: 'research.topic@1', in: { topic: '$inputs.topic' }, gate: 'owner' },
    { id: 'script', type: 'script.write@1', in: { brief: 'research.brief' } },
    { id: 'voice', type: 'voice.tts@1', in: { script: 'script.text' }, params: { voice: '$style.voice' } },
    { id: 'render', type: 'render.assemble@1', in: { voice: 'voice.audio' } },
    { id: 'package', type: 'package.youtube@1', in: { video: 'render.video' }, gate: 'owner' }
  ]
})

const brick = (tech: string) => ({ tech, settings: {}, engine: null, fallbacks: [], style: null })
const importDoc = (): RecipeDocument => ({
  $schema: 'atelier.recette/2',
  base: null,
  language: null,
  mix: null,
  options: {},
  inputs: {},
  name: 'Mes scripts',
  videoType: 'documentaire',
  format: { aspect: '16:9', minutes: 1 },
  capCredits: null,
  checkpoints: [],
  bricks: ['script.import@1', 'voice.tts@1', 'director.plan@1', 'visuals.fulfil@1', 'captions.make@1', 'sound.music@1', 'render.assemble@1', 'thumbnail.make@1', 'package.youtube@1'].map(brick)
})

const MARCEL = 'Votre radiateur est chaud en bas et froid en haut ? Ce n’est pas une panne. [PUB] D’abord, on coupe la chaudière et on purge.'
const KLAUS = 'Ihr Backofen wird nicht mehr heiß? Bevor Sie einen neuen kaufen, hören Sie zu. [WERBUNG] Erstens: die Sicherung prüfen.'
const AIME = 'Une porte qui frotte ? Ne rabotez pas tout de suite, le bois n’y est pour rien. [PUB] D’abord on resserre les gonds.'
const MESSAGE = `@Atlas lance-moi 3 vidéos, une par chaîne, avec ces scripts.\n\n## marcel artisan\nTitre : Radiateur froid en haut\n${MARCEL}\n\n## Klaus vom Kundendienst\n${KLAUS}\n\n## Gaston le Compagnon\n${AIME}`

let f: Fixture | null = null
let r: Rig | null = null
afterEach(() => {
  r?.core.close()
  f?.cleanup()
  r = null
  f = null
})

describe('Charlie orders three videos from the team', () => {
  it('Atlas → videos_order → three videos made from his scripts, checkpoints passed, checked, told once each', { timeout: 120_000 }, async () => {
    f = fixture()
    const fx = f
    let ordered = 0
    const rg = rig({
      core: { productionRuns: { ...fx.productionRuns, adaptDocument: teamDoc } },
      providerFor: (a) =>
        new FakeProvider((req) => {
          if (req.prompt.includes('lance-moi 3 vidéos') && ordered++ === 0) {
            return { text: '', toolCalls: [{ name: 'videos_order', args: { real: false } }], afterTools: ([res]) => `C’est lancé.${block([{ type: 'done', result: res?.text ?? '' }])}` }
          }
          return fakeTeamReply(req)
        }, `fake-${a.id}`)
    })
    r = rg
    const api = rg.core.api
    const o = rg.core.orchestra
    const ids: number[] = []
    for (const name of ['marcel artisan', 'Klaus vom Kundendienst', 'Gaston le Compagnon']) {
      const ch = await api['channels.create']({ name, niche: 'artisan' })
      const recipe = await api['recipes.save']({ doc: importDoc() })
      await api['recipes.useForChannel'](ch.id, 'documentaire', recipe.id)
      ids.push(ch.id)
    }
    const atlas = o.parts.tree.principal()!
    await api['orchestra.say']({ agentId: atlas.id, text: MESSAGE })
    await drain(rg)
    const placed = await api['orders.list']()
    expect(placed.map((x) => x.channelId).sort()).toEqual([...ids].sort())
    expect(placed.find((x) => x.channelId === ids[0])!.title).toBe('Radiateur froid en haut')
    // each run carries Charlie's script word for word, marker included (the pipeline turns it into the promo)
    for (const x of placed) {
      const row = rg.core.db.prepare('SELECT inputs_json FROM video_runs WHERE id = ?').get(x.runId) as { inputs_json: string }
      expect([MARCEL, KLAUS, AIME]).toContain(JSON.parse(row.inputs_json).script)
    }
    // the runs stop at their pipeline's checkpoints: the order passes them, nothing waits for Charlie
    const done = await waitFor(
      async () => {
        await o.tick({ wait: true })
        const list = await api['orders.list']()
        return list.every((x) => x.notifiedAt !== null) ? list : null
      },
      100_000,
      'every ordered video to be told'
    )
    expect(done.map((x) => x.status)).toEqual(['ready', 'ready', 'ready'])
    const told = (await api['orchestra.inbox']()).filter((i) => i.title.startsWith('Vidéo prête'))
    expect(told.map((i) => i.title).sort()).toEqual([
      'Vidéo prête · Gaston le Compagnon · Une porte qui frotte ?',
      'Vidéo prête · Klaus vom Kundendienst · Ihr Backofen wird nicht mehr heiß?',
      'Vidéo prête · marcel artisan · Radiateur froid en haut'
    ])
    expect(told[0]!.body).toMatch(/Juge à l’aveugle : pas fait \(aucune vidéo de la chaîne/u)
    const events = (await api['orchestra.events']()).map((e) => e.text)
    expect(events.some((t) => /étape « research » validée par la commande/u.test(t))).toBe(true)
    // a later tick tells nobody twice
    await o.tick({ wait: true })
    expect((await api['orchestra.inbox']()).filter((i) => i.title.startsWith('Vidéo prête'))).toHaveLength(3)
  })
})
