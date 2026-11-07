// Lot Z1: the five Production screens render in plain Node (renderToStaticMarkup, no window.atelier): one h1, their French
// labels, no raw `undefined` / `NaN`, and the pure helpers they rely on (line diff, durations, figures per channel).
import type { ComponentType } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { NO_FEATURES } from '../../src/shared/features'
import { t } from '../../src/shared/fr'
import type { Route } from '../../src/shared/sections'
import type { RunOutput, RunSummary } from '../../src/shared/runs'
import { TooltipProvider } from '../../src/renderer/components/ui/tooltip'
import { FeaturesProvider } from '../../src/renderer/lib/features'
import type { ScreenProps } from '../../src/renderer/screens/registry'
import { SectionScreen } from '../../src/renderer/screens/SectionScreen'
import { PRODUCTION_SCREENS } from '../../src/renderer/screens/production'
import { ApercuScreen } from '../../src/renderer/screens/production/apercu/ApercuScreen'
import { BibliothequeScreen } from '../../src/renderer/screens/production/bibliotheque/BibliothequeScreen'
import { NouvelleScreen } from '../../src/renderer/screens/production/nouvelle/NouvelleScreen'
import { OutputView } from '../../src/renderer/screens/production/encours/Reviews'
import { Timeline } from '../../src/renderer/screens/production/editeur/Timeline'
import { EditeurScreen } from '../../src/renderer/screens/production/editeur/EditeurScreen'
import { figuresOf, sameMonth } from '../../src/renderer/screens/production/apercu/ApercuScreen'
import { diffLines, fmtBytes, fmtClock, fmtDuration } from '../../src/renderer/screens/production/shared'

const noop = () => undefined

// production-2: the routes `nouvelle`, `apercu`, `bibliotheque`, `pipeline`, `editeur` and `ressources` open the rebuilt
// Production (tests/unit/production-screens.test.tsx). The previous components are kept in the code base and rendered
// directly here (their page titles follow the renamed pages); only `encours` still goes through the route.
const OLD: Record<string, ComponentType<ScreenProps>> = {
  nouvelle: NouvelleScreen,
  apercu: ApercuScreen,
  bibliotheque: BibliothequeScreen,
  editeur: EditeurScreen
}
const render = (page: string): string => {
  const route: Route = { section: 'production', page }
  const Old = OLD[page]
  return renderToStaticMarkup(
    <FeaturesProvider value={NO_FEATURES}>
      <TooltipProvider>{Old ? <Old route={route} onRoute={noop} /> : <SectionScreen route={route} onRoute={noop} />}</TooltipProvider>
    </FeaturesProvider>
  )
}

const SCREENS: [string, string[]][] = [
  ['nouvelle', ['Nouvelle vidéo', 'Chaîne', 'Sujet', 'Budget', 'Usage max', 'Qualité max', 'Pas à pas', 'Tout d’un coup', 'Mon ordinateur', 'Machine distante', 'Lancer', 'Devis']],
  ['encours', ['En cours']],
  ['apercu', [t('page.production.apercu')]],
  ['bibliotheque', ['Projets']],
  ['editeur', [t('page.production.editeur')]]
]

