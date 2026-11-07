// P2 look and script passes (chantier moteur-analyse): what a vision model names on the shot frames (presenter layout and
// framing, media origin, motion element) and what a language model reads in the transcript (parts, structure, hook,
// promise, payoff, chapters, CTA, tone, devices) — the parts of the analysis that need eyes or reading, never the times or
// the numbers (those are measured in measures.ts / audio.ts). Pure prompts and parsers; a malformed row is dropped and
// counted, never guessed. The model is any `Labeller` (src/engine/watch/label.ts): Haiku on the user's subscription in
// the app, or a subagent answering the same prompt in a proof.
import { z } from 'zod'
import { LAYOUTS, MEDIA_ORIGINS, type Layout, type MediaOrigin } from '../../../../shared/clone'
import { CUT_TYPES, MOTION_ELEMENT_TYPES } from '../../../../shared/clone/video-analysis'
import type { LogShot } from '../../../../shared/shot-log'
import { SHEET_COLS, SHEET_ROWS, type LookSheet } from './frames'

export const FRAMINGS = ['close', 'medium', 'wide'] as const
export const VIEWS = ['front', 'left', 'right', 'profile', 'back'] as const
export type MotionType = (typeof MOTION_ELEMENT_TYPES)[number]

export interface ShotLook {
  layout: Layout
  framing: (typeof FRAMINGS)[number] | null
  view: (typeof VIEWS)[number] | null
  origin: MediaOrigin
  motion: MotionType | null
  /** First person: the viewer's own hand or arm in the foreground (null when the answer had no such column). */
  pov?: boolean | null
  /** `deep` = sharp subject over a defocused background; `flat` = all equally sharp (null when not answered). */
  depth?: 'deep' | 'flat' | null
}

const fmt = (s: number): string => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`

/** The per-shot look prompt for some sheets (each sheet: SHEET_COLS × SHEET_ROWS shots, one frame each, left to right). */
export function shotLookPrompt(sheets: readonly LookSheet[], shots: readonly LogShot[]): string {
  const byN = new Map(shots.map((s) => [s.n, s]))
  const lines: string[] = []
  sheets.forEach((sh, i) => {
    lines.push(`Picture ${i + 1} (${sh.rel}): shots ${sh.shots[0]}–${sh.shots[sh.shots.length - 1]}, one cell per shot, ${SHEET_COLS} per row, ${SHEET_ROWS} rows, left to right then top to bottom.`)
    for (const n of sh.shots) {
      const s = byN.get(n)
      if (s) lines.push(`  #${n} ${fmt(s.startS)} ${s.lengthS.toFixed(1)}s kind=${s.kind} text=«${s.onScreenText.slice(0, 80)}»`)
    }
  })
  return [
    'You look at the shots of a video, one frame per shot, on contact sheets. Times are measured: never change, merge or split shots.',
    'Look at every picture first. Then for EVERY listed shot write ONE line: n|layout|framing|view|origin|motion|pov|depth',
    `- layout: where the person who presents the video (the host/narrator on camera, real or avatar) is: ${LAYOUTS.join(', ')} (full = he fills the frame; half-left/half-right = he takes one half, graphics the other; inset = small picture-in-picture; off = not on screen). Other people (archive, interviews) are NOT the presenter → off. A 3D-rendered or game-engine character (CGI soldiers, pilots, a cinematic's hero, even in close-up and talking) is NOT the presenter → off, origin 3d.`,
    `- framing (presenter only, else -): ${FRAMINGS.join(', ')}; view (presenter only, else -): ${VIEWS.join(', ')} (where his face points: front = to camera).`,
    `- origin of the picture: ${MEDIA_ORIGINS.join(', ')} (found = archive, stock, news, web; filmed = shot for this video, not the presenter; generated = AI image or video; drawn = flat 2D illustration, cartoon, painting; 3d = 3D render (game-engine or CGI scenes, vehicles, characters: shaded volumes, rendered light and shadows, often a game look); motion = motion design, charts, maps, kinetic text; presenter = the presenter shot; screen = screen capture).`,
    '  generated vs found: a picture made for THIS story by an image or video model is generated — staged story moments (invented characters acting the narration, a couple in a dispute, a man at dusk in a wet street), too-clean cinematic light, the same painterly grade on every such shot, smooth skin, impossible or unbranded places. Real stock or archive (a recognisable real place, news, everyday b-roll with real camera noise) is found. Generated vs drawn or motion: flat colour fills, clean outlines, vector shapes, a character redrawn identically from shot to shot, halftone cut-out photos on paper are drawn (scenes, characters) or motion (cards, collages, numbers), never generated; a generated picture has fine texture everywhere and small deformations (hands, text). The presenter filmed from another angle or walking on his set is presenter, not filmed.',
    '- pov: hand when the picture is seen through the eyes of the viewer — his own hand or arm comes into the frame from the bottom or a side and holds or touches something (a phone, a ticket, a card, a note); else -.',
    '- depth: deep when a sharp subject stands over a visibly blurred, defocused background (depth of field), flat when everything is equally sharp (flat vector art, a plain card, a screen).',
    `- motion: the main motion-design element on screen, one of ${MOTION_ELEMENT_TYPES.join(', ')}, or - when none.`,
    '',
    ...lines,
    '',
    'Answer ONLY with the lines, nothing else. Example: 12|off|-|-|found|-|-|flat'
  ].join('\n')
}

