// Registry of features that may be real or demo (PLAN-V2 §8.4, PLAN-V2-PRODUCTION §4.12). The status is COMPUTED from
// what the app knows (`FeatureContext`); the UI shows `DemoBadge` / `DemoBoundary` for anything that is not `real`.
// Production functions that run through Atelier Cloud (platform voices, generation, avatars, RunPod…) take their status
// from the Cloud's catalogue (`GET catalog`, lots P3/P5): until the app is connected to a Cloud they are demo. A
// function the Cloud marks real still needs credits in the wallet. Local functions (our engine) are real since lot Z1.

/** `needs-credits`: real on this platform, but the wallet is empty ("crédits insuffisants"). */
export type FeatureStatus = 'real' | 'demo' | 'needs-credits'

/** Production functions whose status comes from Atelier Cloud's catalogue. */
export const CLOUD_FUNCTIONS = [
  'voice-platform',
  'stock-media',
  'image-generation',
  'video-generation',
  'avatar',
  'youtube-research',
  'video-analysis',
  'gpu-render',
  'claude-platform-api'
] as const
export type CloudFunctionId = (typeof CLOUD_FUNCTIONS)[number]

/** What Atelier Cloud says about this platform (`GET catalog`): a function is real only when its provider key is in
 *  the vault and paid calls are allowed (status R*), otherwise demo. */
export interface CloudCatalog {
  functions: Partial<Record<CloudFunctionId, 'real' | 'demo'>>
  /** The team's wallet holds credits. */
  hasCredits: boolean
}

export interface FeatureContext {
  /** Atelier Cloud's catalogue, or null while the app is not connected to a Cloud (until lots P3/P5). */
  cloud: CloudCatalog | null
  /** YouTube read-only OAuth access was created. */
  youtubeConnected: boolean
}

export const NO_FEATURES: FeatureContext = {
  cloud: null,
  youtubeConnected: false
}

export interface FeatureDef {
  id: string
  label: string
  /** Why the feature is not real (shown when it is not). */
  reason: string
  /** What to do to make it real. */
  unlockedBy: string
  status: (ctx: FeatureContext) => FeatureStatus
}

const always =
  (s: FeatureStatus) =>
  (): FeatureStatus =>
    s

/** Status of a Cloud function: demo unless the Cloud says real; real needs credits. */
export function cloudStatus(id: CloudFunctionId, ctx: FeatureContext): FeatureStatus {
  if (ctx.cloud?.functions[id] !== 'real') return 'demo'
  return ctx.cloud.hasCredits ? 'real' : 'needs-credits'
}

const CLOUD_REASON = 'En démo sur cette plateforme : Atelier Cloud ne la propose pas encore (ou n’est pas connecté).'
const CLOUD_UNLOCK = 'Connecter Atelier Cloud ; la fonction s’active quand la plateforme la propose et que tu as des crédits.'

const cloud = <I extends CloudFunctionId>(id: I, label: string) => ({
  id,
  label,
  reason: CLOUD_REASON,
  unlockedBy: CLOUD_UNLOCK,
  status: (c: FeatureContext): FeatureStatus => cloudStatus(id, c)
})

export const FEATURES = [
  { id: 'chat', label: 'Conversations et équipe d’agents', reason: '', unlockedBy: '', status: always('real') },
  { id: 'ledger', label: 'Registre des dépenses', reason: '', unlockedBy: '', status: always('real') },
  // Lot Z1: our engine runs in the app (pipelines, validations per node, real local edit, captions, music and render).
  // The paid providers it calls (platform voice, pictures, video…) stay demo through the Cloud functions below.
  {
    id: 'production',
    label: 'Moteur de production Atelier (pipelines, validations par nœud, rendu)',
    reason: '',
    unlockedBy: '',
    status: always('real')
  },
  cloud('voice-platform', 'Voix de la plateforme'),
  cloud('stock-media', 'Banque d’images et de vidéos'),
  cloud('image-generation', 'Images générées'),
  cloud('video-generation', 'Plans vidéo générés'),
  cloud('avatar', 'Présentateur avatar'),
  cloud('youtube-research', 'Recherche YouTube et analyse de chaîne'),
  cloud('video-analysis', 'Analyse d’une vidéo d’exemple'),
  cloud('gpu-render', 'Rendu sur machine distante (RunPod)'),
  cloud('claude-platform-api', 'API Claude de la plateforme (repli payé en crédits)'),
  {
    id: 'youtube-analytics',
    label: 'YouTube Analytics (lecture seule)',
    reason: 'Aucun accès YouTube n’est connecté.',
    unlockedBy: 'Monétisation › YouTube : créer l’accès OAuth en lecture seule.',
    status: (c) => (c.youtubeConnected ? 'real' : 'demo')
  },
  {
    id: 'voice-clone',
    label: 'Clonage de voix',
    reason: 'Le clonage demande un consentement vérifié.',
    unlockedBy: 'Pas prévu en v2.',
    status: always('demo')
  },
  {
    id: 'cloud-pc',
    label: 'PC cloud par utilisateur',
    reason: 'Écran d’exemple seulement.',
    unlockedBy: 'Pas prévu en v2.',
    status: always('demo')
  },
  {
    id: 'buy-credits',
    label: 'Acheter des crédits',
    reason: 'Aucun moyen de paiement n’est branché.',
    unlockedBy: 'Pas prévu en v2.',
    status: always('demo')
  },
  {
    id: 'support-email',
    label: 'E-mail du support',
    reason: 'Les demandes arrivent dans Admin plateforme ; aucun e-mail n’est envoyé.',
    unlockedBy: 'Pas prévu en v2.',
    status: always('demo')
  },
  {
    id: 'remote-desktop-control',
    label: 'Contrôle en direct de l’écran d’un ordinateur distant',
    reason: 'Le contrôle souris et clavier n’est pas branché ; seule une capture rafraîchie est montrée.',
    unlockedBy: 'Pas prévu pour l’instant.',
    status: always('demo')
  },
  {
    id: 'offer-deploy',
    label: 'Déploiement d’une offre (paiement et site)',
    reason: 'Aucun compte de paiement ni d’hébergement n’est branché.',
    unlockedBy: 'Monétisation › Produits et offres : relier les comptes.',
    status: always('demo')
  }
] as const satisfies readonly FeatureDef[]

export type FeatureId = (typeof FEATURES)[number]['id']

export interface FeatureState {
  id: FeatureId
  label: string
  status: FeatureStatus
  reason: string
  unlockedBy: string
}

export function resolveFeatures(ctx: FeatureContext): FeatureState[] {
  return FEATURES.map((f) => {
    const status = f.status(ctx)
    const real = status === 'real'
    return { id: f.id, label: f.label, status, reason: real ? '' : f.reason, unlockedBy: real ? '' : f.unlockedBy }
  })
}

export function featureState(id: FeatureId, ctx: FeatureContext): FeatureState {
  const found = resolveFeatures(ctx).find((f) => f.id === id)
  if (!found) throw new Error(`Unknown feature: ${id}`)
  return found
}

/** True for anything that must carry the DÉMO badge. */
export function isDemoLike(status: FeatureStatus): boolean {
  return status !== 'real'
}
