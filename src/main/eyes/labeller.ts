// The vision model of « watch a whole video »: Claude at Haiku level (the « fast » tier, route role `video_watcher`), on the user's
// Claude subscription when the route is Claude Code, through the same ledger as every model call. It looks at contact sheets and
// names the counted shots (src/engine/watch/label.ts); it never sets a shot's time.
import type { Labeller } from '../../engine/watch/label'
import type { AskInput, AskResult } from '../llm/ask'

export const WATCH_ROLE = 'video_watcher'
const SYSTEM = 'You are a meticulous video editor logging shots from contact sheets. You answer only with the JSON asked for.'

export function claudeLabeller(ask: (input: AskInput) => Promise<AskResult>): Labeller {
  return async (r) => {
    const a = await ask({
      role: WATCH_ROLE,
      tier: 'fast',
      system: SYSTEM,
      prompt: r.prompt,
      images: r.images,
      maxTokens: 8000,
      estimate: { inputTokens: 6000 * Math.max(1, r.images.length), outputTokens: 4000, cacheReadTokens: 0, cacheWriteTokens: 0 },
      ...(r.signal ? { signal: r.signal } : {})
    })
    return {
      text: a.text,
      inputTokens: a.usage.inputTokens + a.usage.cacheReadTokens + a.usage.cacheWriteTokens,
      outputTokens: a.usage.outputTokens,
      usd: a.costUsd,
      subscription: a.providerId === 'claude-code'
    }
  }
}
