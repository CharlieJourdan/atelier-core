// Demo fixtures, lab: the technologies of the code registry as the panel and the editor see them (`TechnologyInfo`). The
// real list is built in main from the engine's registry (not browser-safe); this is a compact copy of its shape, with the
// same names, stages and families as the bricks the base pipelines use. Plus two small helpers the lab files share: a
// pipeline code from a document, and inline SVG pictures (no binary asset, no remote URL: the CSP takes data: only).
import type { EngineFamily } from '../../../shared/cloud-engines'
import type { StyleFamily } from '../../../shared/brick-styles'
import type { RecipeStage, TechField, TechnologyInfo } from '../../../shared/recipes'

type Row = [id: string, stage: RecipeStage, kind: string, engine: EngineFamily | null, style: StyleFamily | null, fields: TechField[], extra?: Partial<TechnologyInfo>]

const num = (key: string, min: number, max: number, def: number, channel = false): TechField => ({ key, type: 'number', min, max, default: def, recipe: true, channel })
const int = (key: string, min: number, max: number, def: number): TechField => ({ key, type: 'integer', min, max, default: def, recipe: true, channel: false })
const bool = (key: string, def: boolean): TechField => ({ key, type: 'boolean', default: def, recipe: true, channel: false })
const pick = (key: string, options: string[], channel = false): TechField => ({ key, type: 'enum', options, recipe: true, channel })
const str = (key: string, channel = true): TechField => ({ key, type: 'string', recipe: true, channel })

const input = (id: string, label: string, required = false) => ({ id, label, required })

const ROWS: Row[] = [
  ['idea.brief@1', 'idee', 'idea', null, null, [], { inputs: [input('topic', 'Titre (l’idée)', true), input('brief', 'Brief')] }],
  ['idea.research@1', 'idee', 'research', 'llm', null, [int('maxSearches', 0, 12, 8), bool('requireSources', true)], { inputs: [input('topic', 'Sujet ou titre', true)] }],
  ['idea.support@1', 'idee', 'idea', null, null, [int('maxVideos', 0, 5, 2)], { inputs: [input('supportVideos', 'Vidéos d’appui')] }],
  ['script.write@1', 'script', 'script', 'llm', 'script', [bool('revise', true), pick('ctaMode', ['none', 'end', 'mid_end'], true)], { superseded: true }],
  ['script.write@2', 'script', 'script', 'llm', 'script', [bool('revise', true), pick('ctaMode', ['none', 'end', 'mid_end'], true), int('hookWords', 20, 120, 60)]],
  ['script.import@1', 'script', 'script', 'llm', null, [], { inputs: [input('script', 'Script', true)] }],
  ['script.pasted@1', 'script', 'script', null, null, [], { inputs: [input('script', 'Script', true)] }],
  ['script.sponsor@1', 'script', 'sponsor', 'llm', null, [int('maxSeconds', 10, 90, 45)], { inputs: [input('sponsor', 'Le partenaire de la vidéo')] }],
  ['script.factcheck@1', 'script', 'factcheck', 'llm', null, [int('maxClaims', 3, 30, 12)]],
  ['script.translate@1', 'script', 'translate', 'llm', null, [int('chunkWords', 150, 1500, 500)]],
  ['voice.tts@1', 'voix', 'voice', 'voice', null, [str('voice'), num('speed', 0.7, 1.2, 1, true), num('maxPauseS', 0.2, 3, 0.6)]],
  ['voice.own@1', 'voix', 'voice', null, null, [], { status: 'draft', inputs: [input('recording', 'Ton enregistrement', true)] }],
  ['words.align@1', 'voix', 'timing', null, null, [num('minMatch', 0.3, 1, 0.8)]],
  ['director.plan@1', 'realisateur', 'director', 'llm', 'director', [num('cpm', 4, 40, 12), num('stockShare', 0, 1, 0.3), pick('layouts', ['full', 'split', 'corner', 'all'])]],
  ['director.pov@1', 'realisateur', 'director', 'llm', null, [num('cpm', 4, 40, 18)]],
  ['visuals.fulfil@1', 'elements', 'visuals', 'image', 'image', [pick('quality', ['low', 'medium', 'high']), int('maxImages', 4, 200, 80)]],
  ['clip.make@1', 'elements', 'visuals', 'clip', 'clip', [num('seconds', 3, 10, 5), int('maxClips', 0, 60, 20)]],
  ['avatar.speak@1', 'elements', 'avatar', 'presenter', 'presenter', [pick('generation', ['once', 'continuous'])], { inputs: [input('avatar', 'Le présentateur de la chaîne', true)] }],
  ['motion.render@1', 'elements', 'motion', null, null, [int('maxShots', 0, 40, 8)]],
  ['background.clips@1', 'elements', 'background', null, null, [bool('loop', true)], { inputs: [input('gameplay', 'Vidéos de fond', true)] }],
  ['card.intro@1', 'elements', 'card', null, null, [num('seconds', 1, 6, 3)], { inputs: [input('channel', 'Nom de la chaîne (carte d’intro)'), input('channelAvatar', 'Image de la chaîne (carte d’intro)')] }],
  ['captions.make@1', 'montage', 'captions', null, 'edit', [int('wordsPerLine', 1, 12, 4), pick('position', ['bottom', 'middle', 'top'], true), bool('highlight', true)]],
  ['edit.fx@1', 'montage', 'editing', null, 'edit', [pick('pace', ['simple', 'dynamic'])]],
  ['edit.chapters@1', 'montage', 'chapters', null, 'edit', [int('minChapterS', 30, 600, 90)]],
  ['edit.sponsor@1', 'montage', 'sponsor', null, null, [], { inputs: [input('sponsor', 'Le partenaire de la vidéo')] }],
  ['sound.music@1', 'montage', 'music', 'music', null, [num('volume', 0, 1, 0.18, true), num('duckDb', 0, 30, 12)], { inputs: [input('channelMusic', 'Musique de la chaîne')] }],
  ['render.assemble@1', 'montage', 'render', null, 'edit', [pick('resolution', ['720p', '1080p', '1440p']), int('fps', 24, 60, 30)]],
  ['qc.check@1', 'controle', 'qc', null, null, [bool('strict', false)]],
  ['thumbnail.make@1', 'controle', 'thumbnail', 'image', 'image', [int('variants', 1, 4, 2), bool('face', true)]],
  ['package.youtube@1', 'controle', 'package', null, null, [int('tags', 0, 30, 12)]]
]

