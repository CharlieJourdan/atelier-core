// Analyses of the kind the eyes return (src/shared/video-analysis.ts), written by hand for the style-profile tests.
import type { AnalysedVideo } from '../../../src/shared/style-profile'
import type { AnalysisResult } from '../../../src/shared/video-analysis'

export function analysis(o: Partial<AnalysisResult> = {}): AnalysisResult {
  return {
    summary: 'Un documentaire court.',
    hook: { text: 'Et si tout était faux ?', endsAtS: 14, technique: 'question' },
    structure: [
      { fromS: 0, toS: 14, kind: 'hook', summary: 'La question.' },
      { fromS: 14, toS: 500, kind: 'body', summary: 'Le développement.' },
      { fromS: 500, toS: 600, kind: 'outro', summary: 'La conclusion.' }
    ],
    pacing: { cutsPerMinute: 12, tempo: 'medium', notes: '' },
    shotTypes: ['stock footage', 'animation', 'on-screen text'],
    onScreenText: [
      { atS: 5, text: 'LA VÉRITÉ SUR LE PHARE' },
      { atS: 100, text: '1850' }
    ],
    music: { present: true, mood: 'calme', notes: '' },
    callsToAction: [{ atS: 580, text: 'Abonne-toi.' }],
    ...o
  }
}

export const video = (a: AnalysisResult, o: Partial<AnalysedVideo> = {}): AnalysedVideo => ({ origin: 'competitor', outlier: false, durationS: 600, demo: false, analysis: a, ...o })

/** Three competitor videos (one an outlier) and two of the channel's own: a fast, drawn, question-led documentary style. */
export function fixtureVideos(): AnalysedVideo[] {
  return [
    video(analysis({ pacing: { cutsPerMinute: 20, tempo: 'fast', notes: '' }, shotTypes: ['Stock footage', 'animation', 'b-roll'], hook: { text: 'Pourquoi ce phare a-t-il disparu ?', endsAtS: 12, technique: 'Question' } }), {
      outlier: true,
      durationS: 540
    }),
    video(analysis({ pacing: { cutsPerMinute: 18, tempo: 'fast', notes: '' }, shotTypes: ['stock footage', 'animation'], hook: { text: 'Personne ne sait où il est.', endsAtS: 15, technique: 'question' } }), {
      durationS: 660
    }),
    video(analysis({ pacing: { cutsPerMinute: 8, tempo: 'slow', notes: '' }, shotTypes: ['talking head', 'screen recording'], hook: { text: 'Voici mon histoire.', endsAtS: 20, technique: 'story' }, callsToAction: [] }), {
      durationS: 900
    }),
    video(analysis({ pacing: { cutsPerMinute: 16, tempo: 'fast', notes: '' }, shotTypes: ['animation', 'stock footage'] }), { origin: 'own', durationS: 600 }),
    video(analysis({ pacing: { cutsPerMinute: 14, tempo: 'medium', notes: '' }, shotTypes: ['stock footage', 'infographie'], music: { present: false, mood: '', notes: '' } }), { origin: 'own', durationS: 480 })
  ]
}
