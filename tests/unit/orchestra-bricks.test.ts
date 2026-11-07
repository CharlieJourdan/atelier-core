// « Brique sur mesure », the agent loop (docs/AGENT-RUNTIME.md §23), with the FakeProvider playing every agent and a fake sandboxed browser
// (its text layout says when the name overflows) and a fake ffmpeg — no model, no network, no browser:
//   1. « Fais-moi une carte de présentation pour la chaîne Histoire » → Atlas → the channel's lead → the production supervisor → the Monteur;
//   2. the Monteur drafts a card, previews it: the lint fails (the name overflows its box); it fixes it, previews again: the lint passes,
//      and it LOOKS at the stills (they come back as images); it proposes it: the brick waits in Charlie's inbox, the task waits for him;
//   3. Charlie refuses with a note → the brick is a draft again with the note, the Monteur revises it (a new version) and proposes again;
//   4. Charlie validates (Production › Briques) → the brick is validated and used by the channel; every task of the chain finishes;
//   5. a run of the engine for the channel gets it: the director places it on the named person and motion.render draws THAT version.
// Plus: the tries are capped, the technologies are the Monteur's only, the brick is refused before drawing when it holds a script tag.
import { describe, expect, it } from 'vitest'
import type { Brick } from '../../src/engine/formats/brick'
import { EDITPLAN_SCHEMA, type EditPlan } from '../../src/engine/formats/editplan'
import { placeBricks } from '../../src/engine/nodes/director-bricks'
import { MotionParams, motionRender } from '../../src/engine/nodes/motion-render'
import { pipelineFromDrawing } from '../../src/engine/pipelines/from-drawing'
import { MOTION_FILM_DRAWING } from '../../src/engine/pipelines/motion-demo'
import { FakeProvider, type FakeReply } from '../../src/main/llm/fake'
import type { CompletionRequest } from '../../src/main/llm/types'
import { MAX_TRIES } from '../../src/main/bricks/store'
import { readPrompt } from '../../src/main/orchestra/fake-team'
import { applyRunContext } from '../../src/main/production/runs/profile'
import { CARD, CARD_OVERFLOW, cardLayout, fakeBrickBrowser, fakeMedia } from './brick-fixture'
import { art, makeCtx, tempDir, testServices } from './engine-node-helpers'
import { filmOf } from './motion-fixture'
import { agentBySlug, drain, rig } from './orchestra-helpers'

const block = (actions: unknown[]): string => `\n\n\`\`\`atelier\n${JSON.stringify({ actions })}\n\`\`\``
const answered = (prompt: string): string[] => {
  const at = prompt.indexOf('Charlie answered your question:')
  return at < 0 ? [] : prompt.slice(at).split('\n').slice(1).filter((l) => l.startsWith('- '))
}
const ROLE_IN_COLOUR = CARD.css!.replace('.role{font-size:34px;line-height:42px;color:rgba(255,255,255,0.82)}', '.role{font-size:34px;line-height:42px;color:var(--f-accent)}')

