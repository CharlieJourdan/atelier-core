// French strings of real mode for Cerveau and Monétisation (live data: ideas, measured costs, revenues entered). One
// file for this area, so parallel work never edits the same file. Keys: `live.*` (badges, notes), `brain.idea.*`
// (the idea form), `money2.kind.*` (the kinds the database adds).
export const frPLiveBrain = {
  /* ---------- labels of what is not real yet ---------- */
  'live.demo.badge': 'Données de démonstration',
  'live.demo.competitors': 'Exemple : le suivi des vraies chaînes concurrentes n’est pas encore branché. Cette carte montre ce que tu y verras.',
  'live.demo.niches': 'Exemple : la carte des niches (demande et concurrence) n’a pas encore de source réelle.',
  'live.demo.credits': 'Exemple : le solde de crédits n’est pas encore branché, rien n’est acheté.',

  /* ---------- Cerveau ---------- */
  'brain.source.manual': 'Saisie à la main',
  'brain.idea.add': 'Nouvelle idée',
  'brain.idea.edit': 'Modifier',
  'brain.idea.delete': 'Supprimer',
  'brain.idea.unscored': 'Pas encore notée par un agent',
  'brain.idea.dialog.new': 'Nouvelle idée',
  'brain.idea.dialog.edit': 'Modifier l’idée',
  'brain.idea.dialog.hint': 'Une idée de vidéo : un titre et l’angle à prendre. Les agents la reprennent quand tu la lances.',
  'brain.idea.field.channel': 'Chaîne',
  'brain.idea.field.title': 'Titre',
  'brain.idea.field.title.ph': 'Ex. Le manuscrit de Voynich',
  'brain.idea.field.angle': 'Angle',
  'brain.idea.field.angle.ph': 'Ce qui rend ce sujet différent des autres',
  'brain.idea.save': 'Enregistrer',
  'brain.ideas.pick': 'Chaîne pour les idées demandées',
  'brain.ideas.noChannel': 'Crée d’abord une chaîne pour y ranger des idées.',
  'brain.ideas.empty': 'Aucune idée pour l’instant. Écris-en une ou demande-en cinq à l’agent.',

  /* ---------- Monétisation ---------- */
  'live.money.loading': 'Chargement des chiffres…',
  'live.money.subtitle': '{n} vidéos publiées ce mois-ci · {scope}',
  'live.money.kpi.revenue': 'Revenus du mois',
  'live.money.kpi.cost': 'Coûts du mois',
  'live.money.kpi.cost.hint': 'mesurés, abonnements saisis inclus',
  'live.money.chart.hint': 'Huit dernières semaines, toutes chaînes. Les revenus sont ceux que tu as saisis.',
  'live.money.chart.allChannels': 'La courbe montre toutes les chaînes, quelle que soit la sélection.',
  'live.money.ai': 'IA : appels et abonnements',
  'live.money.table.others': 'Autres revenus',
  'live.money.videos.note': 'Coût = appels au modèle + crédits dépensés pour la vidéo. Les vues ne sont pas connues : pas de revenu par vidéo.',
  'live.money.videos.empty': 'Aucune vidéo n’a encore coûté quoi que ce soit ce mois-ci.',
  'live.money.ledger.title': 'Journal des dépenses',
  'live.money.ledger.spent': '{usd} dépensés ce mois-ci',
  'live.money.ledger.calls': 'Appels au modèle : {n}',
  'live.money.ledger.reserved': '{usd} réservés pour des appels en cours',
  'live.money.ledger.cap': 'Plafond du mois : {usd}',
  'live.money.entries.hint': 'Seuls les revenus se saisissent ici. Les coûts viennent du journal des dépenses : modèles, crédits, abonnements saisis.',
  'live.money.entries.delete': 'Supprimer ce revenu',
  'live.money.subs.price': 'Prix par mois en €',
  'live.money.subs.unset': 'Prix à renseigner',
  'live.money.subs.counted': 'Compté dans les coûts au prix que tu saisis, réparti selon les vidéos publiées.',
  'live.money.subs.empty': 'Aucun compte IA configuré.',
  'money2.kind.adsense': 'AdSense',
  'money2.kind.affiliate': 'Affiliation'
} as const
