// The sheet a channel starts from when it has no style yet (the user then edits and saves it as version 1).
import type { StyleSheet } from '../../../../shared/analysis'

export function blankStyle(name: string, niche: string): StyleSheet {
  return {
    $schema: 'atelier.style/1',
    identity: { name: name || 'Ma chaîne', niche, language: 'fr', audience: '' },
    voice: { source: 'platform', voiceId: 'demo-claire', speed: 1, stability: 0.6 },
    script: { structure: ['Accroche', 'Contexte', 'Développement', 'Conclusion'], hook: '', tone: '', wpm: 150, lengthMin: 8, forbidden: [], skills: ['hook', 'retention'] },
    visuals: { mix: { stock: 0.5, ai_image: 0.4, ai_video: 0, animation: 0.1, footage: 0, avatar: 0 }, palette: [], fonts: ['Inter'], grade: '' },
    animation: { kit: '', settings: '' },
    captions: { preset: 'highlight', position: 'bottom', wordsPerLine: 6, highlight: true },
    sound: { mood: '', volume: 0.25, duckDb: 12 },
    pace: { cutsPerMinute: 12, minShotS: 2, maxShotS: 7 },
    thumbnail: { layout: '', textRules: '', colors: [], face: false },
    packaging: { titleRules: '', descriptionTemplate: '' },
    budget: { mode: 'usage_max', capCredits: null }
  }
}
