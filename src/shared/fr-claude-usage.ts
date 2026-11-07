// What a run consumes on the user's Claude subscription (usage-claude). Never presented as money Atelier charges.
export const frClaudeUsage = {
  'claudeUsage.video': 'Claude : {tokens} tokens (≈ {usd} $ en équivalent API)',
  'claudeUsage.videoDetail': '{calls} appels, {time} de travail. Compté sur ton abonnement : ce n’est pas un prix payé à Atelier.',
  'claudeUsage.title': 'Consommation de ton abonnement Claude',
  'claudeUsage.week': 'Sur les 7 derniers jours : {tokens} tokens (≈ {usd} $ en équivalent API)',
  'claudeUsage.weekDetail': '{calls} appels, {time} de travail. {input} tokens lus, {output} écrits, {cache} venus du cache.',
  'claudeUsage.note':
    'L’« équivalent API » est ce que les mêmes tokens coûteraient avec une clé API Anthropic. Ton abonnement ne le facture pas, et Atelier non plus.',
  'claudeUsage.empty': 'Aucun appel à Claude sur ton abonnement pour l’instant.',
  'claudeUsage.model': '{model} : {tokens} tokens, {calls} appels'
} as const