const pick = <T extends string>(list: readonly T[], v: string | undefined): T | null => (list as readonly string[]).includes((v ?? '').trim()) ? (v!.trim() as T) : null

/** Parses the per-shot look lines; returns the looks by shot number and how many lines were dropped. Pure. */
export function parseShotLooks(text: string): { looks: Map<number, ShotLook>; dropped: number } {
  const looks = new Map<number, ShotLook>()
  let dropped = 0
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim().replace(/^[-*`]+\s*/, '')
    if (!/^#?\d+\s*\|/.test(line)) continue
    const [n, layout, framing, view, origin, motion, pov, depth] = line.replace(/^#/, '').split('|').map((x) => x.trim())
    const l = pick(LAYOUTS, layout)
    const o = pick(MEDIA_ORIGINS, origin)
    const num = Number(n)
    if (!Number.isInteger(num) || num < 1 || !l || !o) { dropped++; continue }
    looks.set(num, {
      layout: l,
      framing: l === 'off' ? null : pick(FRAMINGS, framing),
      view: l === 'off' ? null : pick(VIEWS, view),
      origin: o,
      motion: pick(MOTION_ELEMENT_TYPES, motion),
      // the two later columns only when the answer has them (an older answer says nothing about them)
      ...(pov !== undefined ? { pov: /^hand$/i.test(pov) } : {}),
      ...(depth !== undefined ? { depth: pick(['deep', 'flat'] as const, depth) } : {})
    })
  }
  return { looks, dropped }
}

/** The global look: identity, palette, fonts, texture, easing, colour, transitions, thumbnail. */
export const GlobalLook = z.object({
  identity: z.object({ age: z.string(), gender: z.string(), face: z.string(), hair: z.string(), wardrobe: z.string(), setting: z.string(), lighting: z.string(), shots: z.array(z.number().int()).default([]) }).nullable(),
  /** Whether the presenter is a filmed person or an avatar (null when none). */
  presenterKind: z.enum(['real', 'avatar']).nullable(),
  palette: z.array(z.string()).default([]),
  fonts: z.array(z.string()).default([]),
  texture: z.string().default(''),
  easing: z.string().default(''),
  colour: z.string().default(''),
  transitions: z.array(z.enum(CUT_TYPES)).default([]),
  thumbnailPattern: z.string().default(''),
  /** The look of the pictures the reference GENERATES (AI images or video), as an image-prompt line (moteur-briques); '' when none. */
  generatedLook: z.string().optional(),
  /** Set by the second look (eyes.ts withIdentity): the « presenter » shots show a drawn character of the story. */
  drawnPresenter: z.boolean().optional(),
  /** How drawn characters are drawn (moteur-pov-2), in a fixed vocabulary; absent when the video draws none. */
  figures: z.object({
    body: z.enum(['silhouette', 'clothed']),
    rim: z.boolean(),
    faces: z.enum(['expressive', 'eyes']),
    colour: z.enum(['hero', 'all'])
  }).nullable().optional()
})
export type GlobalLook = z.infer<typeof GlobalLook>

export function globalLookPrompt(o: { presenterSheet: string | null; sampleSheet: string; hookSheet: string; thumbnail: string | null; title: string }): string {
  return [
    `Video « ${o.title} ». Pictures: ${[o.presenterSheet && `presenter sheet ${o.presenterSheet} (shots where the presenter is on screen)`, `sample sheet ${o.sampleSheet} (shots spread over the whole video)`, `hook sheet ${o.hookSheet} (every 0.5 s of the opening)`, o.thumbnail && `thumbnail ${o.thumbnail}`].filter(Boolean).join('; ')}.`,
    'Look at every picture, then answer ONLY with JSON:',
    '{"identity": null or {"age":"35-45","gender":"man","face":"…","hair":"…","wardrobe":"…","setting":"…","lighting":"…","shots":[shot numbers that show him]},',
    ' "presenterKind": null or "real" (a filmed person) or "avatar" (an AI/animated presenter),',
    ' "palette": ["#hex", …] (the 3–6 dominant colours of the graphics and grade), "fonts": ["one entry per on-screen text face: <shape> <weight> <case> <decoration> <role>, shape among rounded sans, geometric sans, condensed sans, grotesque sans, serif, serif italic, script, mono — e.g. rounded sans bold capitals underlined title", "serif italic light title", "bold sans amounts"],',
    ' "texture": "flat / paper / grain / glossy…", "easing": "how graphics move: snappy ease-out, slow drift, pop…",',
    ` "colour": "the grade in a few words", "transitions": [cut types seen, among ${CUT_TYPES.join(', ')}], "thumbnailPattern": "what the thumbnail is made of",`,
    ' "generatedLook": "" or, when the video shows pictures made by an image or video model (staged story moments), their look written as an image-prompt line: medium (photoreal cinematic still, 3D render, painterly…), light and time of day, grade and palette, lens and depth of field, grain, framing, recurring settings — never a name, a brand or a real person",',
    ' "figures": null or, when the video DRAWS characters (2D figures, stick figures), how: {"body":"silhouette" (thin all-black bodies, at most a coloured top on some) or "clothed" (everyone wears coloured clothes), "rim": true when a light outline or rim light runs around them, "faces":"expressive" (a mouth and eyes that react) or "eyes" (eyes only), "colour":"hero" (only the main character wears a colour) or "all"}}',
    'Describe the presenter as a TYPE (age range, build, hair, clothes, set), never a name. identity is null when no presenter. A drawn or animated character of the story (a 2D or stick figure, a 3D-rendered or game-engine character, even in close-up) is NOT a presenter: identity and presenterKind are then null.'
  ].join('\n')
}

/** A second look at the presenter's own shots when the global pass (a sample of the whole video) gave no identity although
 *  the shot passes saw a person talking to camera (Finary v3: 41 presenter shots, none in the sample sheet). */
export const IdentityRead = GlobalLook.pick({ identity: true, presenterKind: true }).extend({
  /** moteur-pov-2: the face on these shots is a drawn or animated character of the story (a 2D figure), not a presenter. */
  drawn: z.boolean().optional()
})
export type IdentityRead = z.infer<typeof IdentityRead>

export function identityPrompt(o: { title: string; shots: readonly number[] }): string {
  return [
    `Video « ${o.title} ». The pictures are frames of shots ${o.shots.join(', ')}, where someone talks to the viewer.`,
    'Answer ONLY with JSON: {"identity": {"age":"35-45","gender":"man","face":"…","hair":"…","wardrobe":"…","setting":"…","lighting":"…","shots":[the shot numbers above that show the same person]},',
    ' "presenterKind": "real" (a filmed person) or "avatar" (an AI-made presenter video of a person), "drawn": true when the face is a DRAWN or animated character of the story (a 2D or stick figure, a cartoon, a 3D-rendered or game-engine character) — then identity and presenterKind are null}',
    'Describe the main person as a TYPE (age range, build, hair, clothes, set), never a name. identity is null only when no picture shows a person.'
  ].join('\n')
}

/** The presenter shots a second identity look is shown: up to `max` spread over the video. */
export function identityShots(looks: ReadonlyMap<number, ShotLook>, max = 6): number[] {
  // the shots the look calls « presenter »; none, the shots it sees someone on screen in (a presenter kind set on a video whose
  // shots it called otherwise: the second look must still see him, whatever his kind)
  let ns = [...looks].filter(([, l]) => l.origin === 'presenter').map(([n]) => n).sort((a, b) => a - b)
  if (ns.length === 0) ns = [...looks].filter(([, l]) => l.layout !== 'off').map(([n]) => n).sort((a, b) => a - b)
  if (ns.length <= max) return ns
  return Array.from({ length: max }, (_, k) => ns[Math.floor((k * (ns.length - 1)) / (max - 1))]!)
}

export function parseJsonObject<T>(text: string, schema: z.ZodType<T>): T | null {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const r = schema.safeParse(JSON.parse(text.slice(start, end + 1)))
    return r.success ? r.data : null
  } catch {
    return null
  }
}

/** The script reading: parts, structure and devices (times in seconds of the video). */
export const ScriptRead = z.object({
  hookEndS: z.number().min(0),
  promo: z.array(z.object({ fromS: z.number().min(0), toS: z.number().min(0), what: z.string().default('') })).default([]),
  endFromS: z.number().min(0).nullable(),
  structure: z.array(z.string()).min(1),
  hookPattern: z.string(),
  promise: z.string(),
  payoff: z.string(),
  chapters: z.array(z.object({ atS: z.number().min(0), title: z.string() })).default([]),
  cta: z.string(),
  tone: z.string(),
  devices: z.array(z.string()).default([]),
  titlePattern: z.string(),
  /** Whose voice: a real person recorded or a synthetic voice, with the clue. */
  voiceKind: z.enum(['real', 'synthetic', 'none']),
  voiceClue: z.string().default('')
})
export type ScriptRead = z.infer<typeof ScriptRead>

/** The transcript by shot, compacted (one line per ~15 s). */
export function transcriptLines(shots: readonly Pick<LogShot, 'startS' | 'words'>[], everyS = 15): string[] {
  const out: string[] = []
  let from = 0
  let buf: string[] = []
  for (const s of shots) {
    if (s.startS - from >= everyS && buf.length) { out.push(`[${fmt(from)}] ${buf.join(' ')}`); buf = []; from = s.startS }
    if (s.words.trim()) buf.push(s.words.trim())
  }
  if (buf.length) out.push(`[${fmt(from)}] ${buf.join(' ')}`)
  return out
}

export function scriptPrompt(o: { title: string; durationS: number; lines: readonly string[]; presenterOnScreenShare: number }): string {
  return [
    `Transcript of the whole video « ${o.title} » (${Math.round(o.durationS)} s), timed. The presenter is on screen ${Math.round(o.presenterOnScreenShare * 100)} % of the time.`,
    ...o.lines,
    '',
    'Read it all, then answer ONLY with JSON (times in seconds of the video):',
    '{"hookEndS": end of the hook (the opening before the video settles into its body),',
    ' "promo": [sponsor or self-promotion reads {"fromS","toS","what"}], "endFromS": start of the ending (conclusion + CTA) or null,',
    ' "structure": ["hook", "promise", …the parts in order], "hookPattern": "how it opens (pattern, not the topic)", "promise": "what the viewer is promised",',
    ' "payoff": "how it pays off", "chapters": [{"atS","title"}], "cta": "the call to action", "tone": "a few words",',
    ' "devices": ["recurring devices: rhetorical questions, running numbers, analogies…"], "titlePattern": "the pattern of the title (not the topic)",',
    ' "voiceKind": "real" | "synthetic" | "none", "voiceClue": "why (hesitations, breaths, mistakes = real; flawless uniform prosody = synthetic)"}'
  ].join('\n')
}