/** The team, scripted. */
function team(channel: number) {
  return (req: CompletionRequest): FakeReply | string => {
    const s = readPrompt(req.system ?? '', req.prompt)
    const said = answered(req.prompt)
    if (s.role === 'principal') {
      if (s.children.length === 0) return 'Je confie la carte à la chaîne.' + block([{ type: 'delegate', to: `lead-${channel}`, kind: 'brick', title: 'Carte de présentation', brief: 'Une carte de présentation des personnages, aux couleurs de la chaîne' }])
      return 'La carte est prête.' + block([{ type: 'done', result: `Carte : ${s.children.join(' / ')}` }])
    }
    if (s.role === 'channel_lead') {
      if (s.children.length === 0) return 'Pour la production.' + block([{ type: 'delegate', to: `production-supervisor-${channel}`, kind: 'brick', title: 'Carte de présentation', brief: s.brief }])
      return 'Fait.' + block([{ type: 'done', result: s.children.join(' / ') }])
    }
    if (s.role === 'production_supervisor') {
      if (s.children.length === 0) return 'Au Monteur.' + block([{ type: 'delegate', to: `video-producer-${channel}`, kind: 'brick', title: 'Carte de présentation', brief: s.brief }])
      return 'Fait.' + block([{ type: 'done', result: s.children.join(' / ') }])
    }
    if (s.role === 'video_producer') {
      if (said.length === 0) {
        // the first round: a try that overflows, the lint says so, the fix, the lint passes, the proposal
        return {
          toolCalls: [
            { name: 'bricks_draft', args: CARD_OVERFLOW },
            { name: 'bricks_preview', args: { id: CARD.id } },
            { name: 'bricks_draft', args: CARD },
            { name: 'bricks_preview', args: { id: CARD.id } },
            { name: 'bricks_propose', args: { id: CARD.id, note: 'Le nom se réduit pour tenir dans la carte.' } }
          ],
          text: 'Je te propose la carte.'
        }
      }
      if (said.some((l) => l.includes('Refuser'))) {
        if (said.some((l) => l.includes('Valider'))) return 'Validée, merci.' + block([{ type: 'done', result: 'Carte validée (custom:fiche-personnage)' }])
        // Charlie's note: the role in the channel's colour
        return {
          toolCalls: [
            { name: 'bricks_draft', args: { ...CARD, css: ROLE_IN_COLOUR } },
            { name: 'bricks_preview', args: { id: CARD.id } },
            { name: 'bricks_propose', args: { id: CARD.id, note: 'Le rôle est maintenant de la couleur de la chaîne.' } }
          ],
          text: 'Corrigée, je te la repropose.'
        }
      }
      return 'Validée.' + block([{ type: 'done', result: 'Carte validée' }])
    }
    return 'ok' + block([{ type: 'done', result: 'ok' }])
  }
}

