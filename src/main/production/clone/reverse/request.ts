// reverse-pipeline: a ReverseRequest (src/shared/reverse/pipeline.ts) written as the brief the cloning engine runs from, without
// the intake conversation. Pure.
//
// The mapping (tests/unit/reverse-request.test.ts holds the table):
//   links      → Brief.references; a link without its kind is read from its URL (`/watch`, `youtu.be/`, `/shorts/` = video;
//                `@handle`, `/channel/`, `/c/`, `/user/` = channel; anything else = channel, the corpus phase lists it).
//   copy       → copy-video for a single video link, own-channel when `ownChannel` and a channel link, else copy-channel.
//   translate  → intent translate, the request's language as the target; the source language is the one the instructions name
//                (« from English »), else `und` (BCP-47 « undetermined »: P1–P2 read the reference, the voice speaks the target).
//   adapt/bend → copy (channel or video as above); the user's instructions are kept in `Brief.said` so later phases see them.
//   mix        → intent mix (two links at least); each link's axes map onto the brief's inspiration axes, `sourcing` (what the
//                pictures are and where they come from) going to `editing`, the brief's axis that holds the picture mix.
//   supplies   → Brief.humanInputs (absent = nothing supplied: placeholders stand in).
//   language   → the request's; else the one its instructions name; else `fr` (the app's language, what Charlie makes).
import type { Brief, INSPIRATION_AXES } from '../../../../shared/clone'
import type { PipelineAxis, ReverseRequest } from '../../../../shared/reverse/pipeline'
import type { IntakeAnswers } from '../p0-intake'
import { understand } from '../intake/parse'

type InspirationAxis = (typeof INSPIRATION_AXES)[number]

/** The language when neither the request nor its instructions say one. */
export const DEFAULT_LANGUAGE = 'fr'
/** BCP-47 « undetermined »: a translation whose source language is not said (the reference is read as it is). */
export const UNKNOWN_SOURCE_LANGUAGE = 'und'

/** A link's kind read from its URL. */
export function linkKind(url: string): 'channel' | 'video' {
  if (/\/watch\b|[?&]v=|youtu\.be\/|\/shorts\//i.test(url)) return 'video'
  return 'channel'
}

/** A pipeline axis as the brief's inspiration axis (`sourcing` has none of its own: the edit holds the picture mix). */
export function briefAxis(axis: PipelineAxis): InspirationAxis {
  return axis === 'sourcing' ? 'editing' : axis
}

const said = (s: string): string => s.trim().slice(0, 280)

/** The brief's answers for a request (throws on a request the engine cannot run: a mix of one link, a translation without its
 *  target language). */
export function answersFromRequest(req: ReverseRequest): IntakeAnswers {
  const references: Brief['references'] = req.links.map((l) => ({
    url: l.url.trim(),
    kind: l.kind ?? linkKind(l.url),
    axes: [...new Set(l.axes.map(briefAxis))]
  }))
  const words = req.instructions.trim() ? understand(req.instructions, null) : null
  const language = req.language ?? words?.language ?? DEFAULT_LANGUAGE
  let intent: Brief['intent']
  let sourceLanguage: string | null = null
  if (req.action === 'mix') {
    if (references.length < 2) throw new Error('a mix needs at least two links')
    intent = 'mix'
  } else if (req.action === 'translate') {
    if (!req.language && !words?.language) throw new Error('a translation needs its target language')
    intent = 'translate'
    const from = words?.sourceLanguage ?? null
    sourceLanguage = from && from !== language ? from : UNKNOWN_SOURCE_LANGUAGE
  } else {
    const single = references.length === 1 && references[0]!.kind === 'video'
    intent = single ? 'copy-video' : req.ownChannel && references[0]!.kind === 'channel' ? 'own-channel' : 'copy-channel'
  }
  const lines = [`reverse ${req.action}`, ...(req.instructions.trim() ? [said(req.instructions)] : [])]
  return {
    intent,
    references,
    style: null,
    language,
    sourceLanguage,
    testBudgetUsd: req.testBudgetUsd,
    humanInputs: req.supplies ?? { face: false, voice: false, footage: false },
    ownChannel: req.ownChannel,
    said: lines
  }
}

/** The request a clone started from the intake would have been (a clone made before reverse-pipeline has none saved). */
export function requestFromBrief(brief: Pick<Brief, 'intent' | 'references' | 'language' | 'testBudgetUsd' | 'humanInputs' | 'ownChannel' | 'said'>): ReverseRequest {
  const action: ReverseRequest['action'] = brief.intent === 'translate' ? 'translate' : brief.intent === 'mix' ? 'mix' : brief.intent === 'inspiration' ? 'adapt' : 'copy'
  return {
    links: brief.references.slice(0, 6).map((r) => ({ url: r.url, kind: r.kind, axes: r.axes })),
    action,
    instructions: brief.said.join(' · ').slice(0, 4000),
    language: brief.language,
    testBudgetUsd: Math.min(1000, Math.max(0.01, brief.testBudgetUsd)),
    supplies: brief.humanInputs,
    ownChannel: brief.ownChannel
  }
}
