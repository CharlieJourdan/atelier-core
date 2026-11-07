// The ingredients of a pipeline and where each can come from (parcours-utilisateur, Charlie 02/11: « pour chaque ingrédient, l'agent
// demande et propose les options réalistes : importer les miens, l'agent les trouve, les générer, cloner ce que j'ai déjà… sans me
// connaître »). Generic: the options are read from what the pipeline can actually do — its mix, its declared options, its bricks and
// inputs — never from a table per genre. Every option is checked (it applies to the pipeline) or not offered; an option far from what
// the references measured is kept but marked, and comes last. Pure: no I/O; the caller prices and times each option.
import { basePipeline } from './bases'
import { compileRecipe } from './compile'
import { applyOps, type EditOp } from './edit-ops'
import { medianOf, type VideoMeasure } from './fit'
import { optionProblem } from './options'
import type { RecipeDoc } from './recipe'
import type { TechnologyRegistry } from './registry'

export const INGREDIENTS = ['pictures', 'script', 'voice', 'presenter', 'branding', 'music', 'motion', 'editing'] as const
export type IngredientId = (typeof INGREDIENTS)[number]
/** Where an ingredient comes from: the owner's own, found by the agent, generated, cloned from what the owner has, or nothing. */
export type IngredientSource = 'import' | 'find' | 'generate' | 'clone' | 'none'

export interface IngredientOption {
  id: string
  source: IngredientSource
  /** In French, for the owner. */
  title: string
  detail: string
  ops: EditOp[]
  /** What the owner brings for it (their clips, scripts, a recording, a picture), in French; null: nothing. */
  needs: string | null
  /** The references measured something else: kept as a choice, never recommended. */
  far: boolean
  /** How it reads as a price lever, when the title alone would mislead (« ta propre voix : la voix ne coûte plus rien »). */
  lever?: string
}

export interface Ingredient {
  id: IngredientId
  title: string
  /** What the references do for it, in French (null: not measured). */
  reference: string | null
  /** The option the pipeline holds now. */
  current: string
  options: IngredientOption[]
}

/** The name of the brick just before `name` (where a brick that replaces it goes), or null. */
const before = (doc: RecipeDoc, name: string): string | null => {
  const i = doc.bricks.findIndex((b) => b.tech.startsWith(`${name}@`))
  return i > 0 ? (doc.bricks[i - 1]?.tech.split('@')[0] ?? null) : null
}

const PICTURE_KINDS = ['clipAi', 'imageAi', 'stock', 'archive', 'userFootage'] as const
const pct = (x: number): string => `${Math.round(x * 100)} %`
const r2 = (x: number): number => Math.round(x * 100) / 100
const known = <T>(xs: readonly (T | null | undefined)[]): T[] => xs.filter((x): x is T => x !== null && x !== undefined)

/** The references' median share of each picture kind (null: not measured). */
function refKinds(refs: readonly VideoMeasure[]): Record<string, number> | null {
  const withKinds = refs.filter((r) => r.kinds)
  if (withKinds.length === 0) return null
  const out: Record<string, number> = {}
  for (const k of [...PICTURE_KINDS, 'motion']) out[k] = medianOf(withKinds.map((r) => (r.kinds as Record<string, number>)[k] ?? 0)) ?? 0
  return out
}

/**
 * A share of cards no brick of the pipeline can draw (the eyes once read a Short's real clips as « 100 % animations »): those are
 * pictures to source, not cards.
 */
const orphanCards = (doc: RecipeDoc): number => {
  const motion = ((doc.mix as Record<string, unknown> | null | undefined)?.motion as number | undefined) ?? 0
  return motion > 0 && !doc.bricks.some((b) => b.tech.startsWith('motion.render@')) ? motion : 0
}

/** The mix with every picture share given to `to` (split as given), the presenter's and the cards' time kept. */
function picturesTo(doc: RecipeDoc, to: Partial<Record<(typeof PICTURE_KINDS)[number], number>>): EditOp | null {
  const mix = doc.mix as Record<string, unknown> | null | undefined
  if (!mix) return null
  const orphan = orphanCards(doc)
  const pictures = PICTURE_KINDS.reduce((a, k) => a + ((mix[k] as number | undefined) ?? 0), 0) + orphan
  if (pictures <= 0) return null
  const total = Object.values(to).reduce((a, b) => a + (b ?? 0), 0) || 1
  const next: Record<string, unknown> = { ...mix }
  for (const k of PICTURE_KINDS) delete next[k]
  if (orphan > 0) delete next.motion
  for (const [k, v] of Object.entries(to)) if ((v ?? 0) > 0) next[k] = r2((pictures * (v as number)) / total)
  // shot lengths are kept only for the kinds that remain
  const lengths = mix.shotLengthS as Record<string, number> | undefined
  if (lengths) {
    const kept = Object.fromEntries(Object.entries(lengths).filter(([k]) => k === 'presenter' || k in next))
    if (Object.keys(kept).length > 0) next.shotLengthS = kept
    else delete next.shotLengthS
  }
  return { op: 'setMix', mix: next as never } as EditOp
}

