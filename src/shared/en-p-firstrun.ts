// English strings of the first run (same keys as fr-p-firstrun.ts).
import type { MessageKey } from './fr'

export const enPFirstRun: Partial<Record<MessageKey, string>> = {
  'onb.channel.later': 'Later',
  'onb.channel.later.desc': 'I’ll look around the studio first and add a channel afterwards.',
  'onb.channel.later.note': 'No problem: we stop here. You land on an empty Home, with an “Add a channel” button for when you’re ready.',

  'onb.live.engine.loading': 'Checking where your account stands…',
  'onb.live.engine.where.remote': 'On the team computer {name}',
  'onb.live.engine.where.remote.hint':
    'Your app is linked to the team computer: your account is connected there, not on this computer. Type the commands in the terminal of its remote screen.',
  'onb.live.engine.cli.loading': 'Looking for Claude Code…',
  'onb.live.engine.cli.found': 'Claude Code is installed.',
  'onb.live.engine.cli.missing': 'Claude Code is not installed.',
  'onb.live.engine.cli.unknown': 'I couldn’t check whether Claude Code is installed.',
  'onb.live.engine.install.title': 'Install Claude Code',
  'onb.live.engine.install.body': 'You need Node.js (version 18 or later), then this command in a terminal:',
  'onb.live.engine.install.mac': 'On a Mac: install Node.js (nodejs.org, or “brew install node”), type the command in Terminal, then quit and reopen Atelier.',
  'onb.live.engine.install.windows': 'On Windows: install Node.js (nodejs.org), type the command in PowerShell, then quit and reopen Atelier.',
  'onb.live.engine.install.remote': 'On the team computer: type the command in the terminal of its remote screen.',
  'onb.live.engine.install.retry': 'Check again',
  'onb.live.engine.codex.install': 'The Codex program must be on the computer. If it is missing, install it with:',
  'onb.live.engine.add.claude-code': 'Add my Claude Code account',
  'onb.live.engine.add.codex': 'Add my Codex account',
  'onb.live.engine.add.hint': 'Atelier makes a folder just for this account and opens a terminal. You sign in there yourself: Atelier never sees your credentials.',
  'onb.live.engine.login.title': 'Waiting for your sign-in',
  'onb.live.engine.login.claude-code': 'In the terminal, type /login, sign in with your Claude account, then /exit. Then come back here.',
  'onb.live.engine.login.codex': 'In the terminal, follow the ChatGPT sign-in in the browser. Then come back here.',
  'onb.live.engine.command': 'If no terminal opened, type this command:',
  'onb.live.engine.command.remote': 'On the team computer, type this command in the remote screen’s terminal:',
  'onb.live.engine.reopen': 'Reopen the terminal',
  'onb.live.engine.check': 'Check',
  'onb.live.engine.check.note': '“Check” asks Haiku one tiny question with this account, so on your subscription (a few tokens, recorded in the spend ledger).',
  'onb.live.engine.checking': 'Checking…',
  'onb.live.engine.failed': 'The check didn’t work.',
  'onb.live.engine.ready': 'Account connected and checked.',
  'onb.live.engine.warning': 'You can go on without a checked account, but the agents won’t work until it’s done. You can do it later in Settings › Claude.',
  'onb.live.engine.more': 'Several subscriptions? Add the other accounts in Settings › Claude.',

  'home.first.title': 'Add your first channel',
  'home.first.body': 'One you already have or a new one: the agent team, the pipelines and the schedule are built around it.',
  'home.first.action': 'Add a channel'
}
