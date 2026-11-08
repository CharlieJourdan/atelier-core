// The pipeline every demo run follows (api-runs*.ts): ten bricks of a narrated video, with what each one says while it
// works, its price in both budget modes and its gate. Invented figures, close in spirit to the engine's template.
import type { QuoteMode, QuoteNode, RunBudgetMode, RunGateMode, RunNode, RunQuote, RunStyle } from '../../../shared/runs'

export interface Brick {
  nodeId: string
  type: string
  label: string
  where: QuoteNode['where']
  backend?: QuoteNode['backend']
  /** Credits in `usage_max` and `qualite_max`. */
  credits: Record<RunBudgetMode, number>
  /** Seconds per video minute (a rough duration). */
  secondsPerMinute: number
  /** The gate it stops at in « Pas à pas » (`review`) or always (`owner`). */
  gate: QuoteNode['gate']
  /** What the brick says while it runs, in order. */
  steps: string[]
}

export const BRICKS: Brick[] = [
  { nodeId: 'research', type: 'research.topic@1', label: 'Recherche', where: 'local', backend: 'subscription', credits: { usage_max: 0, qualite_max: 0 }, secondsPerMinute: 9, gate: 'none', steps: ['Lecture des sources publiques', 'Tri des faits vérifiables', 'Rédaction du brief'] },
  { nodeId: 'script', type: 'script.write@1', label: 'Script', where: 'local', backend: 'subscription', credits: { usage_max: 0, qualite_max: 0 }, secondsPerMinute: 14, gate: 'review', steps: ['Plan en cinq actes', 'Écriture de l’accroche', 'Relecture du rythme'] },
  { nodeId: 'voice', type: 'voice.tts@1', label: 'Voix', where: 'cloud', credits: { usage_max: 2, qualite_max: 5 }, secondsPerMinute: 6, gate: 'none', steps: ['Découpage en phrases', 'Synthèse de la narration', 'Alignement des mots'] },
  { nodeId: 'plan', type: 'director.plan@1', label: 'Plan de montage', where: 'local', backend: 'subscription', credits: { usage_max: 0, qualite_max: 0 }, secondsPerMinute: 5, gate: 'none', steps: ['Découpage en scènes', 'Choix des plans', 'Chiffrage des images'] },
  { nodeId: 'visuals', type: 'visuals.fulfil@1', label: 'Images', where: 'gpu', credits: { usage_max: 5, qualite_max: 13 }, secondsPerMinute: 12, gate: 'none', steps: ['Recherche d’images libres', 'Génération des plans manquants', 'Recadrage 16:9'] },
  { nodeId: 'music', type: 'sound.music@1', label: 'Musique', where: 'cloud', credits: { usage_max: 1, qualite_max: 1 }, secondsPerMinute: 2, gate: 'none', steps: ['Choix de l’ambiance', 'Mixage sous la voix'] },
  { nodeId: 'captions', type: 'captions.make@1', label: 'Sous-titres', where: 'local', credits: { usage_max: 0, qualite_max: 0 }, secondsPerMinute: 2, gate: 'none', steps: ['Découpage des répliques', 'Mise en forme « highlight »'] },
  { nodeId: 'render', type: 'render.assemble@1', label: 'Rendu', where: 'local', credits: { usage_max: 0, qualite_max: 0 }, secondsPerMinute: 10, gate: 'none', steps: ['Assemblage des plans', 'Incrustation des sous-titres', 'Encodage 1080p'] },
  { nodeId: 'thumbnail', type: 'thumbnail.make@1', label: 'Miniature', where: 'gpu', credits: { usage_max: 6, qualite_max: 14 }, secondsPerMinute: 1, gate: 'none', steps: ['Trois pistes de miniature', 'Choix du contraste'] },
  { nodeId: 'package', type: 'package.youtube@1', label: 'Paquet de mise en ligne', where: 'local', credits: { usage_max: 0, qualite_max: 0 }, secondsPerMinute: 1, gate: 'owner', steps: ['Titre, description et chapitres', 'Écriture du dossier'] }
]

export const PIPELINE = { id: 'docu-narre', label: 'Documentaire narré', version: 3 } as const

/** Credits of one brick for a video of `minutes` (the paid bricks scale with the length). */
export const brickCredits = (b: Brick, mode: RunBudgetMode, minutes: number): number => Math.round(b.credits[mode] * Math.max(1, minutes))

/** The gate a brick stops at in this gate mode (`owner` gates are kept only when `ownerGate` is asked). */
function gateOf(b: Brick, gateMode: RunGateMode, ownerGate: boolean): RunNode['gateKind'] {
  if (b.gate === 'review') return gateMode === 'step' ? 'review' : 'none'
  if (b.gate === 'owner') return ownerGate ? 'owner' : 'none'
  return 'none'
}

export function freshNodes(minutes: number, budget: RunBudgetMode, gateMode: RunGateMode, ownerGate = false): RunNode[] {
  return BRICKS.map((b, position) => ({
    nodeId: b.nodeId,
    position,
    type: b.type,
    label: b.label,
    state: 'pending',
    progress: 0,
    step: null,
    quoteCredits: brickCredits(b, budget, minutes),
    credits: 0,
    engines: [],
    fingerprint: null,
    error: null,
    gate: 'none',
    gateKind: gateOf(b, gateMode, ownerGate),
    changeNote: null,
    startedAt: null,
    finishedAt: null
  }))
}

export const DEMO_BALANCE = { available: 4_200, held: 0, total: 4_200, simulated: 0, example: 0 }

function quoteMode(budgetMode: RunBudgetMode, minutes: number): QuoteMode {
  const nodes: QuoteNode[] = BRICKS.map((b) => ({
    nodeId: b.nodeId,
    type: b.type,
    label: b.label,
    where: b.where,
    ...(b.backend ? { backend: b.backend } : {}),
    credits: brickCredits(b, budgetMode, minutes),
    durationS: Math.round(b.secondsPerMinute * Math.max(1, minutes) * (budgetMode === 'qualite_max' ? 1.4 : 1)),
    cached: false,
    gate: b.gate
  }))
  const totalCredits = nodes.reduce((s, n) => s + n.credits, 0)
  return { budgetMode, nodes, totalCredits, totalEur: totalCredits / 100, durationS: nodes.reduce((s, n) => s + n.durationS, 0) }
}

export function demoQuote(minutes: number, _style?: RunStyle, budgetMode?: RunBudgetMode): RunQuote {
  return {
    pipelineId: PIPELINE.id,
    pipelineLabel: PIPELINE.label,
    pipelineVersion: PIPELINE.version,
    minutes,
    demo: true,
    demoReason: 'Démo : voix système, images dessinées et script modèle. Rien n’est débité.',
    debited: false,
    modes: { usage_max: quoteMode('usage_max', minutes), qualite_max: quoteMode('qualite_max', minutes) },
    balance: { ...DEMO_BALANCE },
    ...(budgetMode ? { budgetMode } : {}),
    real: { available: false, reason: 'Démo : le moteur réel demande un compte Atelier Cloud, absent de cette démo.' }
  }
}
