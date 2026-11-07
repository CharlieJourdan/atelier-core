// The cloning screens (intake, progress, report) rendered from real fake artefacts: the content a person must see is there,
// the French copy covers every key the components use, and nothing shows a bare percentage or an English engine string.
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { fakeChannel } from '../../src/main/production/clone/fakes/channels'
import { fakeServices } from '../../src/main/production/clone/fakes/services'
import { intakeTurn, startIntake } from '../../src/main/production/clone/intake/conversation'
import { cloneProgress } from '../../src/main/production/clone/intake/progress'
import { runClone } from '../../src/main/production/clone/orchestrator'
import { CloneStore } from '../../src/main/production/clone/store'
import { frClone, tc, tx } from '../../src/shared/fr-clone'
import { IntakePanel, quickReplies, type ChatLine } from '../../src/renderer/screens/production/clone/IntakePanel'
import { ProgressPanel } from '../../src/renderer/screens/production/clone/ProgressPanel'
import { ReportPanel } from '../../src/renderer/screens/production/clone/ReportPanel'
import { changeText } from '../../src/renderer/screens/production/clone/format'

const text = (html: string): string => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;|&#39;/g, '’').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ')

async function fake(kind: 'presenter-motion' | 'full-3d', budget = 10) {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'clone-ui-'))
  const ch = fakeChannel(kind)
  const report = await runClone({ dataDir, cloneId: 'c1', services: fakeServices(ch).services, answers: { intent: 'copy-channel', references: [{ url: ch.url, kind: 'channel', axes: [] }], style: null, language: 'fr', sourceLanguage: null, testBudgetUsd: budget, humanInputs: { face: false, voice: false, footage: false }, ownChannel: false, said: [] } })
  return { report, store: new CloneStore(dataDir, 'c1') }
}

describe('intake screen', () => {
  it('starts with six intent cards and an empty brief; after a message it lists what changed', () => {
    const noop = (): void => undefined
    const first = text(renderToStaticMarkup(<IntakePanel lines={[]} state={startIntake()} latest={null} onSend={noop} onStart={noop} />))
    for (const k of ['own-channel', 'copy-channel', 'copy-video', 'translate', 'inspiration', 'mix']) expect(first).toContain(tc(`clone.intent.${k}.title`))
    expect(first).toContain('Il me manque encore')

    const turn = intakeTurn(startIntake(), 'copie https://www.youtube.com/@finary en français, 8 $')
    const lines: ChatLine[] = [{ id: 1, role: 'user', text: 'copie …' }, { id: 2, role: 'agent', turn }]
    const html = renderToStaticMarkup(<IntakePanel lines={lines} state={turn.state} latest={turn} onSend={noop} onStart={noop} />)
    const t = text(html)
    expect(t).toContain('Voilà ce que j’ai changé dans ton brief')
    expect(t).toContain('Copier une chaîne')
    expect(t).toContain('8 $ au plus')
    expect(html.match(/data-testid="intake-change"/g)).toHaveLength(4)
    expect(t).toContain('Peux-tu fournir ton visage')
    expect(html).not.toContain('data-testid="intent-cards"')
  })

  it('offers quick answers for the question asked and a start button only when ready', () => {
    expect(quickReplies('humanInputs').map((c) => c.label)).toContain('Rien, des provisoires')
    expect(quickReplies('testBudgetUsd')).toHaveLength(3)
    expect(quickReplies('intent')).toEqual([])
    const done = [ 'copie https://www.youtube.com/@x', 'en français', '5 $', 'rien' ].reduce((s, m) => intakeTurn(s.state, m), { state: startIntake() } as never as ReturnType<typeof intakeTurn>)
    expect(done.ready).toBe(true)
    const html = renderToStaticMarkup(<IntakePanel lines={[]} state={done.state} latest={done} onSend={() => undefined} onStart={() => undefined} />)
    expect(html).toMatch(/<button[^>]*data-slot="button"[^>]*>C’est bon, lance/)
    expect(html).not.toMatch(/disabled=""[^>]*>C’est bon, lance/)
    expect(changeText({ field: 'testBudgetUsd', before: '8', after: '12' })).toEqual({ field: 'Budget de test', before: '8 $ au plus', after: '12 $ au plus' })
  })
})

