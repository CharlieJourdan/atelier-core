// Can Atelier make this style? (essais-utilisateur, Charlie 03/11: « dire tôt et honnêtement si le style est reproductible, en
// partie — quelles parties, quelle part — ou pas du tout, et pourquoi ; sinon proposer ce qu'Atelier sait faire à la place ;
// proposer des humains (la tête filmée, des parties de montage) ; lister les technologies qui manquent (importer, construire,
// entraîner, coût) ».) Twelve links pasted as a new user showed the proposal always said « la pipeline reprend ce style »: a
// studio cartoon, a 3D city timelapse, a podcast, a vlog and a music teaser were all « reproduced » at 65–80 / 100.
//
// The code reads what it can (the eyes' measures, the page's title, description and category) into traits, and from them the
// parts of the style, the share Atelier makes, the people and technologies it needs and what it can do instead. The agent then
// says it better in the same terms (its one call, prompt.ts): its verdict, share and parts are taken, but only ids from the lists
// below pass, and the verdict always follows the share. Pure: no I/O.
import type { VideoMeasure } from '../../../engine/technologies/fit'
import type { FeasibilityPartView, FeasibilityVerdictId, FeasibilityView, HumanStepView, InsteadView, MissingTechView } from '../../../shared/style-feasibility'

type Missing = Omit<MissingTechView, 'id'>
/** Technologies Atelier lacks, with what closing the gap costs (October–November 2026 order of magnitude). */
export const MISSING: Readonly<Record<string, Missing>> = {
  'character-animation': { title: 'Animation de personnages façon studio (dessin animé, combats, effets)', kind: 'build', cost: 'hors de portée aujourd’hui : un studio d’animation, des semaines de travail par minute ; les clips IA donnent des personnages qui changent d’un plan à l’autre', slot: false },
  'consistent-characters': { title: 'Personnages IA identiques d’un plan à l’autre', kind: 'train', cost: 'entraîner un modèle par personnage : ≈ 5 à 20 $ et une journée de réglage, puis ≈ 1 à 2 $ la minute de clips', slot: false },
  '3d-scenes': { title: 'Scènes 3D (villes, décors, véhicules) rendues par un moteur 3D', kind: 'build', cost: 'un moteur 3D (Blender) et des modèles ouverts (bâtiments OpenStreetMap) : plusieurs semaines de développement, puis ≈ 0,10 à 0,50 $ de calcul la minute', slot: false },
  '3d-characters': { title: 'Personnages 3D animés (cinématiques de jeu vidéo)', kind: 'build', cost: 'hors de portée aujourd’hui : animation 3D de personnages en studio ou moteur de jeu, des semaines par minute', slot: false },
  'licensed-footage': { title: 'Extraits d’une œuvre ou d’un média (film, série, interview, reportage)', kind: 'import', cost: 'gratuit : tu importes les extraits que tu as le droit d’utiliser ; Atelier les cale sur le script', slot: true },
  'live-action': { title: 'Scènes filmées (acteurs, mains, objets, décors réels)', kind: 'import', cost: 'gratuit : tu filmes ou fournis les plans ; Atelier les monte', slot: true },
  'own-presenter-footage': { title: 'Tes prises face caméra placées par la pipeline', kind: 'build', cost: 'quelques jours : caler tes prises filmées sur les passages « face caméra » du script, comme l’avatar ; aujourd’hui tes clips passent par la bibliothèque', slot: false },
  'rush-editing': { title: 'Montage de rushes longs (vlog, podcast à plusieurs caméras)', kind: 'build', cost: 'une à deux semaines : choisir les prises sur la transcription, couper les silences, changer de caméra sur qui parle ; puis quasi gratuit', slot: false },
  'original-music': { title: 'Musique originale (un morceau, un clip musical)', kind: 'import', cost: 'Atelier ne compose pas : tu apportes ton morceau ; son import dans la pipeline reste à faire (quelques heures)', slot: false },
  'whole-video-eyes': { title: 'Les yeux qui regardent la vidéo entière', kind: 'build', cost: 'en cours (chantier « regarder-videos ») : aujourd’hui seules les 5 premières minutes sont lues', slot: false }
}

