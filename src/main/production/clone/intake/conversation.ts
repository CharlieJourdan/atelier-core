// P0 — the intake conversation (spec §2 P0): a short exchange that fills a draft brief. EVERY free message is read and
// changes the draft; the agent's turn lists exactly what changed (before → after), says so when nothing did and why, and
// asks the one next question. The text itself is French copy keys (`fr-clone.ts`), values stay raw. Only what has no safe
// default blocks a start (what to do, the link, the language, the test budget — the money question); what he supplies
// (default: nothing, placeholders stand in) and which axes come from which link (default: all) are asked, never required.
import { INSPIRATION_AXES, type CloneIntent, type IntakeChange, type IntakeDraft, type IntakeField, type IntakeState, type IntakeTurn } from '../../../../shared/clone'
import type { IntakeAnswers } from '../p0-intake'
import { axesByOrdinal, understand } from './parse'

type Reply = IntakeTurn['reply']

export function startIntake(): IntakeState {
  return { draft: { intent: null, references: [], style: undefined, language: null, sourceLanguage: null, testBudgetUsd: null, humanInputs: null, ownChannel: null }, said: [], asked: null }
}

const MULTI_REFERENCE: readonly CloneIntent[] = ['mix', 'inspiration']

/** What is still missing for a brief a clone can start from, in the order the agent asks (only fields without a safe default). */
export function missingFields(d: IntakeDraft): IntakeField[] {
  const m: IntakeField[] = []
  if (!d.intent) m.push('intent')
  const needsVideo = d.intent === 'copy-video' && !d.references.some((r) => r.kind === 'video')
  const needsTwo = d.intent === 'mix' && d.references.length < 2
  if (d.references.length === 0 || needsVideo || needsTwo) m.push('references')
  if (d.intent === 'translate' && (!d.sourceLanguage || d.sourceLanguage === d.language)) m.push('sourceLanguage')
  if (!d.language) m.push('language')
  if (d.testBudgetUsd === null) m.push('testBudgetUsd')
  return m
}

/** What he supplies when he did not say: nothing, placeholders stand in for the face, the voice and the footage. */
export const NO_HUMAN_INPUTS = { face: false, voice: false, footage: false } as const

/** Does the inspiration/mix still lack its axes (which part comes from which reference)? */
const needsAxes = (d: IntakeDraft, answered: boolean | undefined): boolean => !answered && d.intent !== null && MULTI_REFERENCE.includes(d.intent) && d.references.length > 0 && d.references.every((r) => r.axes.length === 0)

const QUESTION: Record<IntakeField, string> = {
  intent: 'clone.intake.q.intent', references: 'clone.intake.q.references', style: 'clone.intake.q.style', language: 'clone.intake.q.language',
  sourceLanguage: 'clone.intake.q.sourceLanguage', testBudgetUsd: 'clone.intake.q.budget', humanInputs: 'clone.intake.q.humanInputs', ownChannel: 'clone.intake.q.intent'
}

/** The questions whose unclear answer is met with a short question and simple choices (not « that changes nothing »). */
const UNCLEAR: ReadonlySet<IntakeField> = new Set<IntakeField>(['intent', 'references', 'language', 'sourceLanguage', 'testBudgetUsd', 'humanInputs', 'style'])

/** Did the message say anything the intake knows (a link, a choice, a language, an amount, what he supplies, a style)? */
const understoodAnything = (u: ReturnType<typeof understand>): boolean =>
  u.urls.length > 0 || u.intent !== null || u.language !== null || u.sourceLanguage !== null || u.budgetUsd !== null || Object.keys(u.humanInputs).length > 0 || u.style !== undefined

const show = (v: unknown): string => (v === null || v === undefined ? '' : typeof v === 'string' ? v : JSON.stringify(v))
const refsText = (d: IntakeDraft): string => d.references.map((r) => (r.axes.length ? `${r.url} [${r.axes.join(',')}]` : r.url)).join(' | ')
const inputsText = (h: IntakeDraft['humanInputs']): string => (h ? (['face', 'voice', 'footage'] as const).filter((k) => h[k]).join(',') || 'none' : '')

function snapshot(d: IntakeDraft): Record<IntakeField, string> {
  return {
    intent: show(d.intent), references: refsText(d), style: d.style === undefined ? '' : d.style === null ? 'auto' : d.style,
    language: show(d.language), sourceLanguage: show(d.sourceLanguage), testBudgetUsd: show(d.testBudgetUsd), humanInputs: inputsText(d.humanInputs), ownChannel: d.ownChannel === null ? '' : String(d.ownChannel)
  }
}

