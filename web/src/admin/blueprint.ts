// Blueprints: the default agent organisation and the preset pipelines every new workspace gets. The founder edits them here
// without code (form view or JSON), versions them and publishes a new version to every workspace.

export type Tier = 'fast' | 'balanced' | 'deep'
export type Runner = 'agent' | 'api' | 'code'
export type Validate = 'auto' | 'review'

/** What a step is in the app's drawing (the Cloud's `BLUEPRINT_NODE_KINDS`; a test keeps them equal). */
export type NodeKind =
  | 'idea'
  | 'script'
  | 'director'
  | 'avatar'
  | 'stock'
  | 'image-gen'
  | 'video-gen'
  | 'motion'
  | 'voice'
  | 'music'
  | 'gameplay'
  | 'card'
  | 'captions'
  | 'edit'
  | 'thumbnail'
  | 'qc'
  | 'publish'
  | 'translate'
  | 'human-input'
  | 'code'

export const NODE_KINDS: NodeKind[] = ['idea', 'script', 'director', 'avatar', 'stock', 'image-gen', 'video-gen', 'motion', 'voice', 'music', 'gameplay', 'card', 'captions', 'edit', 'thumbnail', 'qc', 'publish', 'translate', 'human-input', 'code']
export const KIND_LABEL: Record<NodeKind, string> = {
  idea: 'Sujet',
  script: 'Script',
  director: 'Réalisation',
  avatar: 'Avatar',
  stock: 'Archives',
  'image-gen': 'Images IA',
  'video-gen': 'Vidéo IA',
  motion: 'Animation',
  voice: 'Voix',
  music: 'Musique',
  gameplay: 'Gameplay',
  card: 'Carte',
  captions: 'Sous-titres',
  edit: 'Montage',
  thumbnail: 'Miniature',
  qc: 'Qualité',
  publish: 'Publication',
  translate: 'Traduction',
  'human-input': 'À fournir',
  code: 'Code (générique)'
}

export const TIERS: Tier[] = ['fast', 'balanced', 'deep']
export const RUNNERS: Runner[] = ['agent', 'api', 'code']
export const VALIDATES: Validate[] = ['auto', 'review']
export const TIER_LABEL: Record<Tier, string> = { fast: 'Rapide', balanced: 'Équilibré', deep: 'Approfondi' }
export const RUNNER_LABEL: Record<Runner, string> = { agent: 'Agent', api: 'API', code: 'Code' }
export const VALIDATE_LABEL: Record<Validate, string> = { auto: 'Auto', review: 'Je valide' }

export interface BlueprintAgent {
  id: string
  role: string
  tier: Tier
  routines: string[]
  instructions: string
}
export interface BlueprintNode {
  id: string
  label: string
  /** What the step is in the app's drawing. Absent: the app deduces it from the label (see `kindWarnings`). */
  kind?: NodeKind
  runner: Runner
  provider: string
  credits: number
  validate: Validate
}
export interface BlueprintPipeline {
  id: string
  name: string
  nodes: BlueprintNode[]
}
export interface Blueprint {
  version: number
  agents: BlueprintAgent[]
  pipelines: BlueprintPipeline[]
}

const agent = (id: string, role: string, tier: Tier, routines: string[], instructions: string): BlueprintAgent => ({ id, role, tier, routines, instructions })
const node = (id: string, label: string, runner: Runner, provider: string, credits: number, validate: Validate = 'auto'): BlueprintNode => ({
  id,
  label,
  runner,
  provider,
  credits,
  validate
})