/** People a pipeline may need, and how it takes their work. */
export const HUMANS: Readonly<Record<string, Omit<HumanStepView, 'id'>>> = {
  'presenter-filmed': { title: 'Ta tête filmée (face caméra)', how: 'Tu te filmes au téléphone sur les passages face caméra du script et tu importes les fichiers ; la pipeline monte les images autour. Sans tournage : ton visage cloné ou un présentateur IA, moins naturels.' },
  guests: { title: 'Toi et tes invités, enregistrés', how: 'Tu enregistres la conversation (audio ou vidéo) ; Atelier la découpe, l’illustre (documents, schémas, captures) et la sous-titre.' },
  'vlog-filming': { title: 'Tes rushes filmés', how: 'Tu filmes ta journée ; Atelier choisit les passages, coupe, sous-titre et ajoute la musique.' },
  'scenes-filmed': { title: 'Tes plans tournés (mains, objets, décors, acteurs)', how: 'Tu tournes ou fais tourner les plans ; tu les importes, Atelier les monte sur la voix ou la musique.' },
  animator: { title: 'Un animateur ou un studio', how: 'Il livre les scènes animées ; Atelier fait le script, la voix, le montage, les textes et le son autour.' },
  'footage-owner': { title: 'Toi, pour les extraits', how: 'Tu choisis et importes les extraits que tu as le droit d’utiliser ; Atelier les cale sur le script.' },
  'editor-review': { title: 'Une personne relit le montage', how: 'La vidéo s’arrête à l’étape « montage » : une personne regarde, demande des retouches ou valide avant le rendu final.' },
  musician: { title: 'Ton morceau ou ton artiste', how: 'Tu fournis la musique ; Atelier monte les images sur son rythme.' }
}

/** What Atelier does instead, with the ingredient option that does it (its price is the view's). */
export const INSTEAD: Readonly<Record<string, Omit<InsteadView, 'id' | 'perMinute'>>> = {
  revoice: { title: 'Tu envoies ton audio ou ton script', detail: 'Atelier garde ta voix ou la refait, illustre chaque phrase, anime et monte.', option: 'script-import' },
  'own-voice': { title: 'Ta voix sur ses images', detail: 'Tu t’enregistres ; Atelier cale les images, les textes et le montage dessus.', option: 'voice-import' },
  'own-footage': { title: 'Tu envoies tes images ou tes rushes', detail: 'Atelier les monte sur la voix, ajoute textes, cartes et musique.', option: 'pictures-import' },
  avatar: { title: 'Un présentateur IA à la place d’une personne filmée', detail: 'Un visage créé pour ta chaîne (ou le tien, cloné depuis un portrait) dit le script.', option: 'presenter-invented' },
  nearest: { title: 'La pipeline la plus proche que fait Atelier', detail: 'Même sujet, même ton et même rythme, avec des images qu’Atelier sait faire (ci-dessous).', option: null }
}

/** What the code reads in a reference: its measures and the words of its page (title, description, category, the eyes' summary). */
export interface FeasibilityInput {
  measures: readonly VideoMeasure[]
  /** Title, description, categories and the eyes' summary, in any language. */
  words: string
}

export interface Traits {
  presenter: number
  music: boolean
  crew: boolean
  conversation: boolean
  vlog: boolean
  monologue: boolean
  characters: boolean
  simpleDrawing: boolean
  threeD: boolean
  game: boolean
  licensed: boolean
  documentary: boolean
}

const avg = (xs: readonly number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)