describe('Atlas: « Fais-moi une carte de présentation pour la chaîne Histoire »', () => {
  it('the Monteur drafts, sees the lint fail, fixes, passes, proposes; Charlie refuses with a note, it revises; validated, a run uses it', async () => {
    let provider: FakeProvider | null = null
    const browser = fakeBrickBrowser({ layout: cardLayout })
    const media = fakeMedia()
    const r = rig({
      providerFor: () => (provider ??= new FakeProvider(team(1))),
      core: { orchestra: { services: { motion: { browser: () => browser, fontCss: () => Promise.resolve('') }, media: () => media } } }
    })
    const channel = r.channels[0]!
    expect(channel).toBe(1)
    const o = r.core.orchestra
    const bricks = r.core.context.bricks
    o.say({ agentId: agentBySlug(r, 'principal').id, text: 'Fais-moi une carte de présentation pour la chaîne Histoire' })
    await drain(r)

    // the tools the Monteur used, in order, and what they said
    const results = () => (provider as FakeProvider).toolResults as { name: string; text: string; isError: boolean; images?: unknown[] }[]
    expect(results().map((x) => x.name)).toEqual(['bricks_draft', 'bricks_preview', 'bricks_draft', 'bricks_preview', 'bricks_propose'])
    expect(results().every((x) => !x.isError)).toBe(true)
    const [, fail, , pass] = results()
    expect(fail!.text).toMatch(/LINT FAIL/)
    expect(fail!.text).toMatch(/FAIL overflow: text « Élise Moreau » overflows its box/)
    expect(pass!.text).toMatch(/LINT PASS/)
    // it LOOKS at them: three stills come back as images (JPEG, base64), like eyes.look's frames
    expect(fail!.images).toHaveLength(3)
    expect(pass!.images).toHaveLength(3)
    // every page it drew was sandboxed, with the brick's own markup
    expect(browser.opened.length).toBeGreaterThanOrEqual(4)
    expect(browser.opened.every((p) => p.sandbox !== undefined && p.html.includes('Content-Security-Policy'))).toBe(true)
    // the brick waits for Charlie in his inbox, and so does the Monteur's task
    let row = bricks.get(channel, CARD.id)!
    expect(row).toMatchObject({ state: 'review', version: 2, approvedVersion: null, enabled: false, tries: 0 })
    const ask = o.inbox()
    expect(ask).toHaveLength(1)
    expect(ask[0]).toMatchObject({ kind: 'validate', options: ['Valider', 'Refuser'], title: 'Brique à valider : Fiche personnage' })
    expect(ask[0]!.body).toMatch(/custom:fiche-personnage v2/)
    expect(ask[0]!.body).toMatch(/still-050\.jpg/)
    const monteur = agentBySlug(r, `video-producer-${channel}`)
    const mTask = o.tasks({ limit: 100 }).find((t) => t.assigneeId === monteur.id)!
    expect(mTask.status).toBe('waiting_human')
    expect(mTask.kind).toBe('brick')
    // the screen shows it with its stills and the verdict
    const view = r.core.api['bricks.list']()
    expect(Array.isArray(view) && view[0]).toMatchObject({ template: 'custom:fiche-personnage', state: 'review', lintOk: true })
    expect((view as { stills: { dataUrl: string }[] }[])[0]!.stills[0]!.dataUrl).toMatch(/^data:image\/jpeg;base64,/)

    // 3. Charlie refuses with a note: back to draft with it; the Monteur revises (v3) and proposes again
    o.answer(ask[0]!.id, { choice: 'Refuser', text: 'Le rôle en couleur de la chaîne, s’il te plaît.' })
    row = bricks.get(channel, CARD.id)!
    expect(row).toMatchObject({ state: 'draft', note: 'Le rôle en couleur de la chaîne, s’il te plaît.', approvedVersion: null })
    await drain(r)
    const second = results().slice(5)
    expect(second.map((x) => x.name)).toEqual(['bricks_draft', 'bricks_preview', 'bricks_propose'])
    expect(second[1]!.text).toMatch(/LINT PASS/)
    row = bricks.get(channel, CARD.id)!
    expect(row).toMatchObject({ state: 'review', version: 3 })
    const ask2 = o.inbox()
    expect(ask2).toHaveLength(1)
    expect(ask2[0]!.id).not.toBe(ask[0]!.id)

    // 4. Charlie validates from Production › Briques (the same answer as the inbox): validated, used by the channel, the chain finishes
    const decided = await r.core.api['bricks.decide'](row.id, { approve: true })
    expect(decided).toMatchObject({ state: 'approved', approvedVersion: 3, enabled: true })
    expect(o.inbox()).toHaveLength(0)
    await drain(r)
    const all = o.tasks({ limit: 200 })
    expect(all.find((t) => t.id === mTask.id)?.status).toBe('done')
    const root = all.find((t) => t.kind === 'mention' && t.assigneeId === agentBySlug(r, 'principal').id)!
    expect(root.status).toBe('done')
    expect(root.result).toMatch(/^Carte :/)
    expect(all.filter((t) => t.kind === 'brick').every((t) => t.status === 'done')).toBe(true)

    // 5. a run of the channel gets the validated version: the director places it on the named person, motion.render draws THAT version
    const approved: Brick[] = bricks.approvedFor(channel)
    expect(approved.map((b) => [b.id, b.version])).toEqual([['fiche-personnage', 3]])
    const doc = applyRunContext(pipelineFromDrawing(MOTION_FILM_DRAWING, { id: 'motion-film', minutes: 1 }).pipeline, { profile: null, inspiration: [], bricks: approved })
    const director = doc.nodes.find((n) => n.type.startsWith('director.plan'))!.params as { bricks: Parameters<typeof placeBricks>[0]['bricks'] }
    const film = filmOf('Ce soir-là, le professeur Élise Moreau allume la lampe du phare. Elle écrit tout dans son carnet.\n\nAu matin, rien n’a changé.')
    const placed = placeBricks({ bricks: director.bricks, words: film.words, beats: film.beats, durationS: film.durationS, shots: [], accent: '#3B82F6', theme: 'dark' })
    expect(placed.shots).toHaveLength(1)
    const plan: EditPlan = {
      schema: EDITPLAN_SCHEMA,
      fps: 30,
      size: [1920, 1080],
      frames: Math.round(film.durationS * 30),
      tracks: { base: ['s001'], overlay: placed.shots.map((s) => s.id), labels: [] },
      captionsPreset: 'highlight',
      shots: [{ id: 's001', track: 'base', startFrame: 0, endFrame: Math.round(film.durationS * 30), kind: 'stock.photo', genItem: 'i', transitionIn: 'cut', role: 'base', beat: 0 }, ...placed.shots],
      chapters: [],
      diagnostics: []
    }
    const t = tempDir('bricks-run')
    try {
      const engineBrowser = fakeBrickBrowser({ layout: cardLayout })
      const params = MotionParams.parse(doc.nodes.find((n) => n.type.startsWith('motion.render'))!.params)
      const out = await motionRender.run(makeCtx({ ...testServices(t.dir), media: fakeMedia(), browser: engineBrowser }), { plan: art('json.editplan', { value: plan as never }) }, params)
      expect(out.graphics?.value).toEqual([expect.objectContaining({ template: 'custom:fiche-personnage' })])
      expect(engineBrowser.opened).toHaveLength(1)
      expect(engineBrowser.opened[0]!.html).toContain('color:var(--f-accent)}') // Charlie's note, in version 3
      expect(engineBrowser.opened[0]!.html).toContain('Élise Moreau')
    } finally {
      t.cleanup()
    }
    r.core.close()
  }, 60_000)

  it('caps the previews of a round, keeps the technologies to the Monteur, refuses a brick with a script tag before drawing it', async () => {
    const browser = fakeBrickBrowser({ layout: cardLayout })
    const many = Array.from({ length: MAX_TRIES + 1 }, () => ({ name: 'bricks_preview', args: { id: CARD.id } }))
    const provider = new FakeProvider((req) => {
      const s = readPrompt(req.system ?? '', req.prompt)
      if (s.role === 'video_producer') {
        return {
          toolCalls: [{ name: 'bricks_draft', args: { ...CARD, html: CARD.html + '<script>fetch("https://example.com")</script>' } }, { name: 'bricks_draft', args: CARD_OVERFLOW }, ...many],
          text: 'Essais.' + block([{ type: 'done', result: 'essais' }])
        }
      }
      return { toolCalls: [{ name: 'bricks_draft', args: CARD }], text: 'non' + block([{ type: 'done', result: 'non' }]) }
    })
    const r = rig({ providerFor: () => provider, core: { orchestra: { services: { motion: { browser: () => browser, fontCss: () => Promise.resolve('') }, media: () => fakeMedia() } } } })
    const o = r.core.orchestra
    o.enqueue({ assigneeId: agentBySlug(r, `video-producer-${r.channels[0]}`).id, kind: 'brick', title: 'Essais' })
    o.enqueue({ assigneeId: agentBySlug(r, `scriptwriter-${r.channels[0]}`).id, kind: 'script', title: 'Hors rôle' })
    await drain(r)
    const res = provider.toolResults
    const mine = res.filter((x) => x.name === 'bricks_draft' || x.name === 'bricks_preview')
    // the script tag: refused before any drawing
    expect(mine[0]).toMatchObject({ isError: true })
    expect(mine[0]!.text).toMatch(/refused before any drawing: html: .*<script>/)
    // the overflowing card is saved; MAX_TRIES previews, then the next one is refused
    const previews = res.filter((x) => x.name === 'bricks_preview')
    expect(previews.slice(0, MAX_TRIES).every((x) => !x.isError && /LINT FAIL/.test(x.text))).toBe(true)
    // the per-turn quota of previews is the same number: the cap is the store's round (tries), checked in a second turn below
    expect(previews).toHaveLength(MAX_TRIES + 1)
    expect(previews[MAX_TRIES]!.isError).toBe(true)
    expect(r.core.context.bricks.get(r.channels[0]!, CARD.id)!.tries).toBe(MAX_TRIES)
    // the scriptwriter has no brick technology: refused, nothing written for it
    const refused = res.filter((x) => x.isError && /is not one of/.test(x.text))
    expect(refused.length).toBe(1)
    expect(refused[0]!.text).toMatch(/Refused: bricks\.draft is not one of/)
    // a new turn of the same round: still capped
    o.enqueue({ assigneeId: agentBySlug(r, `video-producer-${r.channels[0]}`).id, kind: 'brick', title: 'Encore' })
    await drain(r)
    const next = provider.toolResults.filter((x) => x.name === 'bricks_preview')[MAX_TRIES + 1]!
    expect(next.isError).toBe(true)
    expect(next.text).toMatch(new RegExp(`previewed ${MAX_TRIES} times this round: propose it as it is`))
    r.core.close()
  }, 60_000)
})
