// The demo's intake conversation (« Créer une pipeline », P0): a scripted agent that asks three things — what he wants
// (copy, translate, adapt, take inspiration), the link, the test budget — then, optionally, what he can supply. Every
// answer is accepted: a word it does not recognise takes the usual default, and « Continuer sans remplir » (demo only)
// fills the whole brief at once. Nothing leaves the browser.
import type { CloneIntent, IntakeChange, IntakeDraft, IntakeField, IntakeState, IntakeTurn } from '../../../shared/clone'
import { CLONE_INTENTS } from '../../../shared/clone'
import { tc } from '../../../shared/fr-clone'
import { t } from '../../../shared/fr'

/** The fictional channel a brief without a link copies (invented: no such channel exists). */
export const DEMO_SOURCE_URL = 'https://www.youtube.com/@ArchivesDuCiel-demo'
export const DEMO_SOURCE_NAME = 'Les Archives du Ciel'

const INTENT_WORDS: [CloneIntent, RegExp][] = [
  ['translate', /tradu|translat|autre langue/i],
  ['mix', /m[ée]lang|mix|combin/i],
  ['inspiration', /inspir|adapt|un peu diff|certains [ée]l[ée]ments/i],
  ['own-channel', /ma (propre )?cha[iî]ne|mon visage|pour moi/i],
  ['copy-video', /une (seule )?vid[ée]o|cette vid[ée]o/i],
  ['copy-channel', /copi|clon|refai|reprodui|pareil|m[eê]me style/i]
]

const LANGS: [string, RegExp][] = [['fr', /fran[cç]ais|french/i], ['en', /anglais|english/i], ['es', /espagnol|spanish/i], ['de', /allemand/i], ['it', /italien/i], ['pt', /portugais/i]]

function intentOf(m: string): CloneIntent | null {
  for (const k of CLONE_INTENTS) if (m === tc(`clone.intent.${k}.say`)) return k
  return INTENT_WORDS.find(([, re]) => re.test(m))?.[0] ?? null
}

function budgetOf(m: string, bare: boolean): number | null {
  const money = /(\d+(?:[.,]\d+)?)\s*(\$|dollars?|usd|€|euros?)/i.exec(m) ?? (bare ? /(\d+(?:[.,]\d+)?)/.exec(m) : null)
  if (!money) return null
  const n = Number(money[1]!.replace(',', '.'))
  if (!Number.isFinite(n) || n <= 0) return null
  return /€|euro/i.test(money[2] ?? '') ? Math.round(n * 1.08 * 100) / 100 : n
}

function inputsOf(m: string): IntakeDraft['humanInputs'] {
  if (/rien|aucun|provisoire|non\b|none/i.test(m)) return { face: false, voice: false, footage: false }
  if (/tout|oui/i.test(m)) return { face: true, voice: true, footage: true }
  const v = { face: /visage|t[eê]te|face/i.test(m), voice: /voix|voice/i.test(m), footage: /images|vid[ée]os? [àa] moi|rushes|footage/i.test(m) }
  return v.face || v.voice || v.footage ? v : null
}

/** A draft value as the brief card reads it (`valueText` of the screens). */
function raw(field: IntakeField, d: IntakeDraft): string {
  switch (field) {
    case 'intent': return d.intent ?? ''
    case 'references': return d.references.map((r) => r.url).join(' | ')
    case 'language': return d.language ?? ''
    case 'sourceLanguage': return d.sourceLanguage ?? ''
    case 'testBudgetUsd': return d.testBudgetUsd === null ? '' : String(d.testBudgetUsd)
    case 'humanInputs': return d.humanInputs ? (['face', 'voice', 'footage'] as const).filter((k) => d.humanInputs![k]).join(',') || 'none' : ''
    case 'style': return d.style === undefined || d.style === null ? 'auto' : d.style
    case 'ownChannel': return d.ownChannel === null ? '' : String(d.ownChannel)
  }
}

const QUESTION: Partial<Record<IntakeField, string>> = { intent: 'clone.intake.q.intent', references: 'clone.intake.q.references', testBudgetUsd: 'clone.intake.q.budget', humanInputs: 'clone.intake.q.humanInputs' }

