// P0 — the intake conversation: every free message changes the brief and says what changed; a message that changes nothing
// says so (never a bare « noté »); the finished conversation feeds the real P0 and the whole engine on fakes.
import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { fakeChannel } from '../../src/main/production/clone/fakes/channels'
import { fakeServices } from '../../src/main/production/clone/fakes/services'
import { intakeAnswers, intakeTurn, missingFields, startIntake } from '../../src/main/production/clone/intake/conversation'
import { budgetIn } from '../../src/main/production/clone/intake/parse'
import { runClone } from '../../src/main/production/clone/orchestrator'
import { checkP0, runP0 } from '../../src/main/production/clone/p0-intake'
import { frClone, tc } from '../../src/shared/fr-clone'
import type { IntakeState, IntakeTurn } from '../../src/shared/clone'

const say = (s: IntakeState, ...messages: string[]): { state: IntakeState; turns: IntakeTurn[] } => {
  const turns: IntakeTurn[] = []
  for (const m of messages) { const t = intakeTurn(s, m); s = t.state; turns.push(t) }
  return { state: s, turns }
}
const CHANNEL = 'https://www.youtube.com/@finary'
const VIDEO = 'https://www.youtube.com/watch?v=abc123'

describe('intake conversation', () => {
  it('a channel link alone changes the brief, says what it guessed and asks for the language', () => {
    const t = intakeTurn(startIntake(), CHANNEL)
    expect(t.changes.map((c) => c.field)).toEqual(['intent', 'references'])
    expect(t.changes[0]).toMatchObject({ before: '', after: 'copy-channel' })
    expect(t.reply.map((r) => r.key)).toContain('clone.intake.reply.guessed')
    expect(t.question).toBe('clone.intake.q.language')
  })

  it('every message in a whole conversation changes something and the brief ends ready', () => {
    const { state, turns } = say(startIntake(), 'Je veux copier une chaîne', `voici ${CHANNEL}`, 'en français', '5 à 10 $', 'je peux fournir mon visage et ma voix')
    for (const t of turns) expect(t.changes.length, t.reply[0]!.key).toBeGreaterThan(0)
    expect(turns[3]!.state.draft.testBudgetUsd).toBe(10)
    expect(turns[4]!.state.draft.humanInputs).toEqual({ face: true, voice: true, footage: false })
    expect(turns[4]!.ready).toBe(true)
    const a = intakeAnswers(state)
    expect(a).toMatchObject({ intent: 'copy-channel', language: 'fr', testBudgetUsd: 10, ownChannel: false })
    expect(a.said).toHaveLength(5)
    expect(checkP0({ schema: 'atelier.clone.brief/1', cloneId: 'c', createdAt: 'now', ...a }).ok).toBe(true)
  })

  it('a message that changes nothing says so and why, and asks again — never « noté »', () => {
    // Nothing was asked yet (a fresh conversation): a message with nothing in it changes nothing. When a question is pending,
    // the agent re-asks it with choices instead (clone-intake-phrasings.test.ts).
    const t = intakeTurn(startIntake(), 'ok super, merci !')
    expect(t.changes).toEqual([])
    expect(t.reply[0]!.key).toBe('clone.intake.reply.nochange')
    expect(tc(t.reply[0]!.key)).toMatch(/ne change rien/)
    expect(t.question).toBe('clone.intake.q.intent')
    expect(Object.values(frClone).some((v) => /^Noté\b/i.test(v))).toBe(false)
  })

  it('a later message changes an earlier answer and the agent shows before → after', () => {
    let { state } = say(startIntake(), CHANNEL, 'en français', '8 $', 'rien, des provisoires')
    const t = intakeTurn(state, 'finalement plutôt 12 dollars et en espagnol')
    expect(t.changes.map((c) => [c.field, c.before, c.after])).toEqual([['language', 'fr', 'es'], ['testBudgetUsd', '8', '12']])
    state = t.state
    expect(state.draft.language).toBe('es')
  })

  it('handles translation, euros, a bare number and curly apostrophes', () => {
    const tr = say(startIntake(), `traduis ${CHANNEL} de l’anglais vers le français`)
    expect(tr.state.draft).toMatchObject({ intent: 'translate', sourceLanguage: 'en', language: 'fr' })
    const eur = intakeTurn(tr.state, '10 euros')
    expect(eur.state.draft.testBudgetUsd).toBe(10.8)
    expect(eur.reply.map((r) => r.key)).toContain('clone.intake.reply.euro')
    expect(budgetIn('8', true)?.usd).toBe(8)
    expect(budgetIn('8', false)).toBeNull()
    const asked = say(startIntake(), CHANNEL, 'en français')
    expect(asked.state.asked).toBe('testBudgetUsd')
    expect(intakeTurn(asked.state, '7').state.draft.testBudgetUsd).toBe(7)
  })

  it('a single video asks for a video link; a mix asks for two links and which axes come from which', () => {
    const v = say(startIntake(), 'je veux refaire une seule vidéo', CHANNEL)
    expect(v.turns[1]!.reply.map((r) => r.key)).toContain('clone.intake.reply.needVideo')
    expect(missingFields(v.state.draft)).toContain('references')
    const m = say(startIntake(), 'je veux mélanger', `le montage et la voix de ${CHANNEL}`, `le texte de ${VIDEO}`)
    expect(m.state.draft.references.map((r) => [r.kind, r.axes])).toEqual([['channel', ['voice', 'editing']], ['video', ['script']]])
    expect(m.turns[0]!.question).toBe('clone.intake.q.references')
    const none = say(startIntake(), 'je veux mélanger', CHANNEL, VIDEO)
    expect(none.turns[2]!.question).toBe('clone.intake.q.axes')
    const ord = intakeTurn(none.state, 'le montage du premier et le texte du second')
    expect(ord.state.draft.references.map((r) => r.axes)).toEqual([['editing'], ['script']])
    expect(ord.changes.map((c) => c.field)).toEqual(['references'])
    expect(ord.question).toBe('clone.intake.q.language')
    const all = intakeTurn(none.state, 'tout de chaque')
    expect(all.question).toBe('clone.intake.q.language')
  })

  it('own channel is marked own; "ma voix" in an axis phrase is not an axis', () => {
    const { state } = say(startIntake(), `c’est pour ma chaîne ${CHANNEL}`, 'en français', '6 $', 'j’ai mon visage et ma voix')
    expect(intakeAnswers(state)).toMatchObject({ intent: 'own-channel', ownChannel: true, humanInputs: { face: true, voice: true, footage: false } })
  })

  it('the brief feeds the real engine: conversation → P0 → clone on fakes', async () => {
    const ch = fakeChannel('presenter-motion')
    const { state } = say(startIntake(), `copie ${ch.url}`, 'en français', '10 $', 'rien')
    const dataDir = mkdtempSync(path.join(os.tmpdir(), 'clone-intake-'))
    const { services } = fakeServices(ch)
    const report = await runClone({ dataDir, cloneId: 'c1', services, answers: intakeAnswers(state) })
    expect(report.outcome).toBe('cloned')
  })
})

