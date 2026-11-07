// Every user-visible string of the Atelier UI, in French (one flat dictionary, so English can be added later as a
// second file with the same keys). Texts are Atelier's own. Use `t('key')` / `t('key', { n: 3 })` ({n} placeholders).

import { frChat } from './fr-chat'
import { frExample } from './fr-example'
import { frHome } from './fr-home'
import { frProduction } from './fr-production'
import { frRuns } from './fr-runs'
import { frAnalysis } from './fr-analysis'
import { frMoney } from './fr-money'
import { frTools } from './fr-tools'
import { frAgents } from './fr-agents'
import { frComputers } from './fr-computers'
import { frSettings } from './fr-settings'
import { frIdeas } from './fr-ideas'
import { frSettingsPrefs } from './fr-settings-prefs'
import { frCloud } from './fr-cloud'
import { frProto } from './fr-proto'
import { frDiscord } from './fr-discord'
import { frBrain } from './fr-brain'
import { frEyes } from './fr-eyes'
import { frUpdate } from './fr-update'
import { frAgentRuntime } from './fr-agent-runtime'
import { frBeta } from './fr-beta'
import { frGoogle } from './fr-google'
import { frAutopilot } from './fr-autopilot'
import { frLlmAccess } from './fr-llm-access'
import { frClaudeUsage } from './fr-claude-usage'
import { frClone } from './fr-clone'
import { en } from './en'

