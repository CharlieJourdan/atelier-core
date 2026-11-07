// French messages of lot Z1: Analyser une chaîne, the gauge, Chaînes et styles, Pipelines, Builder. Merged into `fr` (see fr.ts). Keys are prefixed by area.
// The Pipelines and Builder screens keep their keys in fr-analysis-pipelines.ts, the Analyser and Chaînes screens in
// fr-analysis-screens.ts; this file holds the shared vocabulary (components, modes, tiers, validation codes…).
import { frAnalysisPipelines } from './fr-analysis-pipelines'
import { frAnalysisScreens } from './fr-analysis-screens'

export const frAnalysis = {
  ...frAnalysisPipelines,
  ...frAnalysisScreens,

  // visual components of the gauge
  'analysis.comp.stock': 'Banque d’images',
  'analysis.comp.text_anim': 'Animation de texte',
  'analysis.comp.ai_image': 'Image IA',
  'analysis.comp.ai_video': 'Vidéo IA',
  'analysis.comp.avatar': 'Avatar',
  'analysis.comp.face_camera': 'Face caméra',
  'analysis.comp.gameplay': 'Gameplay',
  'analysis.comp.cartoon': 'Dessin animé',
  'analysis.comp.three_d': '3D',
  'analysis.comp.infographic': 'Infographie',
  'analysis.comp.map': 'Carte',
  'analysis.comp.clip': 'Extrait d’une autre source',

  // budget modes
  'analysis.mode.qualite_max': 'Qualité max',
  'analysis.mode.usage_max': 'Usage max',

  // tiers
  'analysis.tier.reproductible': 'Reproductible',
  'analysis.tier.adaptations': 'Reproductible avec adaptations',
  'analysis.tier.partiel': 'Partiel',
  'analysis.tier.special': 'Format spécial',
  'analysis.conf.high': 'Confiance haute',
  'analysis.conf.medium': 'Confiance moyenne',
  'analysis.conf.low': 'Confiance basse',

  // inputs (questions)
  'analysis.input.camera': 'ta caméra',
  'analysis.input.gameplay': 'ton gameplay',
  'analysis.input.camera.question': 'As-tu des images face caméra ?',
  'analysis.input.gameplay.question': 'As-tu des images de gameplay ?',
  'analysis.input.camera.help': 'Tes prises face caméra, en 1080p, son propre, une prise par partie.',
  'analysis.input.gameplay.help': '10 à 30 min de gameplay sans voix, en 1080p.',

  // pipeline origins
  'analysis.origin.template': 'Modèle',
  'analysis.origin.own': 'À toi',
  'analysis.origin.team': 'Équipe',
  'analysis.origin.builder': 'Builder',
  'analysis.origin.analysis': 'Analyse',
  'analysis.origin.import': 'Importé',

  // validation problems (code → sentence), shown with their path
  'analysis.val.json': 'Ce n’est pas du JSON lisible.',
  'analysis.val.empty': 'Le document est vide.',
  'analysis.val.too_large': 'Le document est trop gros (200 000 caractères au plus).',
  'analysis.val.schema': 'Champ manquant ou de la mauvaise forme.',
  'analysis.val.duplicate_id': 'Identifiant déclaré deux fois.',
  'analysis.val.unknown_node_type': 'Type de nœud absent du catalogue.',
  'analysis.val.bad_params': 'Réglage refusé par le nœud.',
  'analysis.val.unknown_ref': 'Référence vers un nœud, une sortie ou une entrée qui n’existe pas.',
  'analysis.val.unknown_port': 'Ce nœud n’a pas cette entrée.',
  'analysis.val.missing_input': 'Entrée obligatoire non branchée.',
  'analysis.val.type_mismatch': 'Les types ne se branchent pas : la sortie ne convient pas à cette entrée.',
  'analysis.val.cycle': 'Le graphe boucle sur lui-même.',
  'analysis.val.bad_where': 'Ce nœud ne peut pas tourner à cet endroit.',
  'analysis.val.unknown': 'Problème de validation.',
  'analysis.val.root': 'document',
  'analysis.val.title': '{n} problème(s) : rien n’est enregistré',

  // diff
  'analysis.diff.same': 'Aucune différence.',
  'analysis.diff.stats': '+{added} · −{removed}',
  'analysis.diff.label': 'Différences',

  // cost per mode
  'analysis.cost.title': 'Coût par mode',
  'analysis.cost.perMinute': '{n} crédits / min',
  'analysis.cost.video': 'Vidéo de {m} min : {n} crédits',
  'analysis.cost.free': 'Gratuit (ton ordinateur ou ton Claude Code)',
  'analysis.cost.note': 'Estimation sur la grille de prix indicative d’Atelier Cloud ; les nœuds locaux et Claude Code coûtent 0 crédit.',

  'analysis.common.example': 'Exemple',
  'analysis.common.cancel': 'Annuler',
  'analysis.common.close': 'Fermer',
  'analysis.common.save': 'Enregistrer',
  'analysis.common.saving': 'Enregistrement…',
  'analysis.common.version': 'v{n}',
  'analysis.common.loadingError': 'Chargement impossible : {e}'
} as const
