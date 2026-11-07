// What leaving a step does in real mode (the flow awaits it before moving on, and shows the error if it fails).
import type { LiveOnboardingSession } from '@/proto/live/onboarding-live'
import type { ProtoChannel } from '@/proto/types'
import type { Answers } from '../model'
import { footageAnswers, liveDraftOf } from './draft'

export async function leaveStep(session: LiveOnboardingSession, step: number, a: Answers, known: Pick<ProtoChannel, 'name' | 'handle'>[]): Promise<void> {
  if (step === 3) await session.ensureChannel(liveDraftOf(a, known))
  // The questions are the last word on the footage: the analysis is updated, then the pipeline is made from it.
  if (step === 6) await session.finishQuestions(liveDraftOf(a, known), footageAnswers(a))
}
