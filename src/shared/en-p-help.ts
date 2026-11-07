// English strings of the help dialog (keys of fr-p-help.ts). Missing keys fall back to French.
import type { HelpKey } from './fr-p-help'

export const enPHelp: Partial<Record<HelpKey, string>> = {
  'help.title': 'Help',
  'help.description': 'Atelier keyboard shortcuts.',
  'help.close': 'Close',

  'help.shortcuts': 'Shortcuts',
  'help.shortcut.search': 'Search everything',
  'help.shortcut.sidebar': 'Show or hide the sidebar',
  'help.shortcut.atlas': 'Open or close Atlas',
  'help.shortcut.hint': 'On a Mac, Cmd replaces Ctrl.'
}
