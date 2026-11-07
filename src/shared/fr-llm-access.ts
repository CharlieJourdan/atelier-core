// The beta rule on models (decision 0038): agents and script writing on a connected Claude Code or Codex subscription
// only; the director on the subscription or the Anthropic API key; imported scripts always free.
export const frLlmAccess = {
  'llmAccess.locked.title': 'Branche ton abonnement Claude ou Codex',
  'llmAccess.locked.blurb':
    'Pendant la bêta, l’équipe d’agents, Atlas et l’écriture des scripts marchent uniquement avec un abonnement Claude Code ou Codex connecté. Les scripts importés restent gratuits et toujours possibles.',
  'llmAccess.locked.reconnect': 'Ton compte « {labels} » ne répond plus : sa connexion a expiré. Reconnecte-le.',
  'llmAccess.locked.button': 'Connecter mon abonnement',
  'llmAccess.locked.reconnectButton': 'Reconnecter',
  'llmAccess.locked.script': 'Écrire le script demande un abonnement Claude Code ou Codex connecté (règle de la bêta). Tu peux importer ton propre script : c’est gratuit.',
  'llmAccess.error.locked':
    'Il faut un abonnement Claude Code ou Codex connecté pour faire travailler les agents et écrire des scripts (règle de la bêta). Va dans Réglages › Claude : « Ajouter mon compte » ou « Reconnecter ».',
  'llmAccess.error.noApiKey':
    'Le réalisateur est réglé sur ta clé API Anthropic, mais aucune clé n’est enregistrée. Ajoute-la dans Réglages › Claude, ou choisis ton abonnement.',
  'llmAccess.chat.noAccount':
    'Je ne peux pas te répondre pour l’instant : aucun abonnement Claude ou Codex connecté ne marche.{who} Va dans Réglages › Claude et clique « Reconnecter » (ou « Ajouter mon compte »). Ton message est gardé : je te réponds dès qu’un compte marche.',
  'llmAccess.chat.who': ' Le compte « {labels} » doit être reconnecté (sa connexion a expiré).',
  'llmAccess.chat.back': 'Un compte Claude marche de nouveau : je reprends ce qui attendait.',
  'llmAccess.power.locked': 'Impossible d’allumer l’équipe : aucun abonnement Claude ou Codex connecté ne marche. Va dans Réglages › Claude.',
  'llmAccess.account.reconnect': 'À reconnecter',
  'llmAccess.director.title': 'Le réalisateur (découpage en scènes et montage)',
  'llmAccess.director.blurb':
    'Il tourne sur ton abonnement Claude (rien de plus à payer) ou sur ta clé API Anthropic (payée au token, comptée dans le devis du rendu). Par défaut : ton abonnement s’il est connecté.',
  'llmAccess.director.subscription': 'Mon abonnement Claude',
  'llmAccess.director.api': 'Ma clé API Anthropic',
  'llmAccess.director.noKey': 'Aucune clé API enregistrée : ajoute-la plus bas pour pouvoir choisir cette option.',
  'llmAccess.director.effective.subscription': 'En ce moment : sur ton abonnement.',
  'llmAccess.director.effective.api': 'En ce moment : sur ta clé API.',
  'llmAccess.director.effective.none': 'En ce moment : ni abonnement connecté, ni clé API. Le réalisateur ne peut pas tourner.'
} as const