/** What is still needed, in the order the agent asks. */
function missingOf(d: IntakeDraft): IntakeField[] {
  const out: IntakeField[] = []
  if (d.intent === null) out.push('intent')
  if (d.references.length === 0) out.push('references')
  if (d.testBudgetUsd === null) out.push('testBudgetUsd')
  return out
}

/** Fills what the visitor left empty with the defaults a real brief would take. */
function fillDefaults(d: IntakeDraft): void {
  d.intent ??= 'copy-channel'
  if (d.references.length === 0) d.references = [{ url: DEMO_SOURCE_URL, kind: d.intent === 'copy-video' ? 'video' : 'channel', axes: [] }]
  d.language ??= 'fr'
  if (d.intent === 'translate') d.sourceLanguage ??= d.language === 'en' ? 'fr' : 'en'
  d.testBudgetUsd ??= 10
  if (d.style === undefined) d.style = null
  d.ownChannel ??= d.intent === 'own-channel'
}

/** One message of the intake: what changed, the next question. */
export function intakeTurn(state: IntakeState, message: string): IntakeTurn & { text: string } {
  const m = message.trim()
  const next: IntakeState = structuredClone(state)
  const d = next.draft
  const before = structuredClone(state.draft)
  next.said = [...state.said, m]
  const asked = state.asked
  const reply: IntakeTurn['reply'] = []

  if (m === t('demo.skipForm')) {
    fillDefaults(d)
    d.humanInputs ??= { face: false, voice: false, footage: false }
    next.inputsSettled = true
  } else {
    const url = /https?:\/\/\S+|(?:www\.)?youtube\.com\/\S+|youtu\.be\/\S+/i.exec(m)?.[0]
    if (url) {
      const full = url.startsWith('http') ? url : `https://${url}`
      const kind = /watch\?|youtu\.be\/|\/shorts\//i.test(full) ? 'video' : 'channel'
      if (d.intent === 'mix' && d.references.length > 0) d.references = [...d.references, { url: full, kind, axes: [] }]
      else d.references = [{ url: full, kind, axes: [] }]
    }
    const intent = intentOf(m)
    if (intent) d.intent = intent
    else if (url && d.intent === null) { d.intent = /watch\?|youtu\.be\//i.test(url) ? 'copy-video' : 'copy-channel'; reply.push({ key: 'clone.intake.reply.guessed', vars: {} }) }
    const lang = LANGS.find(([, re]) => re.test(m))?.[0]
    if (lang) d.language = lang
    const budget = budgetOf(m, asked === 'testBudgetUsd')
    if (budget !== null) d.testBudgetUsd = budget
    const inputs = inputsOf(m)
    if (inputs) { d.humanInputs = inputs; next.inputsSettled = true }

    // any answer to the question asked is accepted: what it did not say takes the usual default
    if (asked === 'intent' && d.intent === null) d.intent = 'copy-channel'
    if (asked === 'references' && d.references.length === 0) d.references = [{ url: DEMO_SOURCE_URL, kind: 'channel', axes: [] }]
    if (asked === 'testBudgetUsd' && d.testBudgetUsd === null) d.testBudgetUsd = 10
    if (asked === 'humanInputs' && d.humanInputs === null) { d.humanInputs = { face: false, voice: false, footage: false }; next.inputsSettled = true }
    if (budget !== null && budget < 3) reply.push({ key: 'clone.intake.reply.budgetLow', vars: { usd: budget } })
  }

  const missing = missingOf(d)
  const ready = missing.length === 0
  if (ready) fillDefaults(d)
  const changes: IntakeChange[] = (['intent', 'references', 'sourceLanguage', 'language', 'testBudgetUsd', 'humanInputs'] as const)
    .map((field) => ({ field, before: raw(field, before), after: raw(field, d) }))
    .filter((c) => c.before !== c.after && c.after !== '')
  reply.unshift({ key: changes.length > 0 ? 'clone.intake.reply.changed' : 'clone.intake.reply.nochange', vars: {} })

  const nextField: IntakeField | null = missing[0] ?? (next.inputsSettled ? null : 'humanInputs')
  next.asked = nextField
  const question = nextField ? (QUESTION[nextField] ?? null) : null
  const turn: IntakeTurn = { state: next, changes, reply, missing, question, ready }
  const text = [...reply.map((r) => tc(r.key, r.vars)), ...(question ? [tc(question)] : []), ...(ready ? [tc('clone.intake.ready')] : [])].join('\n')
  return { ...turn, text }
}