describe('intake: review fixes', () => {
  it('finds the language after an earlier « en », and one video link means one video', () => {
    expect(intakeTurn(startIntake(), `J'en veux une copie de ${CHANNEL} en espagnol`).state.draft.language).toBe('es')
    expect(intakeTurn(startIntake(), `clone cette vidéo ${VIDEO}`).state.draft.intent).toBe('copy-video')
  })
  it('the word « style » inside a sentence is not a style pick', () => {
    const t = intakeTurn(startIntake(), `garde le même style que ${CHANNEL}`)
    expect(t.state.draft.style).toBeUndefined()
    expect(intakeTurn(startIntake(), 'le style : documentaire sombre').state.draft.style).toBe('documentaire sombre')
  })
  it('a remark about one input said unprompted does not settle the question', () => {
    const a = say(startIntake(), CHANNEL, 'en français', '5 $').state
    // the question is still asked once the brief is complete (an optional question: it never holds the start, decision 0110)
    expect(a.asked).toBe('humanInputs')
    const early = intakeTurn(startIntake(), 'je peux fournir ma voix')
    expect(early.state.draft.humanInputs).toMatchObject({ voice: true, face: false })
    expect(early.state.inputsSettled).toBe(false)
    expect(early.missing).not.toContain('humanInputs')
    expect(intakeTurn(a, 'oui, tout').state.draft.humanInputs).toEqual({ face: true, voice: true, footage: true })
  })
  it('says so when it takes every axis because none was recognised', () => {
    const none = say(startIntake(), 'je veux mélanger', CHANNEL, VIDEO).state
    expect(intakeTurn(none, 'peu importe').reply.map((r) => r.key)).toContain('clone.intake.reply.axesAll')
  })
})

describe('P0 exit check', () => {
  const ok = { schema: 'atelier.clone.brief/1' as const, cloneId: 'c', createdAt: 'now', intent: 'copy-channel' as const, references: [{ url: CHANNEL, kind: 'channel' as const, axes: [] }], style: null, language: 'fr', sourceLanguage: null, testBudgetUsd: 5, humanInputs: { face: false, voice: false, footage: false }, ownChannel: false, said: [] }
  it('refuses a reference that is not a link, a bad language code, a silly budget', async () => {
    expect(checkP0(ok).ok).toBe(true)
    expect(checkP0({ ...ok, references: [{ url: 'finary', kind: 'channel', axes: [] }] }).problems.join()).toMatch(/not a link/)
    expect(checkP0({ ...ok, language: 'français' }).problems.join()).toMatch(/language code/)
    expect(checkP0({ ...ok, testBudgetUsd: 5000 }).problems.join()).toMatch(/not a test/)
    expect(runP0).toBeTypeOf('function')
  })
  it('the conversation refuses to hand over an unfinished brief', () => {
    expect(() => intakeAnswers(startIntake())).toThrow(/not finished/)
  })
})
