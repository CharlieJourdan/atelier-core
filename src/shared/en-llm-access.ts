// English side of fr-llm-access.ts (the beta rule on models, decision 0038).
import type { MessageKey } from './fr'

export const enLlmAccess: Partial<Record<MessageKey, string>> = {
  'llmAccess.locked.title': 'Connect your Claude or Codex subscription',
  'llmAccess.locked.blurb':
    'During the beta, the agent team, Atlas and script writing only work with a connected Claude Code or Codex subscription. Imported scripts stay free and always available.',
  'llmAccess.locked.reconnect': 'Your account “{labels}” stopped answering: its sign-in expired. Reconnect it.',
  'llmAccess.locked.button': 'Connect my subscription',
  'llmAccess.locked.reconnectButton': 'Reconnect',
  'llmAccess.locked.script': 'Writing the script needs a connected Claude Code or Codex subscription (beta rule). You can import your own script: it is free.',
  'llmAccess.error.locked':
    'A connected Claude Code or Codex subscription is needed for the agents and for script writing (beta rule). Go to Settings › Claude: “Add my account” or “Reconnect”.',
  'llmAccess.error.noApiKey': 'The director is set to your Anthropic API key, but no key is saved. Add it in Settings › Claude, or choose your subscription.',
  'llmAccess.chat.noAccount':
    'I cannot answer right now: no connected Claude or Codex subscription works.{who} Go to Settings › Claude and click “Reconnect” (or “Add my account”). Your message is kept: I will answer as soon as an account works.',
  'llmAccess.chat.who': ' The account “{labels}” must be reconnected (its sign-in expired).',
  'llmAccess.chat.back': 'A Claude account works again: I am picking up what was waiting.',
  'llmAccess.power.locked': 'The team cannot be switched on: no connected Claude or Codex subscription works. Go to Settings › Claude.',
  'llmAccess.account.reconnect': 'To reconnect',
  'llmAccess.director.title': 'The director (scene cuts and editing)',
  'llmAccess.director.blurb':
    'It runs on your Claude subscription (nothing more to pay) or on your Anthropic API key (paid per token, counted in the render quote). Default: your subscription when one is connected.',
  'llmAccess.director.subscription': 'My Claude subscription',
  'llmAccess.director.api': 'My Anthropic API key',
  'llmAccess.director.noKey': 'No API key saved: add it below to choose this option.',
  'llmAccess.director.effective.subscription': 'Right now: on your subscription.',
  'llmAccess.director.effective.api': 'Right now: on your API key.',
  'llmAccess.director.effective.none': 'Right now: no connected subscription and no API key. The director cannot run.'
}
