// English side of fr-claude-usage.ts (what a run consumes on the user's Claude subscription).
import type { MessageKey } from './fr'

export const enClaudeUsage: Partial<Record<MessageKey, string>> = {
  'claudeUsage.video': 'Claude: {tokens} tokens (≈ ${usd} API-equivalent)',
  'claudeUsage.videoDetail': '{calls} calls, {time} of work. Counted on your subscription: not a price paid to Atelier.',
  'claudeUsage.title': 'Your Claude subscription usage',
  'claudeUsage.week': 'Last 7 days: {tokens} tokens (≈ ${usd} API-equivalent)',
  'claudeUsage.weekDetail': '{calls} calls, {time} of work. {input} tokens read, {output} written, {cache} from the cache.',
  'claudeUsage.note':
    'The « API equivalent » is what the same tokens would cost with an Anthropic API key. Your subscription does not bill it, and neither does Atelier.',
  'claudeUsage.empty': 'No call to Claude on your subscription yet.',
  'claudeUsage.model': '{model}: {tokens} tokens, {calls} calls'
}