describe('progress screen', () => {
  it('draws nine stages with their status and the facts found', async () => {
    const { store } = await fake('presenter-motion')
    const t = text(renderToStaticMarkup(<ProgressPanel progress={cloneProgress(store, { active: false })} />))
    for (const s of ['Ton brief', 'Je les regarde en entier', 'Ce que je sais refaire', 'Je teste, je compare, je corrige', 'Je fabrique un exemple complet']) expect(t).toContain(s)
    expect(t).toMatch(/\d+ vidéos regardées sur \d+/)
    expect(t).toMatch(/Je sais refaire \d+ % de ce qu’on voit à l’écran/)
    expect(t).toMatch(/Dépensé : [\d,]+ \$ sur 10 \$/)
    expect(t).not.toMatch(/\b(undefined|NaN|\[object)/)
  })
})

describe('report screen', () => {
  it('a cloned report: verdict, example, frames, scores, inputs with stand-ins, cost and time, proposals', async () => {
    const { report } = await fake('presenter-motion')
    const html = renderToStaticMarkup(<ReportPanel report={report} budgetUsd={10} onNew={() => undefined} />)
    const t = text(html)
    expect(t).toContain('Je sais tout refaire, avec ton aide')
    expect(t).toContain('un juge qui ne savait pas lequel était l’original a reconnu la même chaîne')
    for (const id of ['report-example', 'report-frames', 'report-scores', 'report-inputs', 'report-costs', 'report-proposals']) expect(html).toContain(`data-testid="${id}"`)
    expect(html.match(/data-testid="score-/g)).toHaveLength(10)
    expect(t).toContain('En attendant :')
    expect(t).toContain('Tel que dans l’exemple')
    expect(html).toContain('data-testid="report-tech"')
    expect(html).toContain('data-testid="option-presenter-generate"')
    expect(t).toContain('L’agent le génère · en ce moment')
    expect(t).toContain('Avec ton vrai « the presenter filmed on camera »')
    expect(t).toMatch(/par minute de vidéo/)
    expect(t).not.toMatch(/\b(undefined|NaN|null|\[object)/)
  })

  it('a not reproducible report: the reason first, alternatives that keep the channel, no example, no cost tiles', async () => {
    const { report } = await fake('full-3d')
    const html = renderToStaticMarkup(<ReportPanel report={report} budgetUsd={10} />)
    const t = text(html)
    expect(t).toContain('Je ne sais pas refaire cette chaîne')
    expect(html).toContain('data-testid="report-alert"')
    expect(html).toContain('data-testid="cannot-row"')
    expect(t).toContain('Ce que je ne sais pas refaire')
    expect(t).toMatch(/\d+ % de l’écran/)
    expect(t).toContain('Le construire : environ 400 $')
    expect(t).toContain('À la place, je te propose')
    expect(t).toContain('Garde : le sujet, le ton, la structure, les couleurs')
    expect(t).toContain('prix à mesurer')
    expect(html).not.toContain('report-costs')
  })

  it('a refused example says so and still shows the last round\'s frames', async () => {
    const dataDir = mkdtempSync(path.join(os.tmpdir(), 'clone-ui-'))
    const ch = fakeChannel('presenter-motion')
    const report = await runClone({ dataDir, cloneId: 'c1', services: fakeServices(ch, { neverSame: true }).services, answers: { intent: 'copy-channel', references: [{ url: ch.url, kind: 'channel', axes: [] }], style: null, language: 'fr', sourceLanguage: null, testBudgetUsd: 10, humanInputs: { face: false, voice: false, footage: false }, ownChannel: false, said: [] } })
    const t = text(renderToStaticMarkup(<ReportPanel report={report} budgetUsd={10} />))
    expect(t).toContain('Pas d’exemple à montrer')
    expect(t).toContain('Mon dernier essai, côte à côte')
  })
})

describe('French copy', () => {
  it('covers every key the components and the engine use, in plain words', () => {
    const dir = path.join(__dirname, '../../src/renderer/screens/production/clone')
    const keys = new Set<string>()
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.tsx') || n.endsWith('.ts'))) {
      for (const m of readFileSync(path.join(dir, f), 'utf8').matchAll(/\btc\('(clone\.[\w.-]+)'/g)) keys.add(m[1]!)
    }
    for (const f of ['conversation.ts', 'progress.ts']) for (const m of readFileSync(path.join(__dirname, '../../src/main/production/clone/intake', f), 'utf8').matchAll(/'(clone\.(?:intake|progress)\.[\w.-]+)'/g)) keys.add(m[1]!)
    const missing = [...keys].filter((k) => !(k in frClone))
    expect(missing).toEqual([])
    expect(keys.size).toBeGreaterThan(40)
    expect(tx('clone.proposal.slot:voice')).toBe('Avec ton vrai « voice »')
    expect(tx('Same story, redrawn')).toBe('Same story, redrawn')
    for (const v of Object.values(frClone)) expect(v).not.toMatch(/\bTODO\b|\bundefined\b/)
  })
})