/** Version 3, the one every workspace runs today. */
export const PUBLISHED_V3: Blueprint = {
  version: 3,
  agents: [
    agent('atlas', 'Agent principal', 'deep', ['Point du matin à 8 h', 'Résumé de la semaine le dimanche'], 'Tu coordonnes toutes les chaînes. Tu répartis le travail, tu poses une question seulement quand il manque une information, tu rends des comptes en deux phrases.'),
    agent('chef-chaine', 'Responsable de chaîne', 'balanced', ['Planifier la semaine le lundi', 'Vérifier le style avant chaque publication'], 'Tu connais le style, le public et les règles de ta chaîne. Tu planifies les vidéos et tu fais respecter le ton.'),
    agent('sujets', 'Recherche de sujets', 'fast', ['Chercher 10 sujets chaque lundi', 'Classer par potentiel'], 'Tu trouves des sujets qui ont déjà marché sur des chaînes comparables et tu les classes avec la raison du choix.'),
    agent('scenariste', 'Scénariste', 'balanced', ['Écrire le script après validation du sujet'], 'Tu écris un script clair, une accroche dans les dix premières secondes, un chiffre clé repris en conclusion. Pas de formule creuse.'),
    agent('realisateur', 'Réalisateur', 'balanced', ['Découper le script en plans', 'Choisir images et voix'], 'Tu découpes le script en scènes, tu choisis les images et la voix, tu respectes le budget en crédits annoncé.'),
    agent('monteur', 'Monteur', 'fast', ['Assembler et rendre sur le PC d’équipe'], 'Tu assembles la vidéo, tu règles le rythme, tu lances le rendu sur le PC d’équipe sauf demande contraire.'),
    agent('miniatures', 'Miniatures', 'balanced', ['Proposer trois miniatures par vidéo'], 'Tu proposes trois miniatures lisibles à petite taille, un texte de quatre mots au plus, une seule idée par image.'),
    agent('analyse', 'Analyse de la concurrence', 'fast', ['Regarder les nouvelles vidéos des concurrents chaque jour'], 'Tu regardes les vidéos des chaînes surveillées, tu notes l’accroche, le rythme et les ruptures, tu signales celles qui sortent du lot.'),
    agent('qualite', 'Contrôle qualité', 'fast', ['Relire chaque vidéo avant validation'], 'Tu vérifies l’orthographe, les chiffres, les droits des images et la cohérence entre voix et sous-titres avant de montrer la vidéo.')
  ],
  pipelines: [
    {
      id: 'documentaire-narre',
      name: 'Documentaire narré',
      nodes: [
        node('sujet', 'Sujet', 'agent', 'Claude Code', 0, 'review'),
        node('script', 'Script', 'agent', 'Claude Code', 0, 'review'),
        node('realisation', 'Réalisation', 'agent', 'Claude Code', 0),
        node('archives', 'Archives et B-roll', 'api', 'Pexels · Wikimedia', 40),
        node('images', 'Images IA', 'api', 'fal.ai · Nano Banana', 180),
        node('voix', 'Voix', 'api', 'MiniMax speech-2.8-hd', 140),
        node('montage', 'Montage', 'code', 'Moteur Atelier · PC d’équipe', 0),
        node('miniatures', 'Miniatures', 'api', 'fal.ai · Nano Banana Pro', 60, 'review'),
        node('qualite', 'Contrôle qualité', 'agent', 'Claude Code', 25)
      ]
    },
    {
      id: 'reddit-gameplay',
      name: 'Histoire Reddit + gameplay',
      nodes: [
        node('sujet', 'Sujet', 'agent', 'Claude Code', 0),
        node('script', 'Script', 'agent', 'Claude Code', 0, 'review'),
        node('voix', 'Voix', 'api', 'MiniMax speech-2.8-turbo', 24),
        node('images', 'Images IA', 'api', 'fal.ai · Nano Banana', 8),
        node('sous-titres', 'Sous-titres', 'api', 'AssemblyAI', 3),
        node('montage', 'Montage', 'code', 'Moteur Atelier · PC d’équipe', 0),
        node('qualite', 'Contrôle qualité', 'agent', 'Claude Code', 5)
      ]
    },
    {
      id: 'top-10',
      name: 'Top 10 illustré',
      nodes: [
        node('sujet', 'Sujet', 'agent', 'Claude Code', 0, 'review'),
        node('script', 'Script', 'agent', 'Claude Code', 0),
        node('images', 'Images IA', 'api', 'fal.ai · Nano Banana', 120),
        node('voix', 'Voix', 'api', 'MiniMax speech-2.8-hd', 70),
        node('montage', 'Montage', 'code', 'Moteur Atelier · PC d’équipe', 0),
        node('miniatures', 'Miniatures', 'api', 'fal.ai · Nano Banana Pro', 30, 'review')
      ]
    }
  ]
}

/** The unpublished draft: v3 plus three changes, so the publish dialog has a diff to show. */
export function makeDraftV4(): Blueprint {
  const d = structuredClone(PUBLISHED_V3)
  d.version = 4
  const qa = d.agents.find((a) => a.id === 'qualite')
  if (qa) qa.tier = 'balanced'
  const doc = d.pipelines.find((p) => p.id === 'documentaire-narre')
  if (doc) {
    const at = doc.nodes.findIndex((n) => n.id === 'montage')
    doc.nodes.splice(at, 0, node('sous-titres', 'Sous-titres', 'api', 'AssemblyAI', 6))
  }
  const reddit = d.pipelines.find((p) => p.id === 'reddit-gameplay')
  const voice = reddit?.nodes.find((n) => n.id === 'voix')
  if (voice) voice.credits = 18
  return d
}