describe('production screens', () => {
  it('registers the eight screens under production/<page> (the proto ones replace apercu, bibliotheque, nouvelle, pipeline, ressources; production-12 adds agent, production-lab pretes)', () => {
    expect(Object.keys(PRODUCTION_SCREENS).sort()).toEqual([
      'production/agent',
      'production/apercu',
      'production/bibliotheque',
      // creation-conversationnelle: « Créer une pipeline » as a conversation
      'production/creer',
      'production/editeur',
      'production/encours',
      'production/nouvelle',
      'production/pipeline',
      'production/pretes',
      'production/ressources',
      'production/style'
    ])
  })

  it.each(SCREENS)('%s renders with one h1, its French labels and no raw undefined / NaN', (page, labels) => {
    const html = render(page)
    expect(html).toContain('data-testid="view-production"')
    expect(html.match(/<h1[ >]/g)).toHaveLength(1)
    for (const l of labels) expect(html, l).toContain(l)
    expect(html).not.toMatch(/undefined|NaN|\[object Object\]/)
  })

  it('the composer shows the demo banner (Atelier Cloud is not connected) and a launch button that waits for a subject', () => {
    const html = render('nouvelle')
    expect(html).toContain('data-testid="demo-banner"')
    expect(html).toContain('data-testid="launch"')
    expect(html).toContain('disabled')
    expect(html).toContain('Écris un sujet pour pouvoir lancer.')
  })

  it('the remote machine option is disabled, with the registry reason', () => {
    const html = render('nouvelle')
    const remote = html.match(/<button[^>]*role="radio"[^>]*disabled[^>]*>/)
    expect(remote?.[0]).toContain('aria-checked="false"')
    expect(html).toContain('Atelier Cloud ne la propose pas encore')
  })
})

describe('production helpers', () => {
  it('formats durations, clocks and sizes in French', () => {
    expect(fmtDuration(61.2)).toBe('1 min 01 s')
    expect(fmtDuration(42)).toBe('42 s')
    expect(fmtDuration(null)).toBe('—')
    expect(fmtDuration(Number.NaN)).toBe('—')
    expect(fmtClock(75)).toBe('1:15')
    expect(fmtBytes(512)).toBe('512 o')
    expect(fmtBytes(2048)).toBe('2 Ko')
    expect(fmtBytes(5 * 1024 * 1024)).toBe('5,0 Mo')
  })

  it('diffs a script line by line (added and removed lines, unchanged kept)', () => {
    const parts = diffLines('Intro\nCorps\nFin', 'Intro\nCorps corrigé\nFin\nPS')
    expect(parts).toEqual([
      { kind: 'same', text: 'Intro' },
      { kind: 'del', text: 'Corps' },
      { kind: 'add', text: 'Corps corrigé' },
      { kind: 'same', text: 'Fin' },
      { kind: 'add', text: 'PS' }
    ])
    expect(diffLines('a', 'a').every((p) => p.kind === 'same')).toBe(true)
  })

  it('counts a channel\'s runs: making, waiting, finished and spent this month', () => {
    const now = new Date('2026-10-20T12:00:00Z')
    const run = (over: Partial<RunSummary>): RunSummary =>
      ({ id: 1, status: 'running', spentCredits: 0, createdAt: '2026-10-02T08:00:00Z', startedAt: '2026-10-02T08:00:00Z', finishedAt: null, ...over }) as RunSummary
    const f = figuresOf(
      [
        run({ id: 1, status: 'running' }),
        run({ id: 2, status: 'interrupted' }),
        run({ id: 3, status: 'waiting' }),
        run({ id: 4, status: 'succeeded', finishedAt: '2026-10-05T10:00:00Z', spentCredits: 120 }),
        run({ id: 5, status: 'succeeded', finishedAt: '2026-09-05T10:00:00Z', startedAt: '2026-09-05T09:00:00Z', spentCredits: 999 }),
        run({ id: 6, status: 'failed', spentCredits: 30 })
      ],
      now
    )
    expect(f.making.map((r) => r.id)).toEqual([1, 2])
    expect(f.waiting.map((r) => r.id)).toEqual([3])
    expect(f.doneThisMonth).toBe(1)
    expect(f.spentThisMonth).toBe(150)
    expect(sameMonth(null, now)).toBe(false)
  })
})

const file = (name: string) => ({ ref: name, name, size: 2048, mime: 'application/octet-stream' })
const view = (out: RunOutput): string => renderToStaticMarkup(<OutputView runId={1} out={out} />)