/** The reference's traits, from its measures and its words. Pure. */
export function traitsOf(input: FeasibilityInput): Traits {
  const w = input.words.toLowerCase()
  const m = input.measures
  const presenter = avg(m.map((x) => x.presenterShare ?? 0))
  const kinds = (k: string): number => avg(m.map((x) => (x.kinds as Record<string, number> | undefined)?.[k] ?? 0))
  const look = m.map((x) => x.lookFamily ?? '').join(' ')
  const handheld = m.some((x) => x.camera === 'handheld')
  const conversation = /\bpodcast|\binterview|entretien|\binvit[ée]s?\b|\bguests?\b|\bconversation|\bdébat|\(with @|\bft\.|\bfeat\.|\breact(s|ion)?\b/.test(w)
  const threeD = /\b3d\b|cgi|unreal|blender|cinematic render|rendu 3d/.test(w) || /\b3d\b/.test(look)
  const game = /gameplay|video ?game|jeu vidéo|wishlist|\bsteam\b|free-to-play/.test(w)
  return {
    presenter,
    music: /\bmusic\b|clip officiel|official (music )?video|\balbum\b|vinyle|\bsingle\b|préco|\bteaser\b/.test(w),
    crew: /réalis[ée] par|directed by|\bdop\b|\bvfx\b|lead 2d|animatic|background artist|storyboard|3d \(|tournage/.test(w),
    conversation: conversation && presenter >= 0.2,
    vlog: /\bvlog\b|ma vie\b|daily life|day in (the|my) life|une journée/.test(w) || (handheld && presenter >= 0.4),
    monologue: presenter >= 0.85,
    characters: /\btrailer\b|bande[- ]annonce|épisode|\bepisode|animated series|série animée|\bcartoon|dessin animé|\banime\b|characters?\b|personnages?\b|toy line|\bmonsters?\b/.test(w),
    simpleDrawing: /hand-drawn|stick[- ]?figure|simple|doodle|croquis|whiteboard|minimalist|flat 2d/.test(w),
    threeD,
    game,
    licensed: /dessin animé|animated series|série animée|\bfilm\b|\bmovie\b|\bseries\b|\bsérie\b|bloomberg|\bbbc\b|\bcnn\b|al jazeera|reuters|news footage|extraits?/.test(w) && /histoire compl[eè]te|r[ée]cap|résumé|review|explained|historical overview|overview of the|analyse d|footage|extraits?|interview/.test(w),
    documentary: kinds('archive') + kinds('motion') + kinds('stock') >= 0.6 && /archive|period|vintage/.test(look + ' ' + w)
  }
}

/** The verdict follows the share; « reproductible » also needs every big part (a quarter of the video or more) made as it is. */
const verdictOf = (share: number, parts: readonly FeasibilityPartView[] = []): FeasibilityVerdictId =>
  share >= 70 && !parts.some((x) => x.share >= 25 && x.can !== 'yes') ? 'yes' : share >= 30 ? 'partial' : 'no'
/** A reproducible style needs no one but, at most, a person who reviews the edit or films their own head. */
const HUMANS_WHEN_YES = new Set(['editor-review', 'presenter-filmed'])
const r5 = (x: number): number => Math.max(0, Math.min(100, Math.round(x / 5) * 5))

/** The code's judgement, from the traits: parts, share, missing technologies, people, what instead. Pure. */
export function assessFeasibility(inputs: readonly FeasibilityInput[], unread: string | null = null): FeasibilityView | null {
  const read = inputs.filter((i) => i.measures.length > 0 || i.words.trim().length > 0)
  if (read.length === 0) return null
  const t = traitsOf({ measures: read.flatMap((i) => i.measures), words: read.map((i) => i.words).join('\n') })
  const parts: FeasibilityPartView[] = []
  const missing = new Set<string>()
  const humans = new Set<string>()
  const instead = new Set<string>()
  // what is on screen weighs 70 % of a style; the voice, the script and the editing the other 30 %
  const screen = 70
  const p = r5(t.presenter * screen)
  if (p > 0) {
    if (t.conversation) {
      parts.push({ title: 'Des personnes filmées qui discutent (podcast, interview)', share: p, can: 'no', how: 'Atelier n’invente pas une conversation entre de vraies personnes : il monte la tienne.' })
      humans.add('guests').add('editor-review')
      missing.add('rush-editing')
      instead.add('own-footage').add('revoice')
    } else if (t.vlog) {
      parts.push({ title: 'La personne filmée dans sa vie (vlog)', share: p, can: 'no', how: 'Un vlog, ce sont tes journées filmées : Atelier les monte, il ne les invente pas.' })
      humans.add('vlog-filming')
      missing.add('rush-editing')
      instead.add('own-footage')
    } else {
      parts.push({ title: 'Le présentateur face caméra', share: p, can: 'partial', how: 'Un présentateur IA ou ton visage cloné le remplacent ; filmé par toi, c’est le plus naturel.' })
      humans.add('presenter-filmed')
      missing.add('own-presenter-footage')
      instead.add('avatar')
    }
  }
  const rest = screen - p
  if (rest > 0) {
    let can: FeasibilityVerdictId = 'yes'
    let title = 'Les images'
    let how = 'Archives, banques libres, images générées et cartes animées : ce que fait Atelier.'
    if (t.music || t.crew) {
      can = 'no'
      title = 'Des images tournées et animées par une équipe (réalisation, décors, effets)'
      how = 'Une œuvre faite à la main par des artistes : Atelier peut monter tes plans, pas les créer.'
      missing.add('live-action')
      humans.add('scenes-filmed').add('animator')
      instead.add('own-footage')
      if (t.music) {
        missing.add('original-music')
        humans.add('musician')
      }
    } else if (t.licensed) {
      can = 'no'
      title = 'Des extraits d’une œuvre ou d’un média (film, série, interview)'
      how = 'Ces images appartiennent à d’autres : tu importes les extraits que tu as le droit d’utiliser.'
      missing.add('licensed-footage')
      humans.add('footage-owner')
      instead.add('own-footage')
    } else if (t.threeD && (t.characters || t.game)) {
      can = 'no'
      title = 'Des scènes 3D avec personnages animés'
      how = 'Des cinématiques 3D faites en moteur de jeu : Atelier n’a pas d’animation 3D de personnages ; des archives et des cartes peuvent raconter les mêmes histoires.'
      missing.add('3d-characters')
      instead.add('nearest')
    } else if (t.threeD) {
      can = 'partial'
      title = 'Des décors et des scènes en 3D'
      how = 'Des clips IA approchent l’ambiance, sans la précision d’un vrai rendu 3D.'
      missing.add('3d-scenes')
      instead.add('nearest')
    } else if (t.characters && !t.simpleDrawing) {
      can = 'no'
      title = 'Des personnages animés façon studio'
      how = 'Une animation de personnages en studio : hors de portée d’Atelier aujourd’hui.'
      missing.add('character-animation').add('consistent-characters')
      humans.add('animator')
      instead.add('nearest')
    } else if (t.characters || t.simpleDrawing) {
      can = 'partial'
      title = 'Des dessins simples avec des personnages récurrents'
      how = 'La pipeline Animation dessine des personnages simples en 2D ; ils ne sont pas toujours identiques d’un plan à l’autre.'
      missing.add('consistent-characters')
    }
    parts.push({ title, share: rest, can, how })
  }
  const voiceCan: FeasibilityVerdictId = t.conversation ? 'no' : t.music ? 'no' : 'yes'
  parts.push({
    title: t.music ? 'La musique et le son' : 'La voix, le script et le montage',
    share: 100 - screen,
    can: voiceCan,
    how: voiceCan === 'yes' ? 'Script, voix (IA, clonée ou la tienne), rythme des plans, textes et musique : ce que fait Atelier.' : t.music ? 'Le morceau est l’œuvre : Atelier ne compose pas.' : 'Les voix sont celles des personnes filmées.'
  })
  if (unread) missing.add('whole-video-eyes')
  const weight = (c: FeasibilityVerdictId): number => (c === 'yes' ? 1 : c === 'partial' ? 0.5 : 0)
  // nothing on screen made: the voice and the cuts alone are not the style (a cartoon re-voiced is not that cartoon)
  const blind = parts.slice(0, -1).every((x) => x.can === 'no')
  const share = r5(Math.min(blind ? 25 : 100, parts.reduce((a, x) => a + x.share * weight(x.can), 0)))
  const verdict = verdictOf(share, parts)
  if (verdict !== 'yes') instead.add('revoice')
  if (verdict === 'yes' && humans.size === 0) humans.add('editor-review')
  return build(verdict, share, whyOf(verdict, parts), parts, [...missing], [...humans], [...instead], unread, 'code')
}

function whyOf(verdict: FeasibilityVerdictId, parts: readonly FeasibilityPartView[]): string {
  const no = parts.filter((x) => x.can === 'no').map((x) => x.title.toLowerCase())
  const partial = parts.filter((x) => x.can === 'partial').map((x) => x.title.toLowerCase())
  if (verdict === 'yes') return partial.length ? `Atelier fait l’essentiel de ce style ; seul reste approché : ${partial.join(', ')}.` : 'Atelier fait ce style : ses images, sa voix et son montage sont dans ses bricks.'
  if (verdict === 'partial') return `Atelier fait une partie de ce style. ${no.length ? `Il ne fait pas : ${no.join(', ')}. ` : ''}${partial.length ? `Il approche : ${partial.join(', ')}.` : ''}`.trim()
  return `Ce style n’est pas reproductible par Atelier : ${no.join(', ') || 'ses images'}. Voici ce qu’il peut faire à la place.`
}

function build(verdict: FeasibilityVerdictId, share: number, why: string, parts: FeasibilityPartView[], missing: string[], humans: string[], instead: string[], unread: string | null, source: 'agent' | 'code'): FeasibilityView {
  return {
    verdict,
    share,
    why,
    parts,
    missing: missing.filter((id) => MISSING[id]).map((id) => ({ id, ...(MISSING[id] as Missing) })),
    humans: humans.filter((id) => HUMANS[id]).map((id) => ({ id, ...(HUMANS[id] as Omit<HumanStepView, 'id'>) })),
    instead: instead.filter((id) => INSTEAD[id]).map((id) => ({ id, ...(INSTEAD[id] as Omit<InsteadView, 'id' | 'perMinute'>), perMinute: null })),
    unread,
    source
  }
}

/** The agent's feasibility as its block gives it (prompt.ts), before checking. */
export interface AgentFeasibility {
  share?: unknown
  why?: unknown
  parts?: unknown
  missing?: unknown
  humans?: unknown
  instead?: unknown
}

const text = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)
const ids = (v: unknown, known: Readonly<Record<string, unknown>>): string[] => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && x in known))].slice(0, 6) : [])

