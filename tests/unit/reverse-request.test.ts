// reverse-pipeline: a ReverseRequest written as the brief the cloning engine runs from (no intake conversation): the mapping
// table, and every brief it writes passes P0's own check.
import { describe, expect, it } from 'vitest'
import { ReverseRequest } from '../../src/shared/reverse/pipeline'
import { checkP0, type IntakeAnswers } from '../../src/main/production/clone/p0-intake'
import { DEFAULT_LANGUAGE, UNKNOWN_SOURCE_LANGUAGE, answersFromRequest, briefAxis, linkKind, requestFromBrief } from '../../src/main/production/clone/reverse/request'

const CH = 'https://www.youtube.com/@lemondeenpov'
const VID = 'https://www.youtube.com/watch?v=abc123'
const req = (o: Record<string, unknown>) => ReverseRequest.parse({ testBudgetUsd: 5, ...o })
const brief = (a: IntakeAnswers) => ({ schema: 'atelier.clone.brief/1' as const, cloneId: 'c', createdAt: 'now', ...a })

describe('ReverseRequest → brief', () => {
  it('reads a link’s kind from its URL', () => {
    const table: [string, 'channel' | 'video'][] = [
      [VID, 'video'], ['https://youtu.be/abc123', 'video'], ['https://www.youtube.com/shorts/abc123', 'video'],
      [CH, 'channel'], ['https://www.youtube.com/channel/UC123', 'channel'], ['https://www.youtube.com/c/Name', 'channel'], ['https://www.youtube.com/user/name', 'channel']
    ]
    for (const [url, kind] of table) expect(linkKind(url), url).toBe(kind)
  })

  it('maps each action onto an intent (the table)', () => {
    const rows: [Record<string, unknown>, Partial<IntakeAnswers>][] = [
      [{ links: [{ url: VID }] }, { intent: 'copy-video', language: DEFAULT_LANGUAGE, sourceLanguage: null }],
      [{ links: [{ url: CH }] }, { intent: 'copy-channel' }],
      [{ links: [{ url: CH }], ownChannel: true }, { intent: 'own-channel', ownChannel: true }],
      [{ links: [{ url: CH }], action: 'translate', language: 'en' }, { intent: 'translate', language: 'en', sourceLanguage: UNKNOWN_SOURCE_LANGUAGE }],
      [{ links: [{ url: CH }], action: 'translate', language: 'es', instructions: 'traduis depuis l’anglais vers l’espagnol' }, { intent: 'translate', language: 'es' }],
      [{ links: [{ url: CH }], action: 'adapt', instructions: 'mon sujet : la cuisine' }, { intent: 'copy-channel' }],
      [{ links: [{ url: VID }], action: 'bend', instructions: 'plus de motion' }, { intent: 'copy-video' }],
      [{ links: [{ url: CH, axes: ['script', 'sourcing'] }, { url: 'https://www.youtube.com/@other', axes: ['voice'] }], action: 'mix' }, { intent: 'mix' }],
      [{ links: [{ url: CH }], language: 'de' }, { language: 'de' }],
      [{ links: [{ url: CH }], instructions: 'en anglais stp' }, { language: 'en' }]
    ]
    for (const [r, want] of rows) {
      const a = answersFromRequest(req(r))
      expect(a, JSON.stringify(r)).toMatchObject(want)
      expect(checkP0(brief(a)).problems, JSON.stringify(r)).toEqual([])
    }
  })

  it('keeps his words, supplies and budget; mix axes go onto the brief’s axes', () => {
    const a = answersFromRequest(req({ links: [{ url: CH, axes: ['sourcing', 'editing', 'motion'] }, { url: VID }], action: 'mix', instructions: 'le script de A, la voix de B', supplies: { face: true, voice: false, footage: true }, testBudgetUsd: 12 }))
    expect(a.references[0]).toEqual({ url: CH, kind: 'channel', axes: ['editing', 'motion'] })
    expect(a.references[1]).toEqual({ url: VID, kind: 'video', axes: [] })
    expect(a.said).toEqual(['reverse mix', 'le script de A, la voix de B'])
    expect(a.humanInputs).toEqual({ face: true, voice: false, footage: true })
    expect(a.testBudgetUsd).toBe(12)
    expect(answersFromRequest(req({ links: [{ url: CH }] })).humanInputs).toEqual({ face: false, voice: false, footage: false })
    expect(briefAxis('sourcing')).toBe('editing')
    expect(briefAxis('voice')).toBe('voice')
    // the kind given wins over the URL
    expect(answersFromRequest(req({ links: [{ url: CH, kind: 'video' }] })).references[0]!.kind).toBe('video')
  })

  it('refuses what the engine cannot run', () => {
    expect(() => answersFromRequest(req({ links: [{ url: CH }], action: 'mix' }))).toThrow(/two links/)
    expect(() => answersFromRequest(req({ links: [{ url: CH }], action: 'translate' }))).toThrow(/target language/)
  })

  it('a clone made from the intake gets the request it would have been', () => {
    const a = answersFromRequest(req({ links: [{ url: CH }], action: 'translate', language: 'en', ownChannel: false }))
    const r = ReverseRequest.parse(requestFromBrief(a))
    expect(r).toMatchObject({ action: 'translate', language: 'en', testBudgetUsd: 5, links: [{ url: CH, kind: 'channel' }] })
  })
})