export interface VersionEntry {
  version: number
  at: string
  by: string
  note: string
}
export const HISTORY: VersionEntry[] = [
  { version: 3, at: 'hier, 18:42', by: 'Charlie', note: 'Voix HD pour les documentaires' },
  { version: 2, at: '9 sept.', by: 'Charlie', note: 'Contrôle qualité avant chaque validation' },
  { version: 1, at: '12 août', by: 'Charlie', note: 'Organisation initiale : 9 agents, 3 pipelines' }
]

/* ------------------------------------------------------------------ validation */

export interface Issue {
  path: string
  message: string
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)
const nonEmpty = (x: unknown): x is string => typeof x === 'string' && x.trim().length > 0

/**
 * Where a JSON.parse error is, as " (ligne L, colonne C)". Engines word the error differently: Chromium gives
 * "(line L column C)", others give "at position N", recent V8 only quotes the text around the offending token.
 */
function locateSyntaxError(msg: string, text: string): string {
  const lc = /line (\d+) column (\d+)/.exec(msg)
  if (lc) return ` (ligne ${lc[1]}, colonne ${lc[2]})`
  let pos = -1
  const at = /position (\d+)/.exec(msg)
  if (at) pos = Number(at[1])
  else {
    const snippet = /"([\s\S]*)" is not valid JSON/.exec(msg)?.[1]
    const token = /token '([\s\S])'/.exec(msg)?.[1]
    const bare = snippet?.replace(/^\.\.\./, '')
    const start = bare === undefined ? -1 : text.indexOf(bare)
    if (bare !== undefined && start >= 0) pos = start + Math.max(0, token ? bare.indexOf(token) : 0)
  }
  if (pos < 0) return ''
  const before = text.slice(0, pos)
  return ` (ligne ${before.split('\n').length}, colonne ${pos - before.lastIndexOf('\n')})`
}

/** Parses the JSON text; a syntax error is reported with its line and column. */
export function parseBlueprintText(text: string): { value?: Blueprint; issues: Issue[] } {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'JSON invalide'
    const where = locateSyntaxError(msg, text)
    return { issues: [{ path: 'JSON', message: `Syntaxe invalide${where}` }] }
  }
  const issues = validateBlueprint(raw)
  return issues.length === 0 ? { value: raw as Blueprint, issues } : { issues }
}

export function validateBlueprint(x: unknown): Issue[] {
  const issues: Issue[] = []
  if (!isObj(x)) return [{ path: '$', message: 'Un objet est attendu' }]
  if (typeof x.version !== 'number' || !Number.isInteger(x.version) || x.version < 1) issues.push({ path: 'version', message: 'Entier supérieur ou égal à 1 attendu' })
  if (!Array.isArray(x.agents) || x.agents.length === 0) issues.push({ path: 'agents', message: 'Au moins un agent est attendu' })
  else {
    const seen = new Set<string>()
    x.agents.forEach((a: unknown, i: number) => {
      const p = `agents[${i}]`
      if (!isObj(a)) return void issues.push({ path: p, message: 'Un objet est attendu' })
      if (!nonEmpty(a.id)) issues.push({ path: `${p}.id`, message: 'Identifiant requis' })
      else if (seen.has(a.id)) issues.push({ path: `${p}.id`, message: `Identifiant en double : ${a.id}` })
      else seen.add(a.id)
      if (!nonEmpty(a.role)) issues.push({ path: `${p}.role`, message: 'Rôle requis' })
      if (!TIERS.includes(a.tier as Tier)) issues.push({ path: `${p}.tier`, message: `Niveau de modèle attendu : ${TIERS.join(', ')}` })
      if (!Array.isArray(a.routines) || a.routines.some((r) => typeof r !== 'string')) issues.push({ path: `${p}.routines`, message: 'Liste de textes attendue' })
      if (typeof a.instructions !== 'string') issues.push({ path: `${p}.instructions`, message: 'Texte attendu' })
    })
  }
  if (!Array.isArray(x.pipelines) || x.pipelines.length === 0) issues.push({ path: 'pipelines', message: 'Au moins un pipeline est attendu' })
  else {
    const seenP = new Set<string>()
    x.pipelines.forEach((pl: unknown, i: number) => {
      const p = `pipelines[${i}]`
      if (!isObj(pl)) return void issues.push({ path: p, message: 'Un objet est attendu' })
      if (!nonEmpty(pl.id)) issues.push({ path: `${p}.id`, message: 'Identifiant requis' })
      else if (seenP.has(pl.id)) issues.push({ path: `${p}.id`, message: `Identifiant en double : ${pl.id}` })
      else seenP.add(pl.id)
      if (!nonEmpty(pl.name)) issues.push({ path: `${p}.name`, message: 'Nom requis' })
      if (!Array.isArray(pl.nodes) || pl.nodes.length === 0) return void issues.push({ path: `${p}.nodes`, message: 'Au moins une étape est attendue' })
      const seenN = new Set<string>()
      pl.nodes.forEach((n: unknown, j: number) => {
        const q = `${p}.nodes[${j}]`
        if (!isObj(n)) return void issues.push({ path: q, message: 'Un objet est attendu' })
        if (!nonEmpty(n.id)) issues.push({ path: `${q}.id`, message: 'Identifiant requis' })
        else if (seenN.has(n.id)) issues.push({ path: `${q}.id`, message: `Identifiant en double : ${n.id}` })
        else seenN.add(n.id)
        if (!nonEmpty(n.label)) issues.push({ path: `${q}.label`, message: 'Libellé requis' })
        if (n.kind !== undefined && !NODE_KINDS.includes(n.kind as NodeKind)) issues.push({ path: `${q}.kind`, message: `Type d’étape attendu : ${NODE_KINDS.join(', ')}` })
        if (!RUNNERS.includes(n.runner as Runner)) issues.push({ path: `${q}.runner`, message: `Exécuteur attendu : ${RUNNERS.join(', ')}` })
        if (typeof n.provider !== 'string') issues.push({ path: `${q}.provider`, message: 'Texte attendu' })
        if (typeof n.credits !== 'number' || !Number.isFinite(n.credits) || n.credits < 0) issues.push({ path: `${q}.credits`, message: 'Nombre positif ou nul attendu' })
        if (!VALIDATES.includes(n.validate as Validate)) issues.push({ path: `${q}.validate`, message: `Validation attendue : ${VALIDATES.join(', ')}` })
      })
    })
  }
  return issues
}