/**
 * The agent's words over the code's judgement: its share, why and parts when they hold, its lists when they name known ids
 * (an unknown id never passes, an empty list keeps the code's). The verdict always follows the share. Pure.
 */
export function mergeAgentFeasibility(code: FeasibilityView | null, agent: AgentFeasibility | null | undefined): FeasibilityView | null {
  if (!agent || typeof agent !== 'object') return code
  const share = typeof agent.share === 'number' && Number.isFinite(agent.share) ? r5(agent.share) : null
  const why = text(agent.why, 400)
  if (share === null || !why) return code
  const parts: FeasibilityPartView[] = Array.isArray(agent.parts)
    ? (agent.parts as Record<string, unknown>[]).flatMap((x) => {
        const title = text(x?.title, 120)
        const can: FeasibilityVerdictId | null = x?.can === 'yes' || x?.can === 'partial' || x?.can === 'no' ? x.can : null
        const s = typeof x?.share === 'number' && Number.isFinite(x.share) ? r5(x.share) : null
        return title && can && s !== null ? [{ title, share: s, can, how: text(x?.how, 300) ?? '' }] : []
      }).slice(0, 6)
    : []
  const pick = (v: unknown, known: Readonly<Record<string, unknown>>, from: { id: string }[]): string[] => {
    const got = ids(v, known)
    return got.length > 0 ? got : from.map((x) => x.id)
  }
  const finalParts = parts.length > 0 ? parts : (code?.parts ?? [])
  const verdict = verdictOf(share, finalParts)
  const instead = pick(agent.instead, INSTEAD, code?.instead ?? [])
  const humans = pick(agent.humans, HUMANS, code?.humans ?? []).filter((id) => verdict !== 'yes' || HUMANS_WHEN_YES.has(id))
  return build(
    verdict,
    share,
    why,
    finalParts,
    pick(agent.missing, MISSING, code?.missing ?? []),
    humans.length > 0 ? humans : verdict === 'yes' ? ['editor-review'] : [],
    verdict !== 'yes' && !instead.includes('revoice') ? [...instead, 'revoice'] : instead,
    code?.unread ?? null,
    'agent'
  )
}

/** The catalogue as the agent reads it (`id — title`), one line each. */
export const catalogueText = (): string =>
  [
    `missing technologies (id — what — kind):\n${Object.entries(MISSING).map(([id, m]) => `- ${id} — ${m.title} — ${m.kind}`).join('\n')}`,
    `people (id — who):\n${Object.entries(HUMANS).map(([id, h]) => `- ${id} — ${h.title}`).join('\n')}`,
    `instead (id — what Atelier does):\n${Object.entries(INSTEAD).map(([id, h]) => `- ${id} — ${h.title}`).join('\n')}`
  ].join('\n')
