// Validation of what the renderer sends (untrusted): start and quote inputs, style overrides, seeds, notes.
import { CAPTION_PRESETS } from '../../../engine/text/captions'
import type { RunQuoteInput, RunStartInput, RunStyle } from '../../../shared/runs'
import { RUN_BUDGET_MODES, RUN_GATE_MODES } from '../../../shared/runs'

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

export const MIN_MINUTES = 0.5
export const MAX_MINUTES = 30

// eslint-disable-next-line no-control-regex -- refusing control characters is the point
const PRINTABLE = /^[^\u0000-\u001f\u007f]+$/

function text(v: unknown, what: string, max: number): string {
  if (typeof v !== 'string' || v.trim() === '' || v.length > max || !PRINTABLE.test(v.replace(/[\n\r\t]/g, ' '))) {
    throw new Error(`${what} : texte attendu (1 à ${max} caractères).`)
  }
  return v.trim()
}

export function checkId(v: unknown, what: string): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v <= 0) throw new Error(`${what} invalide.`)
  return v
}

export function checkMinutes(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < MIN_MINUTES || v > MAX_MINUTES) {
    throw new Error(`Durée invalide : entre ${String(MIN_MINUTES).replace('.', ',')} et ${MAX_MINUTES} minutes.`)
  }
  return Math.round(v * 100) / 100
}

export function checkStyle(v: unknown): RunStyle {
  if (v === undefined || v === null) return {}
  if (!isObj(v)) throw new Error('Style invalide.')
  const out: RunStyle = {}
  for (const k of Object.keys(v)) {
    if (!['voice', 'systemVoice', 'speakers', 'voices', 'captions', 'burn', 'pace', 'language'].includes(k)) throw new Error(`Style invalide : réglage inconnu « ${k} ».`)
  }
  if (v.voice !== undefined) out.voice = text(v.voice, 'Voix', 100)
  if (v.systemVoice !== undefined) out.systemVoice = text(v.systemVoice, 'Voix système', 200)
  if (v.speakers !== undefined) {
    if (!isObj(v.speakers)) throw new Error('Voix des personnages invalides.')
    const entries = Object.entries(v.speakers)
    if (entries.length > 20) throw new Error('Voix des personnages : 20 personnages au plus.')
    out.speakers = Object.fromEntries(entries.map(([name, voice]) => [text(name, 'Nom de personnage', 40), text(voice, 'Voix', 100)]))
  }
  if (v.voices !== undefined) {
    if (!isObj(v.voices)) throw new Error('Voix de la chaîne invalides.')
    const entries = Object.entries(v.voices)
    if (entries.length > 8 || entries.some(([engine]) => !/^voice:[a-z0-9][a-z0-9.-]{0,60}$/.test(engine))) throw new Error('Voix de la chaîne : moteur de voix inconnu.')
    out.voices = Object.fromEntries(entries.map(([engine, voice]) => [engine, text(voice, 'Voix', 100)]))
  }
  if (v.captions !== undefined) {
    if (!(CAPTION_PRESETS as readonly unknown[]).includes(v.captions)) throw new Error('Style de sous-titres inconnu.')
    out.captions = v.captions as string
  }
  if (v.burn !== undefined) {
    if (typeof v.burn !== 'boolean') throw new Error('Style invalide : « incruster les sous-titres » attend oui ou non.')
    out.burn = v.burn
  }
  if (v.pace !== undefined) {
    if (v.pace !== 'natural' && v.pace !== 'fit') throw new Error('Rythme de voix inconnu.')
    out.pace = v.pace
  }
  if (v.language !== undefined) {
    if (typeof v.language !== 'string' || !/^[a-z]{2}$/.test(v.language)) throw new Error('Langue invalide : deux lettres attendues (fr, en…).')
    out.language = v.language
  }
  return out
}

function checkSeeds(v: unknown): Record<string, number> {
  if (v === undefined || v === null) return {}
  if (!isObj(v)) throw new Error('Grains invalides.')
  const out: Record<string, number> = {}
  for (const [k, n] of Object.entries(v)) {
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(k) || typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > 2 ** 31) {
      throw new Error('Grains invalides : un entier positif par étape.')
    }
    out[k] = n
  }
  return out
}

export function checkStartInput(v: unknown): RunStartInput {
  if (!isObj(v)) throw new Error('Paramètres de fabrication invalides.')
  const budgetMode = v.budgetMode
  if (!(RUN_BUDGET_MODES as readonly unknown[]).includes(budgetMode)) throw new Error('Mode de budget inconnu.')
  if (!(RUN_GATE_MODES as readonly unknown[]).includes(v.gateMode)) throw new Error('Mode de validation inconnu.')
  const out: RunStartInput = {
    topic: text(v.topic, 'Sujet', 2000),
    minutes: checkMinutes(v.minutes),
    budgetMode: budgetMode as RunStartInput['budgetMode'],
    gateMode: v.gateMode as RunStartInput['gateMode'],
    style: checkStyle(v.style),
    seeds: checkSeeds(v.seeds)
  }
  if (v.inputs !== undefined) out.inputs = checkRunInputs(v.inputs)
  if (checkReal(v.real)) out.real = true
  if (v.pipelineId !== undefined) out.pipelineId = checkId(v.pipelineId, 'Pipeline')
  if (v.videoId !== undefined) {
    out.videoId = checkId(v.videoId, 'Vidéo')
    if (v.channelId !== undefined || v.title !== undefined) throw new Error('Donne soit une vidéo, soit une chaîne et un titre.')
  } else {
    if (v.channelId === undefined) throw new Error('Choisis une vidéo, ou une chaîne et un titre.')
    out.channelId = checkId(v.channelId, 'Chaîne')
    out.title = text(v.title, 'Titre', 200)
  }
  return out
}

/** A run's extra text inputs: at most 12, ids like `script`, `gameplay` or `supportVideos` (never `topic`), texts up to 200 000 chars. */
export function checkRunInputs(v: unknown): Record<string, string> {
  if (!isObj(v)) throw new Error('Entrées de la pipeline invalides.')
  const entries = Object.entries(v)
  if (entries.length > 12) throw new Error('Trop d’entrées pour une pipeline.')
  const out: Record<string, string> = {}
  for (const [id, value] of entries) {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(id) || id === 'topic') throw new Error(`Entrée inconnue : ${id.slice(0, 40)}.`)
    out[id] = text(value, `Entrée « ${id} »`, 200_000)
  }
  return out
}

export function checkQuoteInput(v: unknown): RunQuoteInput {
  if (!isObj(v)) throw new Error('Paramètres du devis invalides.')
  const out: RunQuoteInput = { minutes: checkMinutes(v.minutes), style: checkStyle(v.style) }
  if (v.topic !== undefined) out.topic = text(v.topic, 'Sujet', 2000)
  if (v.videoId !== undefined) out.videoId = checkId(v.videoId, 'Vidéo')
  if (v.channelId !== undefined) out.channelId = checkId(v.channelId, 'Chaîne')
  if (v.pipelineId !== undefined) out.pipelineId = checkId(v.pipelineId, 'Pipeline')
  if (checkReal(v.real)) out.real = true
  return out
}

/** « Moteur réel »: yes or no (absent: no). */
function checkReal(v: unknown): boolean {
  if (v === undefined) return false
  if (typeof v !== 'boolean') throw new Error('« Moteur réel » attend oui ou non.')
  return v
}

export function checkNote(v: unknown): string {
  return text(v, 'Note de correction', 2000)
}
