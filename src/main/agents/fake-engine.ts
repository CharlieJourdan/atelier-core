// The production engine's Claude roles for the deterministic fake team (ATELIER_FAKE_LLM=1 and tests, never a model): the
// packaging and the thumbnail concepts get small valid answers; the story architect says « no model connected », so an
// imported script goes through cut into plain beats (as without a subscription). Other roles are left to the caller (the
// director's scene pass falls back to base shots on an answer it cannot read).
import { lockedError } from '../llm/access'
import type { FakeReply } from '../llm/fake'
import type { CompletionRequest } from '../llm/types'

const json = (v: unknown): FakeReply => ({ text: JSON.stringify(v), chunkSize: 400 })

export function fakeEngineReply(req: CompletionRequest): FakeReply | null {
  const system = req.system ?? ''
  if (system.includes('You design YouTube thumbnails')) {
    return json({ concepts: [{ headline: 'LE CIEL BLEU', position: 'bottom', prompt: 'A wide blue sky over a calm sea at noon, soft light, blue and white palette, the lower third left calm.' }] })
  }
  if (system.includes('You write the YouTube packaging')) {
    return json({
      titles: ['Pourquoi le ciel est bleu', 'Le bleu du ciel en trente secondes'],
      description: 'La lumière du soleil traverse l’air et se disperse. Le bleu se disperse plus que le rouge. Voilà pourquoi tout le ciel paraît bleu.',
      tags: ['ciel', 'lumière', 'science', 'physique', 'couleurs']
    })
  }
  if (system.includes('You are the story architect')) throw lockedError()
  return null
}