/** One turn: read the message, change the draft, say what changed, ask the next thing. */
export function intakeTurn(prev: IntakeState, message: string): IntakeTurn {
  const text = message.trim()
  const d: IntakeDraft = structuredClone(prev.draft)
  const before = snapshot(d)
  const reply: Reply = []
  const u = understand(text, prev.asked)

  // Intent first: later fields depend on it.
  if (u.intent && (!u.intentGuessed || d.intent === null)) d.intent = u.intent

  // Links: single-source intents take the newest links, mix/inspiration collect them.
  if (u.urls.length > 0) {
    const fresh = u.urls.map((x) => ({ url: x.url, kind: x.kind, axes: [...x.axes] }))
    if (d.intent && MULTI_REFERENCE.includes(d.intent)) {
      for (const f of fresh) {
        const at = d.references.findIndex((r) => r.url === f.url)
        if (at < 0) d.references.push(f)
        else if (f.axes.length) d.references[at] = { ...d.references[at]!, axes: f.axes }
      }
    } else d.references = fresh
  } else if (u.intent && MULTI_REFERENCE.includes(u.intent) === false && d.references.length > 1) {
    d.references = d.references.slice(0, 1) // he went back to a single source: keep the first, say so below
  }
  // Axes named by position (« le montage du premier, la voix du second ») once the agent asked which axes come from where.
  if (prev.axesAsked && u.urls.length === 0) for (const [at, axes] of axesByOrdinal(text)) if (d.references[at]) d.references[at] = { ...d.references[at]!, axes }

  if (u.language) d.language = u.language
  if (u.sourceLanguage) d.sourceLanguage = u.sourceLanguage
  if (u.budgetUsd !== null) d.testBudgetUsd = u.budgetUsd
  if (Object.keys(u.humanInputs).length > 0) d.humanInputs = { ...(d.humanInputs ?? { face: false, voice: false, footage: false }), ...u.humanInputs }
  if (u.style !== undefined) d.style = u.style
  d.ownChannel = d.intent === null ? null : d.intent === 'own-channel'

  const after = snapshot(d)
  const changes: IntakeChange[] = (Object.keys(after) as IntakeField[])
    .filter((f) => after[f] !== before[f] && f !== 'ownChannel')
    .map((field) => ({ field, before: before[field], after: after[field] }))

  // What the agent says: the effect first.
  if (changes.length > 0) reply.push({ key: 'clone.intake.reply.changed', vars: { n: changes.length } })
  else if (text.length === 0) reply.push({ key: 'clone.intake.reply.empty', vars: {} })
  else if (!understoodAnything(u) && prev.asked && UNCLEAR.has(prev.asked)) reply.push({ key: `clone.intake.reply.unclear.${prev.asked}`, vars: {} })
  else if (u.humanInputs && Object.keys(u.humanInputs).length > 0 && prev.asked === 'humanInputs') reply.push({ key: 'clone.intake.reply.inputsSame', vars: {} })
  else reply.push({ key: 'clone.intake.reply.nochange', vars: {} })
  if (u.intentGuessed && changes.some((c) => c.field === 'intent')) reply.push({ key: 'clone.intake.reply.guessed', vars: { intent: d.intent ?? '' } })
  if (u.euro) reply.push({ key: 'clone.intake.reply.euro', vars: { usd: d.testBudgetUsd ?? 0 } })
  if (d.intent === 'copy-video' && d.references.length > 0 && !d.references.some((r) => r.kind === 'video')) reply.push({ key: 'clone.intake.reply.needVideo', vars: {} })
  if (d.intent === 'mix' && d.references.length === 1) reply.push({ key: 'clone.intake.reply.needTwo', vars: {} })
  if (d.intent === 'translate' && d.language && d.sourceLanguage && d.language === d.sourceLanguage) reply.push({ key: 'clone.intake.reply.sameLanguage', vars: { language: d.language } })
  if (d.testBudgetUsd !== null && d.testBudgetUsd < 3) reply.push({ key: 'clone.intake.reply.budgetLow', vars: { usd: d.testBudgetUsd } })
  if (d.intent === 'own-channel' && d.humanInputs && !d.humanInputs.face && !d.humanInputs.voice) reply.push({ key: 'clone.intake.reply.ownNoClones', vars: {} })

  const inputsSettled = prev.inputsSettled === true || (prev.asked === 'humanInputs' && Object.keys(u.humanInputs).length > 0)
  const missing = missingFields(d)
  // The axes question comes right after the links: once asked, whatever he answers (naming none = all) settles it.
  const axesAnswered = prev.axesAnswered || (prev.axesAsked === true && text.length > 0) || d.references.some((r) => r.axes.length > 0)
  const askAxes = needsAxes(d, axesAnswered) && !missing.includes('intent') && !missing.includes('references')
  // what he supplies is asked once the brief is complete, as an optional question: starting without answering takes the default
  const askInputs = missing.length === 0 && !askAxes && !inputsSettled
  const asked: IntakeField | null = askAxes ? null : (missing[0] ?? (askInputs ? 'humanInputs' : null))
  const question: string | null = askAxes ? 'clone.intake.q.axes' : asked ? QUESTION[asked] : null
  if (prev.axesAsked && !d.references.some((r) => r.axes.length > 0) && axesAnswered) reply.push({ key: 'clone.intake.reply.axesAll', vars: {} })
  // the questions with a safe default never hold a start
  const ready = missing.length === 0
  const state: IntakeState = { draft: d, said: text ? [...prev.said, text.slice(0, 280)] : prev.said, asked, axesAsked: askAxes, axesAnswered, inputsSettled }
  return { state, changes, reply, missing, question, ready }
}

/** The answers P0 turns into the `Brief` (only when `ready`). */
export function intakeAnswers(state: IntakeState): IntakeAnswers {
  const d = state.draft
  if (missingFields(d).length > 0 || !d.intent || !d.language || d.testBudgetUsd === null) throw new Error('the intake is not finished')
  const axesKnown = new Set<string>(INSPIRATION_AXES)
  return {
    intent: d.intent,
    references: d.references.map((r) => ({ ...r, axes: r.axes.filter((a) => axesKnown.has(a)) })),
    style: d.style ?? null,
    language: d.language,
    sourceLanguage: d.intent === 'translate' ? d.sourceLanguage : d.sourceLanguage ?? null,
    testBudgetUsd: d.testBudgetUsd,
    humanInputs: d.humanInputs ?? { ...NO_HUMAN_INPUTS },
    ownChannel: d.intent === 'own-channel',
    said: state.said
  }
}