export const fr = {
  ...frChat,
  ...frExample,
  ...frHome,
  ...frProduction,
  ...frRuns,
  ...frAnalysis,
  ...frMoney,
  ...frTools,
  ...frAgents,
  ...frComputers,
  ...frSettings,
  ...frIdeas,
  ...frSettingsPrefs,
  ...frCloud,
  ...frProto,
  ...frDiscord,
  ...frBrain,
  ...frEyes,
  ...frUpdate,
  ...frAgentRuntime,
  ...frBeta,
  ...frGoogle,
  ...frAutopilot,
  ...frLlmAccess,
  ...frClaudeUsage,
  ...frClone,

  'app.name': 'Atelier',

  // Sections (rail)
  'section.accueil': 'Accueil',
  'section.planning': 'Planning',
  'section.conversations': 'Messages',
  'section.production': 'Production',
  'section.validations': 'Validations',
  'section.agents': 'Équipe',
  'section.cerveau': 'Cerveau',
  'section.chaines': 'Chaînes',
  'section.ordinateurs': 'Ordinateur',
  'section.monetisation': 'Monétisation',
  'section.outils': 'Mes outils',
  'section.reglages': 'Réglages',

  // Empty section pages (title in the serif, one line under it)
  'empty.accueil.title': 'Le tableau de bord se prépare',
  'empty.accueil.blurb': 'Production, équipe et argent tiendront ici, d’un seul coup d’œil.',
  'empty.conversations.title': 'Pas encore de conversation',
  'empty.conversations.blurb': 'Le Superviseur, les salons et les messages privés apparaîtront ici.',
  'empty.production.title': 'La salle de production est vide',
  'empty.production.blurb': 'Composer une vidéo, suivre les rendus et ranger la bibliothèque : tout se passera ici.',
  'empty.validations.title': 'Rien à valider',
  'empty.validations.blurb': 'Les scripts, voix, miniatures et rendus qui attendent ta décision arriveront ici.',
  'empty.agents.title': 'L’équipe n’est pas encore présentée',
  'empty.agents.blurb': 'Chaque agent aura sa fiche : état, modèle, mémoire, routines.',
  'empty.ordinateurs.title': 'Aucun écran ouvert',
  'empty.ordinateurs.blurb': 'Les navigateurs des agents et les machines distantes se pilotent d’ici.',
  'empty.monetisation.title': 'Pas encore de chiffres',
  'empty.monetisation.blurb': 'Revenus, sponsors, coûts et résultat par chaîne s’afficheront ici.',
  'empty.outils.title': 'Aucun outil branché',
  'empty.outils.blurb': 'Branche tes propres scripts, services et serveurs MCP, décrits par un manifeste.',
  'empty.reglages.title': 'Réglages',
  'empty.reglages.blurb': 'Cette page sera remplie dans un prochain lot.',
  'empty.page.title': 'Page en préparation',
  'empty.page.blurb': 'La navigation est en place ; le contenu arrive plus tard.',

  // Sub-pages (context column)
  'page.production.nouvelle': 'Nouvelle vidéo',
  'page.production.apercu': 'Lab',
  'page.production.encours': 'En cours',
  'page.production.chaines': 'Chaînes et styles',
  'page.production.analyser': 'Analyser une chaîne',
  'page.production.pipeline': 'Pipelines',
  'page.production.builder': 'Builder (bêta)',
  'page.production.editeur': 'Éditeur de pipeline',
  'page.production.agent': 'Pipeline par l’agent',
  'page.production.style': 'Créer une pipeline',
  'page.production.bibliotheque': 'Projets',
  'page.production.idees': 'Idées',
  'page.production.automatisations': 'Automatisations',
  'page.production.ressources': 'Technologies',
  'page.reglages.general': 'Général',
  'page.reglages.compte': 'Compte et crédits',
  'page.reglages.equipe': 'Équipe',
  'page.reglages.claude': 'Claude et modèles',
  'page.reglages.cloud': 'Atelier Cloud',
  'page.reglages.moteur': 'Moteur',
  'page.reglages.budgets': 'Budgets et exécution',
  'page.reglages.chaines': 'Chaînes',
  'page.reglages.notifications': 'Notifications et sons',
  'page.reglages.audio': 'Audio',
  'page.reglages.apparence': 'Apparence',
  'page.reglages.fonctions': 'Fonctions (réel / démo)',
  'page.reglages.donnees': 'Données',
  'page.reglages.admin': 'Admin plateforme',
  'page.reglages.apropos': 'À propos',
  'page.reglages.galerie': 'Galerie (dev)',

  // Chrome
  'shell.rail': 'Navigation principale',
  'shell.context': 'Pages de la section',
  'shell.logo': 'Atelier, accueil',
  'shell.profile': 'Profil',
  'shell.palette': 'Rechercher et agir',
  'shell.paletteKey': '⌘K',
  'shell.collapse': 'Replier la colonne',
  'shell.expand': 'Déplier la colonne',
  'engine.ok': 'Moteur prêt',
  'engine.warn': 'Moteur occupé ou incomplet',
  'engine.err': 'Moteur en erreur',
  'engine.off': 'Moteur arrêté',
  'theme.toDark': 'Passer au thème sombre',
  'theme.toLight': 'Passer au thème clair',
  'theme.dark': 'Sombre',
  'theme.light': 'Clair',

  // Command palette
  'palette.title': 'Palette de commandes',
  'palette.placeholder': 'Aller à une section, lancer une action…',
  'palette.empty': 'Rien ne correspond.',
  'palette.group.navigation': 'Navigation',
  'palette.group.pages': 'Pages',
  'palette.group.actions': 'Actions',
  'palette.action.theme': 'Basculer clair / sombre',
  'palette.action.gallery': 'Ouvrir la galerie des composants',

  // Confirmation and toasts
  'confirm.cancel': 'Annuler',
  'confirm.confirm': 'Confirmer',
  'toast.close': 'Fermer la notification',
  'demo.nothingDone': 'Démo : rien n’a été fait.',

  // Demo
  'demo.badge': 'DÉMO',
  'demo.boundary': 'À quoi ça ressemblerait. Rien n’est envoyé.',
  'demo.unlock': 'Pour l’activer : {how}',
  'feature.real': 'Réel',
  'feature.demo': 'Démo',
  'feature.needsCredits': 'Crédits insuffisants',

  // Gallery
  'gallery.title': 'Galerie des composants',
  'gallery.blurb': 'Tout le système de design sur une page : jetons, composants maison, shadcn et ElevenLabs UI.',
  'gallery.tokens': 'Jetons',
  'gallery.buttons': 'Boutons',
  'gallery.atelier': 'Composants Atelier',
  'gallery.feedback': 'Retours : toasts et confirmation',
  'gallery.elevenlabs': 'ElevenLabs UI',
  'gallery.toastOk': 'Afficher un toast',
  'gallery.toastDemo': 'Toast de démo',
  'gallery.confirm': 'Ouvrir la confirmation',
  'gallery.confirmTitle': 'Supprimer cette vidéo ?',
  'gallery.confirmBody': 'Le dossier de travail reste sur le disque, mais la vidéo disparaît de la liste.',
  'gallery.confirmAction': 'Supprimer',
  'gallery.confirmed': 'Confirmé',
  'gallery.cancelled': 'Annulé',
  'gallery.orb': 'Orb',
  'gallery.shimmer': 'Shimmering Text',
  'gallery.shimmerText': 'Lit la file du moteur…',
  'gallery.audio': 'Audio Player',
  'gallery.waveform': 'Waveform',

  // Atelier components
  'state.working': 'Travaille',
  'state.waiting': 'Attend',
  'state.blocked': 'Bloqué',
  'state.idle': 'Au repos',
  'state.done': 'Terminé',
  'state.error': 'Erreur',
  'empty.generic': 'Rien à afficher pour l’instant.',
  'loading': 'Chargement…',

  // Vendored audio components (aria labels)
  'audio.play': 'Lire',
  'audio.pause': 'Pause',
  'audio.speed': 'Vitesse de lecture',
  'audio.speedControls': 'Choix de la vitesse de lecture',
  'audio.scrubber': 'Forme d’onde, cliquer pour se déplacer',
  'audio.scrubRecording': 'Faire glisser pour parcourir l’enregistrement',

  // Until Atelier's production engine exists (lots P2 to P7): the video producer's edit waits for the owner
  'production.pending':
    'le moteur de production n’est pas encore disponible, le montage n’est donc pas fait automatiquement. Dépose-le toi-même sur la page de la vidéo, ou attends la nouvelle Production.',

  // The local-folder rule (platform/paths.ts): a folder Atelier executes from or writes work files to
  'folder.absolute': 'Le dossier doit être un chemin absolu',
  'folder.missing': 'Le dossier n’existe pas : {dir}',
  'folder.network': 'Le dossier doit être sur un disque local (comme C:\\dev\\atelier-work), pas sur un chemin réseau',
  'folder.leadsToNetwork': 'Le dossier mène à un chemin réseau ({real}) : choisis un dossier local',
  'folder.notHome': 'Le dossier doit être dans ton dossier personnel (comme ~/dev/atelier-work), pas {real}',

  // Spend: history of the renders made by the old engine
  'oldRenders.title': 'Anciens rendus',
  'oldRenders.empty': 'Aucun ancien rendu.',
  'oldRenders.date': 'Date',
  'oldRenders.video': 'Vidéo',
  'oldRenders.state': 'État',
  'oldRenders.cost': 'Coût',
  'oldRenders.untitled': 'Rendu sans titre',
  'oldRenders.state.queued': 'En attente',
  'oldRenders.state.running': 'En cours',
  'oldRenders.state.downloading': 'Téléchargement',
  'oldRenders.state.done': 'Terminé',
  'oldRenders.state.error': 'Échec',
  'oldRenders.state.cancelled': 'Annulé',
  'oldRenders.state.unknown': 'Inconnu',

  // Errors
  'error.title': 'Quelque chose s’est mal passé',
  'error.retry': 'Réessayer',
  'error.crash.body': 'L’écran a rencontré un problème. Tes données sont gardées : recharge l’écran pour continuer.',
  'error.crash.reload': 'Recharger l’écran'
} as const

export type MessageKey = keyof typeof fr

export type Locale = 'fr' | 'en'
export const LOCALE_KEY = 'atelier.locale'

function readLocale(): Locale {
  try {
    return globalThis.localStorage?.getItem(LOCALE_KEY) === 'en' ? 'en' : 'fr'
  } catch {
    return 'fr'
  }
}

let locale: Locale = readLocale()

/** The UI language. English falls back to French for keys not translated yet. */
export function getLocale(): Locale {
  return locale
}

/** Switches the UI language (the app re-renders from the root; see lib/locale.tsx). */
export function setLocale(next: Locale): void {
  locale = next
  try {
    globalThis.localStorage?.setItem(LOCALE_KEY, next)
  } catch {
    /* private mode: not remembered */
  }
}

/** Looks a message up; `{name}` placeholders are replaced from `vars`. */
export function t(key: MessageKey, vars?: Record<string, string | number>): string {
  const raw: string = (locale === 'en' ? en[key] : undefined) ?? fr[key]
  if (!vars) return raw
  return raw.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m))
}