const CLOUD: Partial<Record<EngineFamily, string[]>> = {
  llm: ['llm.text'],
  voice: ['voice.tts'],
  image: ['image.generate'],
  clip: ['clip.generate'],
  presenter: ['presenter.speak'],
  music: ['music.library']
}

export const DEMO_TECHNOLOGIES: TechnologyInfo[] = ROWS.map(([id, stage, kind, engineFamily, styleFamily, fields, extra]) => {
  const [name = id, v = '1'] = id.split('@')
  return {
    id,
    name,
    version: Number(v),
    labelKey: `tech.${name}`,
    stage,
    kind,
    nodeTypes: [name.replace('.', '_')],
    fields,
    inputs: [],
    cloudUsages: engineFamily ? (CLOUD[engineFamily] ?? []) : [],
    agentTools: kind === 'script' ? ['script.save'] : [],
    access: 'everyone',
    status: 'validated',
    engineFamily,
    styleFamily,
    superseded: false,
    ...extra
  }
})

export const techOf = (id: string): TechnologyInfo | undefined => DEMO_TECHNOLOGIES.find((t) => t.id === id)

/** A short code (`7K2Q-9XPM`) from any text: the pipeline code of a document, stable for the same document. */
export function codeOf(text: string): string {
  const ALPHA = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'
  let h = 2166136261
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619) >>> 0
  let out = ''
  for (let i = 0; i < 8; i++) {
    out += ALPHA[h % ALPHA.length]
    h = Math.imul(h ^ (h >>> 13), 2654435761) >>> 0
  }
  return `${out.slice(0, 4)}-${out.slice(4)}`
}

const escapeXml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** A 16:9 still: a two-colour gradient and a label (the demo's stand-in for a saved preview). */
export function svgStill(label: string, hue: number): string {
  const a = `hsl(${hue % 360} 62% 46%)`
  const b = `hsl(${(hue + 50) % 360} 70% 22%)`
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>` +
    `<rect width="320" height="180" fill="url(#g)"/><circle cx="262" cy="46" r="26" fill="#fff" opacity=".14"/>` +
    `<text x="18" y="160" font-family="system-ui,sans-serif" font-size="15" font-weight="600" fill="#fff">${escapeXml(label)}</text></svg>`
  )
}

/** A data URL of `svgStill` (for an `<img src>` a fixture carries directly). */
export function svgDataUrl(label: string, hue: number): string {
  let bin = ''
  for (const b of new TextEncoder().encode(svgStill(label, hue))) bin += String.fromCharCode(b)
  return `data:image/svg+xml;base64,${btoa(bin)}`
}

/** A hue from a text, so the same preview always has the same colours. */
export function hueOf(text: string): number {
  let h = 0
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) % 360
  return h
}
