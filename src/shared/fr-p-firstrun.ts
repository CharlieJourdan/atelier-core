// French strings of the first run (2026-10-26): « Plus tard » on the channel question, the real Claude connection of the
// onboarding's engine step, and Accueil's « Ajoute ta première chaîne ». One file per area (see fr-proto.ts).
export const frPFirstRun = {
  'onb.channel.later': 'Plus tard',
  'onb.channel.later.desc': 'Je découvre d’abord l’atelier. J’ajouterai une chaîne ensuite.',
  'onb.channel.later.note': 'Pas de souci : on s’arrête là. Tu arrives sur l’Accueil, vide, avec un bouton « Ajouter une chaîne » pour quand tu seras prêt.',

  'onb.live.engine.loading': 'Je regarde où en est ton compte…',
  'onb.live.engine.where.remote': 'Sur l’ordinateur d’équipe {name}',
  'onb.live.engine.where.remote.hint':
    'Ton appli est reliée à l’ordinateur d’équipe : ton compte se branche là-bas, pas sur cet ordinateur. Les commandes se tapent dans le terminal de son écran à distance.',
  'onb.live.engine.cli.loading': 'Je cherche Claude Code…',
  'onb.live.engine.cli.found': 'Claude Code est installé.',
  'onb.live.engine.cli.missing': 'Claude Code n’est pas installé.',
  'onb.live.engine.cli.unknown': 'Je n’ai pas pu vérifier si Claude Code est installé.',
  'onb.live.engine.install.title': 'Installer Claude Code',
  'onb.live.engine.install.body': 'Il faut Node.js (version 18 ou plus récente), puis cette commande dans un terminal :',
  'onb.live.engine.install.mac': 'Sur Mac : installe Node.js (nodejs.org, ou « brew install node »), tape la commande dans Terminal, puis ferme et rouvre Atelier.',
  'onb.live.engine.install.windows': 'Sur Windows : installe Node.js (nodejs.org), tape la commande dans PowerShell, puis ferme et rouvre Atelier.',
  'onb.live.engine.install.remote': 'Sur l’ordinateur d’équipe : tape la commande dans le terminal de son écran à distance.',
  'onb.live.engine.install.retry': 'Vérifier à nouveau',
  'onb.live.engine.codex.install': 'Il faut le programme Codex sur l’ordinateur. S’il manque, installe-le avec :',
  'onb.live.engine.add.claude-code': 'Ajouter mon compte Claude Code',
  'onb.live.engine.add.codex': 'Ajouter mon compte Codex',
  'onb.live.engine.add.hint': 'Atelier crée un dossier rien que pour ce compte et ouvre un terminal. Tu t’y connectes toi-même : Atelier ne voit jamais tes identifiants.',
  'onb.live.engine.login.title': 'En attente de ta connexion',
  'onb.live.engine.login.claude-code': 'Dans le terminal, tape /login, connecte-toi avec ton compte Claude, puis /exit. Reviens ensuite ici.',
  'onb.live.engine.login.codex': 'Dans le terminal, suis la connexion ChatGPT dans le navigateur. Reviens ensuite ici.',
  'onb.live.engine.command': 'Si aucun terminal ne s’est ouvert, tape cette commande :',
  'onb.live.engine.command.remote': 'Sur l’ordinateur d’équipe, tape cette commande dans le terminal de l’écran à distance :',
  'onb.live.engine.reopen': 'Rouvrir le terminal',
  'onb.live.engine.check': 'Vérifier',
  'onb.live.engine.check.note':
    '« Vérifier » pose une toute petite question à Haiku avec ce compte, donc sur ton abonnement (quelques tokens, notés dans le registre des dépenses).',
  'onb.live.engine.checking': 'Vérification en cours…',
  'onb.live.engine.failed': 'La vérification n’a pas marché.',
  'onb.live.engine.ready': 'Compte connecté et vérifié.',
  'onb.live.engine.warning':
    'Tu peux continuer sans compte vérifié, mais les agents ne travailleront pas tant que ce n’est pas fait. Tu pourras le faire plus tard dans Réglages › Claude.',
  'onb.live.engine.more': 'Plusieurs abonnements ? Tu ajouteras les autres comptes dans Réglages › Claude.',

  'home.first.title': 'Ajoute ta première chaîne',
  'home.first.body': 'Une chaîne que tu as déjà ou une nouvelle : l’équipe d’agents, les pipelines et le planning se construisent autour.',
  'home.first.action': 'Ajouter une chaîne'
} as const