const sameShares = (doc: RecipeDoc, op: EditOp | null): boolean => {
  if (!op || op.op !== 'setMix' || !op.mix || !doc.mix) return false
  const a = doc.mix as Record<string, unknown>
  const b = op.mix as Record<string, unknown>
  return PICTURE_KINDS.every((k) => Math.abs(((a[k] as number) ?? 0) - ((b[k] as number) ?? 0)) < 0.01)
}

function pictures(doc: RecipeDoc, refs: readonly VideoMeasure[]): Ingredient | null {
  const mix = doc.mix as Record<string, number> | null | undefined
  if (!mix || (PICTURE_KINDS.every((k) => !mix[k]) && orphanCards(doc) === 0)) return null
  const rk = refKinds(refs)
  const clips = (mix.clipAi ?? 0) > 0 || (rk?.clipAi ?? 0) > 0.05
  // what the agent can find: archives for a period look, else free stock (clips when the pictures move)
  const archiveLook = (mix.archive ?? 0) > 0 || (rk?.archive ?? 0) > (rk?.stock ?? 0)
  const now = PICTURE_KINDS.filter((k) => (mix[k] ?? 0) > 0)
  const options: IngredientOption[] = [
    { id: 'pictures-import', source: 'import', title: 'Mes propres clips et images', detail: 'Ta bibliothèque de clips (gameplay, rushes, photos) : ce que tu as déjà, rien de généré.', ops: [picturesTo(doc, { userFootage: 1 })].filter(Boolean) as EditOp[], needs: 'tes clips ou images, ajoutés une fois à la bibliothèque de la chaîne', far: false },
    { id: 'pictures-find', source: 'find', title: archiveLook ? 'Archives trouvées par l’agent' : 'Clips et images libres trouvés par l’agent', detail: archiveLook ? 'Documents, photos et films d’époque libres de droits, avec leur licence : authentique, presque gratuit.' : 'Banques libres de droits (avec leur licence) : du vrai, pas du généré, presque gratuit.', ops: [picturesTo(doc, archiveLook ? { archive: 1 } : { stock: 1 })].filter(Boolean) as EditOp[], needs: null, far: rk !== null && ((archiveLook ? rk.archive : rk.stock) ?? 0) < 0.05 && (rk.userFootage ?? 0) < 0.3 },
    { id: 'pictures-generate', source: 'generate', title: clips ? 'Images et clips générés' : 'Images générées', detail: clips ? 'Chaque phrase illustrée sur mesure, des clips là où ça bouge ; le plus cher.' : 'Chaque phrase illustrée sur mesure, au style de la chaîne.', ops: [picturesTo(doc, clips ? { imageAi: 0.7, clipAi: 0.3 } : { imageAi: 1 })].filter(Boolean) as EditOp[], needs: null, far: rk !== null && (rk.imageAi ?? 0) + (rk.clipAi ?? 0) < 0.05 }
  ]
  const current = options.find((o) => sameShares(doc, o.ops[0] ?? null))?.id ?? 'pictures-keep'
  const list = current === 'pictures-keep' ? [{ id: 'pictures-keep', source: now.includes('userFootage') ? 'import' : now.some((k) => k === 'imageAi' || k === 'clipAi') ? 'generate' : 'find', title: 'Le mélange de la référence', detail: now.length > 0 ? `Comme mesuré : ${now.map((k) => `${KIND_FR[k]} ${pct(mix[k] ?? 0)}`).join(', ')}.` : 'Comme lu par les yeux : des animations que cette pipeline ne dessine pas. Choisis d’où viennent tes images.', ops: [], needs: null, far: false } as IngredientOption, ...options] : options
  return { id: 'pictures', title: 'Images et fonds', reference: rk ? `La référence : ${Object.entries(rk).filter(([, v]) => v > 0.04).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${KIND_FR[k] ?? k} ${pct(v)}`).join(', ')}.` : null, current, options: list }
}
const KIND_FR: Readonly<Record<string, string>> = { clipAi: 'clips générés', imageAi: 'images générées', stock: 'clips libres', archive: 'archives', userFootage: 'tes clips', motion: 'cartes animées' }

/** One option of a base's declared choice, as an ingredient option (null: the base does not declare it or the choice is not ready). */
function choice(doc: RecipeDoc, option: string, value: string | boolean, o: Omit<IngredientOption, 'ops'>): IngredientOption | null {
  const decl = (basePipeline(doc.base)?.options ?? []).find((x) => x.id === option)
  if (!decl || decl.kind === 'slider') return null
  const c = decl.choices.find((x) => x.value === value)
  if (!c || c.soon) return null
  return { ...o, ops: [{ op: 'setOption', option, value } as EditOp] }
}
const currentOf = (doc: RecipeDoc, option: string): unknown => {
  const decl = (basePipeline(doc.base)?.options ?? []).find((x) => x.id === option)
  return (doc.options as Record<string, unknown>)[option] ?? decl?.default
}

function script(doc: RecipeDoc): Ingredient | null {
  const options = [
    choice(doc, 'script', 'import', { id: 'script-import', source: 'import', title: 'J’importe mes scripts', detail: 'Ton texte, dit tel quel : ni rallongé ni réécrit. Gratuit.', needs: 'tes scripts (.txt ou .docx) à chaque vidéo', far: false }),
    choice(doc, 'script', 'agent', { id: 'script-agent', source: 'generate', title: 'L’agent les écrit', detail: 'Recherche, plan, accroche et script à partir d’un titre.', needs: null, far: false }),
    choice(doc, 'script', 'agent-review', { id: 'script-agent-review', source: 'generate', title: 'L’agent écrit, je valide', detail: 'Le script t’attend avant la voix : tu corriges, puis la vidéo se fait.', needs: null, far: false })
  ].filter((x): x is IngredientOption => x !== null)
  if (options.length < 2) return null
  const now = currentOf(doc, 'script')
  return { id: 'script', title: 'Scripts', reference: null, current: options.find((o) => o.ops[0]?.op === 'setOption' && o.ops[0].value === now)?.id ?? options[0]?.id ?? '', options }
}

function voice(doc: RecipeDoc, refs: readonly VideoMeasure[]): Ingredient | null {
  if (!doc.bricks.some((b) => b.tech.startsWith('voice.tts@'))) return null
  const wpm = medianOf(known(refs.map((r) => r.wordsPerMinute)))
  return {
    id: 'voice',
    title: 'Voix',
    reference: wpm !== null ? `La référence : une voix à ${Math.round(wpm)} mots par minute (jamais clonée : on refait le ton, pas la personne).` : null,
    current: 'voice-generate',
    options: [
      { id: 'voice-generate', source: 'generate', title: 'Une voix dessinée pour ta chaîne', detail: 'Une voix ai33 créée d’après le ton de la référence, la même à chaque vidéo.', ops: [], needs: null, far: false },
      { id: 'voice-clone', source: 'clone', title: 'Ta voix clonée', detail: 'Ta propre voix, refaite par la machine à chaque script : même prix, ton identité.', ops: [], needs: '1 minute de ta voix et ton accord coché, sur la page de la chaîne', far: false },
      { id: 'voice-import', source: 'import', title: 'Je m’enregistre', lever: 'Ta propre voix : la voix ne coûte plus rien', detail: 'Tu lis toi-même chaque script ; Atelier cale tout dessus. Le plus authentique, gratuit.', ops: [{ op: 'addBrick', tech: 'voice.own@1', after: before(doc, 'voice.tts') } as EditOp, { op: 'removeBrick', brick: 'voice.tts' } as EditOp], needs: 'ton enregistrement à chaque vidéo', far: false }
    ]
  }
}

function presenter(doc: RecipeDoc, reg: TechnologyRegistry, refs: readonly VideoMeasure[]): Ingredient | null {
  if (!doc.bricks.some((b) => reg.get(b.tech)?.engineFamily === 'presenter')) return null
  const share = medianOf(known(refs.map((r) => r.presenterShare)))
  const now = (doc.mix?.presenter as number | undefined) ?? 0
  const set = (s: number): EditOp => ({ op: 'setMix', kind: 'presenter', share: s }) as EditOp
  const options: IngredientOption[] = [
    { id: 'presenter-invented', source: 'generate', title: 'Un présentateur inventé', detail: 'Un visage créé pour ta chaîne, du même genre que la référence (jamais la personne de la référence).', ops: [], needs: null, far: false },
    { id: 'presenter-clone', source: 'clone', title: 'Mon visage cloné', detail: 'Toi à l’écran, généré à chaque vidéo à partir de ton portrait : ton identité, même prix.', ops: [], needs: 'ton portrait et ton accord coché, sur la page de la chaîne', far: false },
    ...(now > 0.12 ? [{ id: 'presenter-less', source: 'generate' as const, title: 'Moins de présentateur', detail: `${pct(now)} → ${pct(r2(now * 0.6))} du temps à l’écran : moins cher, plus d’images.`, ops: [set(r2(now * 0.6))], needs: null, far: share !== null && share > now * 0.9 }] : []),
    choice(doc, 'presenterShots', 'multi', { id: 'presenter-angles', source: 'generate', title: 'Plusieurs plans du présentateur', detail: 'Des angles alternés au lieu d’un seul plan : un rendu « émission ».', needs: null, far: false })
  ].filter((x): x is IngredientOption => x !== null)
  return { id: 'presenter', title: 'Présentateur', reference: share !== null ? `La référence : présentateur ${pct(share)} du temps.` : null, current: 'presenter-invented', options }
}

function branding(doc: RecipeDoc): Ingredient {
  const card = doc.bricks.some((b) => b.tech.startsWith('card.intro@'))
  if (card) {
    return {
      id: 'branding',
      title: 'Identité (photo, carte)',
      reference: null,
      current: 'branding-generate',
      options: [
        { id: 'branding-generate', source: 'generate', title: 'L’initiale de la chaîne', detail: 'La carte d’intro avec le nom et une pastille à l’initiale.', ops: [], needs: null, far: false },
        { id: 'branding-import', source: 'import', title: 'Ma photo de profil sur la carte', detail: 'Ta vraie photo de profil et ton nom : on te reconnaît dès la première seconde.', ops: [], needs: 'ta photo de profil, sur la page de la chaîne', far: false }
      ]
    }
  }
  return {
    id: 'branding',
    title: 'Identité (photo, carte)',
    reference: null,
    current: 'branding-none',
    options: [
      { id: 'branding-none', source: 'none', title: 'Pas de carte d’intro', detail: 'Comme la référence : la vidéo commence directement.', ops: [], needs: null, far: false },
      { id: 'branding-card', source: 'import', title: 'Une carte d’intro à mon nom', detail: 'Ton nom et ta photo de profil au début de chaque vidéo.', ops: [{ op: 'addBrick', tech: 'card.intro@1', after: doc.bricks.some((b) => b.tech.startsWith('motion.render@')) ? 'motion.render' : (doc.bricks.find((b) => b.tech.startsWith('visuals.fulfil@')) ? 'visuals.fulfil' : before(doc, 'captions.make')) } as EditOp], needs: 'ta photo de profil, sur la page de la chaîne', far: false }
    ]
  }
}

function music(doc: RecipeDoc): Ingredient | null {
  const options = [
    choice(doc, 'music', 'library', { id: 'music-find', source: 'find', title: 'L’agent choisit dans la bibliothèque', detail: 'Une musique libre de droits, basse sous la voix.', needs: null, far: false }),
    choice(doc, 'music', 'none', { id: 'music-none', source: 'none', title: 'Pas de musique', detail: 'La voix seule.', needs: null, far: false })
  ].filter((x): x is IngredientOption => x !== null)
  if (options.length < 2) return null
  const now = currentOf(doc, 'music')
  return { id: 'music', title: 'Musique', reference: null, current: now === 'none' ? 'music-none' : 'music-find', options }
}

function motion(doc: RecipeDoc, refs: readonly VideoMeasure[]): Ingredient | null {
  const draws = doc.bricks.some((b) => b.tech.startsWith('motion.render@'))
  if (!draws) return null
  const mix = doc.mix as Record<string, number> | null | undefined
  const now = mix?.motion ?? 0
  const rk = refKinds(refs)
  const main = Object.entries(mix ?? {}).filter(([k, v]) => typeof v === 'number' && PICTURE_KINDS.includes(k as never)).sort((a, b) => b[1] - a[1])[0]?.[0]
  const move = (to: number): EditOp[] => (mix && main ? [{ op: 'setMix', mix: { ...mix, motion: r2(to), [main]: r2((mix[main] ?? 0) + now - to) } as never } as EditOp] : [])
  const options: IngredientOption[] = [
    { id: 'motion-keep', source: 'generate', title: `Cartes animées comme la référence (${pct(now)})`, detail: 'Cartes, chiffres et frises dessinés par Atelier, gratuits.', ops: [], needs: null, far: false },
    ...(now + 0.15 <= 0.6 ? [{ id: 'motion-more', source: 'generate' as const, title: 'Plus de cartes animées', detail: `${pct(now)} → ${pct(now + 0.15)} : chaque chiffre, lieu et date se voit.`, ops: move(now + 0.15), needs: null, far: false }] : []),
    { id: 'motion-none', source: 'none', title: 'Pas de motion design', detail: 'Seulement des images : plus simple, plus rapide à fabriquer.', ops: move(0), needs: null, far: (rk?.motion ?? 0) > 0.1 }
  ]
  return { id: 'motion', title: 'Motion design', reference: rk ? `La référence : cartes animées ${pct(rk.motion ?? 0)} des images.` : null, current: 'motion-keep', options }
}

function editing(doc: RecipeDoc, refs: readonly VideoMeasure[]): Ingredient | null {
  const shot = medianOf(known(refs.map((r) => r.shotS)))
  const options = [
    choice(doc, 'editing', 'simple', { id: 'editing-simple', source: 'generate', title: 'Montage sobre', detail: 'Coupes franches sur la voix, mouvements lents.', needs: null, far: false }),
    choice(doc, 'editing', 'dynamic', { id: 'editing-dynamic', source: 'generate', title: 'Montage plus vivant', detail: 'Coupes plus rapides, zooms sur les mots forts ; un peu plus de fabrication.', needs: null, far: false }),
    choice(doc, 'captions', true, { id: 'editing-captions', source: 'generate', title: 'Avec sous-titres', detail: 'Les mots dits à l’écran : se regarde sans le son.', needs: null, far: false })
  ].filter((x): x is IngredientOption => x !== null)
  if (options.length < 2) return null
  const now = currentOf(doc, 'editing')
  return { id: 'editing', title: 'Montage', reference: shot !== null ? `La référence : un plan toutes les ${shot.toFixed(1).replace('.', ',')} s.` : null, current: now === 'dynamic' ? 'editing-dynamic' : 'editing-simple', options }
}

/** The same pipeline and references give the same ingredients: a study is read again and again (its variants, its view). */
const memo = new Map<string, Ingredient[]>()
const MEMO_MAX = 128

/** The ingredients of a pipeline, each with the options it can really take (checked), the far ones last. */
export function ingredientsOf(doc: RecipeDoc, reg: TechnologyRegistry, refs: readonly VideoMeasure[]): Ingredient[] {
  const key = JSON.stringify([doc, refs])
  const hit = memo.get(key)
  if (hit) return hit
  const out = computeIngredients(doc, reg, refs)
  if (memo.size >= MEMO_MAX) memo.delete(memo.keys().next().value as string)
  memo.set(key, out)
  return out
}

function computeIngredients(doc: RecipeDoc, reg: TechnologyRegistry, refs: readonly VideoMeasure[]): Ingredient[] {
  const decls = basePipeline(doc.base)?.options ?? []
  const checkOption = (id: string, v: unknown): string | null => optionProblem(decls, id, v)
  const all = [pictures(doc, refs), script(doc), voice(doc, refs), presenter(doc, reg, refs), branding(doc), music(doc), motion(doc, refs), editing(doc, refs)]
  const out: Ingredient[] = []
  for (const ing of all) {
    if (!ing) continue
    // offered only when the pipeline still applies AND compiles with it (a brick out of its stage is never proposed)
    const options = ing.options.filter((o) => {
      if (o.ops.length === 0) return true
      const r = applyOps(doc, o.ops, reg, { checkOption })
      // a brick added or removed may land out of its stage: those are compiled; a declared value or a share is checked by applyOps
      const moves = o.ops.some((op) => op.op === 'addBrick' || op.op === 'removeBrick' || op.op === 'moveBrick')
      return r.ok && (!moves || compileRecipe(r.doc, reg, { id: 'check' }).ok)
    })
    if (options.length < 2) continue
    out.push({ ...ing, options: [...options.filter((o) => !o.far), ...options.filter((o) => o.far)] })
  }
  return out
}

/** The pipeline with the chosen option of each ingredient applied (an option that no longer applies is skipped). */
export function withIngredients(doc: RecipeDoc, chosen: Readonly<Record<string, string>>, reg: TechnologyRegistry, refs: readonly VideoMeasure[] = []): RecipeDoc {
  const decls = basePipeline(doc.base)?.options ?? []
  let cur = doc
  for (const ing of ingredientsOf(doc, reg, refs)) {
    const o = ing.options.find((x) => x.id === chosen[ing.id])
    if (!o || o.id === ing.current || o.ops.length === 0) continue
    const r = applyOps(cur, o.ops, reg, { checkOption: (id, v) => optionProblem(decls, id, v) })
    if (r.ok) cur = r.doc
  }
  return cur
}