/* ------------------------------------------------------------------ kind of a step */

// The app's fallback when a step has no `kind` (src/shared/blueprint.ts `guessDrawingKind`; a test keeps both in step).
const KIND_RULES: readonly (readonly [RegExp, NodeKind])[] = [
  [/miniature|thumbnail/i, 'thumbnail'],
  [/sous-?titre|caption/i, 'captions'],
  [/qualit|contr[oô]le|\bqc\b|relecture/i, 'qc'],
  [/montage|rendu|assemblage/i, 'edit'],
  [/r[ée]alisation|d[ée]coupage|storyboard/i, 'director'],
  [/script|sc[ée]nario|dialogue|r[ée]daction/i, 'script'],
  [/sujet|id[ée]e|histoire|angle/i, 'idea'],
  [/avatar|pr[ée]sentateur/i, 'avatar'],
  [/archive|b-?roll|stock/i, 'stock'],
  [/vid[ée]o ia|g[ée]n[ée]ration vid[ée]o/i, 'video-gen'],
  [/image|illustration|visuel/i, 'image-gen'],
  [/anim|motion|compte [àa] rebours/i, 'motion'],
  [/voix|narration|voice/i, 'voice'],
  [/musique|ambiance sonore|\bson\b/i, 'music'],
  [/gameplay/i, 'gameplay'],
  [/carte/i, 'card'],
  [/traduction|adaptation|translate/i, 'translate'],
  [/publi|planning|programm/i, 'publish'],
  [/valid|fournir|d[ée]pose|import/i, 'human-input']
]

export function guessKind(label: string): { kind: NodeKind; matched: boolean } {
  for (const [re, kind] of KIND_RULES) if (re.test(label)) return { kind, matched: true }
  return { kind: 'code', matched: false }
}

/** Steps without a `kind`: the app will guess from the label. Not an error, a warning to let the founder decide. */
export function kindWarnings(b: Blueprint): Issue[] {
  const out: Issue[] = []
  b.pipelines.forEach((p, i) =>
    p.nodes.forEach((n, j) => {
      if (n.kind) return
      const g = guessKind(n.label)
      out.push({
        path: `pipelines[${i}].nodes[${j}].kind`,
        message: g.matched
          ? `Type non précisé pour « ${n.label} » : l’app le déduira du libellé (${KIND_LABEL[g.kind]}). Choisis-le pour être sûr.`
          : `Type non précisé pour « ${n.label} » et rien ne correspond au libellé : l’app en fera une étape générique (code). Choisis-le.`
      })
    })
  )
  return out
}

export const stringify = (b: Blueprint): string => JSON.stringify(b, null, 2)

export function pipelineCredits(p: BlueprintPipeline): number {
  return p.nodes.reduce((s, n) => s + n.credits, 0)
}
