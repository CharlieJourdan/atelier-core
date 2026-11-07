// The look-alike placeholder presenter (chantier B, spec §2 P4, Charlie's review of 2026-11-04): when the reference is not
// the user's channel, a PROVISIONAL presenter of the same type (age, gender, hair, wardrobe, set, lighting, framing) with
// the measured number of angles stands in until the user supplies his own. It is built from WORDS only: no frame of the
// third party is ever sent to an image model, and the prompt forbids resembling any real person. Clearly marked as a
// placeholder on screen. The spec is pure; `LookAlikeMaker` makes it through the existing presenter bricks (a portrait
// from words, then its angles) behind an injected port.
import { createHash } from 'node:crypto'
import type { LookAlikeSpec, StyleDefinition } from '../../../../shared/clone'

export type Identity = { age: string; gender: string; face: string; hair: string; wardrobe: string; setting: string; lighting: string }
type Configuration = StyleDefinition['presenter']['configurations']['value'][number]

export const PLACEHOLDER_LABEL = 'Présentateur provisoire — remplacez-le par le vôtre'

/** Words that would aim the prompt at a real person or reuse a picture: refused in identity descriptors. */
const UNSAFE = /(https?:\/\/|\.jpe?g\b|\.png\b|\.webp\b|[\\/]frames?[\\/]|\blooks? like\b|\bresembl|\bcelebrity\b|\bfamous\b)/i

/** True when every descriptor is plain words (no URL, no file, no « looks like X »). */
export function safeDescriptors(identity: Partial<Record<string, string>>): boolean {
  return Object.values(identity).every((v) => typeof v !== 'string' || !UNSAFE.test(v))
}

/** The framing of the main portrait: the most used configuration's framing (medium when none). */
function mainFraming(configs: readonly Configuration[]): 'close' | 'medium' | 'wide' {
  const count = new Map<string, number>()
  for (const c of configs) count.set(c.framing, (count.get(c.framing) ?? 0) + 1)
  return ([...count].sort((a, b) => b[1] - a[1])[0]?.[0] as 'close' | 'medium' | 'wide' | undefined) ?? 'medium'
}

/** The placeholder of the same type as the measured presenter, with one prompt per measured angle. */
export function lookAlikeSpec(identity: Identity, configurations: readonly Configuration[], angleCount: number, standsInFor: string): LookAlikeSpec {
  const clean: Identity = { ...identity }
  for (const k of Object.keys(clean) as (keyof Identity)[]) if (UNSAFE.test(clean[k])) clean[k] = ''
  const framing = mainFraming(configurations)
  const type = { age: clean.age, gender: clean.gender, hair: clean.hair, wardrobe: clean.wardrobe, setting: clean.setting, lighting: clean.lighting, framing }
  const who = [clean.gender && `a ${clean.gender}`, clean.age && `aged ${clean.age}`, clean.hair && `${clean.hair} hair`].filter(Boolean).join(', ') || 'a presenter'
  const portraitPrompt = [
    `An invented person who exists nowhere: ${who}`,
    clean.wardrobe && `wearing ${clean.wardrobe}`,
    clean.setting && `in ${clean.setting}`,
    clean.lighting && `lit by ${clean.lighting}`,
    `${framing} framing, looking at the camera, natural expression`,
    'must not resemble any real or famous person; no text, no logo'
  ].filter(Boolean).join('; ')
  // One angle per measured angle: the configurations say which framing each angle uses.
  const byAngle = new Map<number, 'close' | 'medium' | 'wide'>()
  for (const c of configurations) if (!byAngle.has(c.angle)) byAngle.set(c.angle, c.framing)
  const n = Math.max(angleCount, byAngle.size)
  const order = ['medium', 'close', 'wide'] as const
  const angles = Array.from({ length: n }, (_, angle) => {
    const f = byAngle.get(angle) ?? order[angle % order.length]!
    return { angle, framing: f, prompt: `the same invented person, same clothes and same place, ${f} shot${angle === 0 ? ', the main portrait' : `, camera angle ${angle + 1} of ${n}, a different position in the same room`}` }
  })
  return { placeholder: true, standsInFor, type, portraitPrompt, angles, label: PLACEHOLDER_LABEL }
}

/** Identity + angles packed into the services' `lookAlike(identity)` record (the frozen contract takes strings only). */
export function packIdentity(spec: LookAlikeSpec): Record<string, string> {
  return { ...spec.type, portraitPrompt: spec.portraitPrompt, angles: JSON.stringify(spec.angles), placeholder: 'true', standsInFor: spec.standsInFor }
}

/** The presenter bricks the maker drives (the assembler wires ChannelPresenters.portrait / .angles behind it). */
export interface PresenterPicturesPort {
  /** A portrait made from words only; returns the new presenter's reference. */
  portrait(prompt: string, name: string): Promise<string>
  /** The angle pictures of that presenter (one per prompt). */
  angles(ref: string, angles: readonly { framing: 'close' | 'medium' | 'wide'; prompt: string }[]): Promise<number>
}

/** Makes the placeholder through the presenter bricks; deterministic id from the spec (same type → same placeholder). */
export class LookAlikeMaker {
  constructor(private readonly port: PresenterPicturesPort) {}

  async make(identity: Record<string, string>): Promise<{ ref: string; description: string; angles: number }> {
    const { portraitPrompt: _p, angles: _a, ...descriptors } = identity
    if (!safeDescriptors(descriptors)) throw new Error('look-alike refused: the descriptors point at a real person or a picture')
    const angles = identity['angles'] ? (JSON.parse(identity['angles']) as LookAlikeSpec['angles']) : []
    const prompt = identity['portraitPrompt'] ?? lookAlikeSpec(identity as unknown as Identity, [], 1, 'presenter').portraitPrompt
    const key = createHash('sha256').update(prompt + JSON.stringify(angles)).digest('hex').slice(0, 10)
    const ref = await this.port.portrait(prompt, `placeholder-${key}`)
    const made = angles.length > 1 ? await this.port.angles(ref, angles.slice(1)) : 0
    const who = [identity['gender'], identity['age'], identity['wardrobe']].filter(Boolean).join(', ')
    return { ref, description: `placeholder look-alike (${who || 'same type'}), ${1 + made} picture(s): ${PLACEHOLDER_LABEL}`, angles: 1 + made }
  }
}