describe('node reviews by output kind', () => {
  it('shows the script with its word count and the demo badge; the diff toggle only with a previous version', () => {
    const html = view({ kind: 'text', nodeId: 'script', text: 'Un script court.', previous: 'Un ancien script.', words: 3, outline: { title: 'Plan', sections: ['Intro', 'Fin'] }, demo: true })
    expect(html).toContain('3 mots')
    expect(html).toContain('Comparer avec la version précédente')
    expect(html).toContain('data-testid="demo-badge"')
    expect(html).toContain('Intro')
    expect(view({ kind: 'text', nodeId: 'script', text: 'x', previous: null, words: 1, outline: null, demo: false })).not.toContain('Comparer')
  })

  it('shows the edit plan with a price per line and the total', () => {
    const html = view({
      kind: 'editplan',
      nodeId: 'director',
      durationS: 61.5,
      fps: 30,
      shots: [],
      chapters: [{ title: 'Intro', start: 0 }],
      items: [
        { id: 'a', kind: 'image.gen', prompt: 'Un château', units: 2, credits: 5, shotIds: ['s1', 's2'] },
        { id: 'b', kind: 'stock.photo', prompt: 'Une forêt', units: 1, credits: 0, shotIds: ['s3'] }
      ],
      totals: { credits: 5, items: 2, shots: 3, byKind: { 'image.gen': 1 } },
      captionsPreset: 'highlight'
    })
    expect(html).toContain('data-testid="plan-items"')
    expect(html).toContain('Un château')
    expect(html).toContain('5 crédits')
    expect(html).toContain('Gratuit')
    expect(html).toContain('1 min 02 s')
    expect(html).not.toMatch(/undefined|NaN/)
  })

  it('shows the package, an unavailable message, the voice player and a grid of stills', () => {
    const pkg = view({ kind: 'package', nodeId: 'package', title: 'Titre', alternatives: ['Autre'], description: 'Desc', chapters: [{ at: 65, title: 'Suite' }], tags: ['a'], files: [file('video.mp4')], folder: '/tmp/p', demo: true })
    expect(pkg).toContain('Ouvrir le dossier')
    expect(pkg).toContain('1:05')
    expect(pkg).toContain('2 Ko')
    expect(view({ kind: 'unavailable', reason: 'example', message: 'Fichiers non conservés pour l’exemple.' })).toContain('Fichiers non conservés pour l’exemple.')
    expect(view({ kind: 'audio', nodeId: 'voice', file: file('voice.wav'), durationS: 3.5, voice: 'v1', voiceUsed: 'Thomas', words: [], demo: true })).toContain('data-testid="audio-player"')
    const imgs = view({ kind: 'images', nodeId: 'visuals', demo: true, images: [{ file: file('1.png'), itemId: 'a', beat: 0, prompt: 'Un château', source: 'drawn', demo: true }] })
    expect(imgs).toContain('Scène 1')
    expect(imgs).toContain('Un château')
  })

  it('draws the timeline with its four tracks, the playhead and the shot at the playhead', () => {
    const html = renderToStaticMarkup(
      <Timeline
        runId={1}
        plan={{
          kind: 'editplan',
          nodeId: 'director',
          durationS: 30,
          fps: 30,
          shots: [{ id: 's1', track: 'base', start: 0, end: 10, kind: 'image.gen', label: 'Un château', beat: 0, itemId: 'a', credits: 3 }],
          chapters: [{ title: 'Intro', start: 0 }],
          items: [],
          totals: { credits: 3, items: 1, shots: 1, byKind: {} },
          captionsPreset: 'highlight'
        }}
        voice={{ url: null, peaks: Array.from({ length: 240 }, (_, i) => (i % 10) / 10), measured: true, error: null }}
        voiceDurationS={28}
        stills={new Map()}
        captions={{ preset: 'highlight', cues: 12, burn: true }}
        music={null}
      />
    )
    for (const l of ['Voix', 'Visuels', 'Sous-titres', 'Musique', '0:00 / 0:30', 'Un château', '12 sous-titres']) expect(html, l).toContain(l)
    expect(html).toContain('data-testid="waveform"')
    expect(html).toContain('data-testid="playhead"')
    expect(html).not.toMatch(/undefined|NaN/)
  })
})
