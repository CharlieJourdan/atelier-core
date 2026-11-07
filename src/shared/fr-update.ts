// French strings of the app's self-update (src/main/updater, Réglages › À propos › Mises à jour). Keys `update.*`.
export const frUpdate = {
  // errors (main process)
  'update.err.notReady': 'Aucune mise à jour téléchargée à installer pour l’instant.',
  'update.err.busy': 'Une recherche ou un téléchargement est en cours : attends qu’il se termine avant de changer de canal.',
  'update.err.channel': 'Canal inconnu : choisis « bêta » ou « stable ».',
  'update.err.check': 'La recherche de mise à jour a échoué : {reason}',

  // Réglages › À propos › Mises à jour
  'update.title': 'Mises à jour',
  'update.current': 'Version installée',
  'update.channel': 'Canal',
  'update.channel.hint': 'Bêta : les nouvelles versions arrivent en premier, pour les testeurs. Stable : seulement les versions éprouvées.',
  'update.channel.beta': 'Bêta',
  'update.channel.stable': 'Stable',
  'update.check': 'Rechercher des mises à jour',
  'update.checking': 'Recherche en cours…',
  'update.upToDate': 'Atelier est à jour.',
  'update.lastCheck': 'Dernière vérification : {when}',
  'update.never': 'Pas encore vérifié depuis le démarrage.',
  'update.downloading': 'Téléchargement de la version {version} : {percent} %',
  'update.ready': 'La version {version} est prête à être installée.',
  'update.install': 'Redémarrer pour installer',
  'update.installLater': 'Sinon, elle s’installera toute seule quand tu fermeras Atelier.',
  'update.notes': 'Nouveautés de la version {version}',
  'update.error': 'La dernière vérification a échoué : {reason}',
  'update.schedule': 'Atelier cherche une mise à jour au démarrage, puis toutes les 4 heures, et la télécharge en arrière-plan.',
  'update.unsupported.dev': 'Cette version de développement ne se met pas à jour toute seule : seule l’application installée le fait.',
  'update.unsupported.platform': 'Ce système ne permet pas la mise à jour automatique : télécharge la nouvelle version à la main.',
  'update.unsupported.headless': 'Ce programme (le cerveau de l’ordinateur d’équipe) ne se met pas à jour depuis cet écran.',
  'update.help.win': 'Sous Windows, l’installeur n’est pas signé : Windows peut afficher un avertissement SmartScreen (« Informations complémentaires », puis « Exécuter quand même »). La mise à jour se vérifie par une empreinte, elle fonctionne sans signature.',
  'update.help.mac': 'Sur Mac, la mise à jour automatique demande une app signée par un compte développeur Apple. Sans signature, télécharge la nouvelle version à la main.',
  'update.feed': 'Flux de mises à jour'
} as const
