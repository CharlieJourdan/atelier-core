// French strings of the help dialog (« Aide »). Owned by that area only. Not registered in fr-proto.ts yet: the lead wires it
// (`...frPHelp` there, `...enPHelp` in en.ts). Until then HelpDialog reads this file directly through a local dictionary.
export const frPHelp = {
  'help.title': 'Aide',
  'help.description': 'Les raccourcis clavier d’Atelier.',
  'help.close': 'Fermer',

  'help.shortcuts': 'Raccourcis',
  'help.shortcut.search': 'Rechercher partout',
  'help.shortcut.sidebar': 'Afficher ou masquer la barre latérale',
  'help.shortcut.atlas': 'Ouvrir ou fermer Atlas',
  'help.shortcut.hint': 'Sur Mac, Cmd remplace Ctrl.'
} as const

export type HelpKey = keyof typeof frPHelp
