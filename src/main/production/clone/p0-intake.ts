// P0 — Intake (spec §2 P0): the short conversation's answers become a written brief. Chantier E owns the conversation;
// this phase only turns its answers into the artefact and checks it.
import { Brief } from '../../../shared/clone'
import { artefactHead, type PhaseContext } from './context'
import { schemaProblems, verdict, type ExitCheck } from './exit-check'

/** What the intake conversation collected. */
export type IntakeAnswers = Omit<Brief, 'schema' | 'cloneId' | 'createdAt'>

export async function runP0(ctx: PhaseContext, answers: IntakeAnswers): Promise<Brief> {
  const brief: Brief = { ...artefactHead(ctx, 'brief'), ...answers }
  ctx.decide('p0', `intent ${brief.intent}`, `budget ${brief.testBudgetUsd} $, own channel ${brief.ownChannel}`)
  return brief
}

/** Refuses a brief that cannot drive a clone: no budget, a translation without both languages, an own-channel intent not
 *  marked own, a single-video copy without a video link, a mix with one reference. */
export function checkP0(brief: Brief): ExitCheck {
  const p = schemaProblems(Brief, brief)
  if (p.length) return verdict(p)
  if (brief.intent === 'translate' && (!brief.sourceLanguage || brief.sourceLanguage === brief.language)) p.push('a translation needs a source language different from the target')
  if (brief.intent === 'own-channel' && !brief.ownChannel) p.push('intent own-channel but ownChannel is false')
  if (brief.intent === 'copy-video' && !brief.references.some((r) => r.kind === 'video')) p.push('copy-video needs a video link')
  for (const r of brief.references) if (!/^https?:\/\/\S+$/i.test(r.url)) p.push(`reference ${r.url} is not a link`)
  if (!/^[a-z]{2,3}(-[A-Za-z0-9]+)*$/.test(brief.language)) p.push(`language ${brief.language} is not a language code`)
  if (brief.testBudgetUsd > 1000) p.push('a test budget over 1000 $ is not a test')
  if (brief.intent === 'mix' && brief.references.length < 2) p.push('a mix needs at least two references')
  return verdict(p)
}
