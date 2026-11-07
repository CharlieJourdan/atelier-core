// Demo videos across the four channels: in production, waiting for the user, scheduled and published. Dates are
// offsets from today so the planning always looks alive.
import type { ProtoVideo } from './types'

type V = Omit<ProtoVideo, 'thumbHue'> & { thumbHue?: number }

const RAW: V[] = [
  // Les Grandes Énigmes (documentary, long)
  { id: 'v-templiers', channelId: 'ch-enigmes', title: 'Le trésor des Templiers a-t-il vraiment existé ?', brief: 'Ce que disent les archives du procès de 1307, les pistes sérieuses et les mythes.', format: 'long', pipelineId: 'pl-docu', stage: 'edit', progress: 72, status: 'running', dueInDays: 1, publishInDays: 2, publishTime: '18:00', durationSec: 812, creditsSpent: 360, creditsEstimate: 445, agentId: 'ag-enigmes-edit', thumbHue: 32 },
  { id: 'v-dyatlov', channelId: 'ch-enigmes', title: 'Col Dyatlov : la nuit où tout a basculé', brief: 'Reconstitution heure par heure, les trois hypothèses qui tiennent encore.', format: 'long', pipelineId: 'pl-docu', stage: 'script', progress: 24, status: 'waiting', waitingFor: { kind: 'validate', label: 'Script à valider' }, dueInDays: 4, publishInDays: 5, publishTime: '18:00', durationSec: 0, creditsSpent: 0, creditsEstimate: 445, agentId: 'ag-enigmes-script', thumbHue: 210 },
  { id: 'v-voynich', channelId: 'ch-enigmes', title: 'Le manuscrit de Voynich enfin déchiffré ?', brief: 'Les dernières annonces passées au crible.', format: 'long', pipelineId: 'pl-docu', stage: 'director', progress: 38, status: 'running', dueInDays: 6, publishInDays: 7, publishTime: '18:00', durationSec: 0, creditsSpent: 20, creditsEstimate: 445, agentId: 'ag-enigmes-director', thumbHue: 48 },
  { id: 'v-atlantide', channelId: 'ch-enigmes', title: 'Atlantide : ce que Platon a vraiment écrit', brief: 'Retour au texte du Critias.', format: 'long', pipelineId: 'pl-docu', stage: 'packaging', progress: 91, status: 'waiting', waitingFor: { kind: 'validate', label: 'Miniature à choisir' }, dueInDays: 0, publishInDays: 0, publishTime: '18:00', durationSec: 734, creditsSpent: 430, creditsEstimate: 445, agentId: 'ag-enigmes-pack', thumbHue: 195 },
  { id: 'v-roswell', channelId: 'ch-enigmes', title: 'Roswell, 1947 : le dossier complet', brief: '', format: 'long', pipelineId: 'pl-docu', stage: 'published', progress: 100, status: 'done', dueInDays: -3, publishInDays: -2, publishTime: '18:00', durationSec: 902, creditsSpent: 452, creditsEstimate: 445, agentId: 'ag-enigmes-lead', thumbHue: 120 },
  { id: 'v-mary', channelId: 'ch-enigmes', title: 'La Mary Celeste, navire fantôme', brief: '', format: 'long', pipelineId: 'pl-docu', stage: 'idea', progress: 6, status: 'queued', dueInDays: 9, publishInDays: 10, publishTime: '18:00', durationSec: 0, creditsSpent: 0, creditsEstimate: 445, agentId: 'ag-enigmes-research', thumbHue: 220 },

  // Histoires Vraies (reddit shorts): three a day, they stack in the planning
  { id: 's-coloc', channelId: 'ch-histoires', title: 'Mon coloc a vendu mon chat pendant mes vacances', brief: '', format: 'short', pipelineId: 'pl-reddit', stage: 'edit', progress: 64, status: 'running', dueInDays: 0, publishInDays: 0, publishTime: '12:00', durationSec: 58, creditsSpent: 12, creditsEstimate: 14, agentId: 'ag-histoires-edit', thumbHue: 12 },
  { id: 's-mariage', channelId: 'ch-histoires', title: 'Elle a annulé le mariage la veille, par SMS', brief: '', format: 'short', pipelineId: 'pl-reddit', stage: 'scheduled', progress: 100, status: 'done', dueInDays: 0, publishInDays: 0, publishTime: '17:00', durationSec: 61, creditsSpent: 14, creditsEstimate: 14, agentId: 'ag-histoires-lead', thumbHue: 340 },
  { id: 's-heritage', channelId: 'ch-histoires', title: 'Mon frère a caché le testament de papy', brief: '', format: 'short', pipelineId: 'pl-reddit', stage: 'voice', progress: 40, status: 'blocked', waitingFor: { kind: 'input', label: 'Clips de gameplay à déposer' }, dueInDays: 0, publishInDays: 0, publishTime: '20:00', durationSec: 0, creditsSpent: 6, creditsEstimate: 14, agentId: 'ag-histoires-edit', thumbHue: 28 },
  { id: 's-voisin', channelId: 'ch-histoires', title: 'Le voisin qui volait notre wifi depuis 3 ans', brief: '', format: 'short', pipelineId: 'pl-reddit', stage: 'script', progress: 18, status: 'running', dueInDays: 1, publishInDays: 1, publishTime: '12:00', durationSec: 0, creditsSpent: 0, creditsEstimate: 14, agentId: 'ag-histoires-script', thumbHue: 160 },
  { id: 's-patron', channelId: 'ch-histoires', title: 'Mon patron m’a viré, puis supplié de revenir', brief: '', format: 'short', pipelineId: 'pl-reddit', stage: 'idea', progress: 5, status: 'queued', dueInDays: 1, publishInDays: 1, publishTime: '17:00', durationSec: 0, creditsSpent: 0, creditsEstimate: 14, agentId: 'ag-histoires-research', thumbHue: 260 },
  { id: 's-belle-mere', channelId: 'ch-histoires', title: 'Ma belle-mère a lu mon journal au repas de Noël', brief: '', format: 'short', pipelineId: 'pl-reddit', stage: 'idea', progress: 5, status: 'queued', dueInDays: 1, publishInDays: 1, publishTime: '20:00', durationSec: 0, creditsSpent: 0, creditsEstimate: 14, agentId: 'ag-histoires-research', thumbHue: 300 },
  { id: 's-jumeau', channelId: 'ch-histoires', title: 'J’ai découvert que j’avais un jumeau à 30 ans', brief: '', format: 'short', pipelineId: 'pl-reddit', stage: 'published', progress: 100, status: 'done', dueInDays: -1, publishInDays: -1, publishTime: '12:00', durationSec: 57, creditsSpent: 13, creditsEstimate: 14, agentId: 'ag-histoires-lead', thumbHue: 190 },
  { id: 's-loyer', channelId: 'ch-histoires', title: 'Le proprio voulait doubler le loyer', brief: '', format: 'short', pipelineId: 'pl-reddit', stage: 'published', progress: 100, status: 'done', dueInDays: -1, publishInDays: -1, publishTime: '17:00', durationSec: 59, creditsSpent: 14, creditsEstimate: 14, agentId: 'ag-histoires-lead', thumbHue: 90 },

  // Top Savoirs (top 10, script written by hand)
  { id: 'v-animaux', channelId: 'ch-top', title: 'Les 10 animaux les plus rapides du monde', brief: 'Du guépard au faucon pèlerin.', format: 'long', pipelineId: 'pl-top10', stage: 'script', progress: 12, status: 'blocked', waitingFor: { kind: 'input', label: 'Ton script à importer' }, dueInDays: 3, publishInDays: 4, publishTime: '16:00', durationSec: 0, creditsSpent: 0, creditsEstimate: 260, agentId: 'ag-top-lead', thumbHue: 40 },
  { id: 'v-villes', channelId: 'ch-top', title: '10 villes qui vont disparaître d’ici 2100', brief: '', format: 'long', pipelineId: 'pl-top10', stage: 'assets', progress: 52, status: 'running', dueInDays: 2, publishInDays: 3, publishTime: '16:00', durationSec: 0, creditsSpent: 110, creditsEstimate: 260, agentId: 'ag-top-director', thumbHue: 200 },

  // Mystery Files (translated channel)
  { id: 'v-en-roswell', channelId: 'ch-mystery', title: 'Roswell 1947: The Complete File', brief: 'Translated from « Roswell, 1947 : le dossier complet ».', format: 'long', pipelineId: 'pl-docu-en', stage: 'voice', progress: 55, status: 'running', dueInDays: 2, publishInDays: 3, publishTime: '15:00', durationSec: 0, creditsSpent: 140, creditsEstimate: 180, agentId: 'ag-mystery-lead', thumbHue: 120 },
  { id: 'v-en-atlantis', channelId: 'ch-mystery', title: 'Atlantis: What Plato Really Wrote', brief: '', format: 'long', pipelineId: 'pl-docu-en', stage: 'scheduled', progress: 100, status: 'done', dueInDays: 1, publishInDays: 1, publishTime: '15:00', durationSec: 741, creditsSpent: 176, creditsEstimate: 180, agentId: 'ag-mystery-lead', thumbHue: 195 },

  // A test video with no channel (made by hand from a preset)
  { id: 'v-test-avatar', channelId: null, title: 'Test : présentateur IA sur la crise de 1929', brief: 'Essai du preset avatar avant de lancer une chaîne finance.', format: 'long', pipelineId: 'pl-avatar', stage: 'assets', progress: 44, status: 'running', dueInDays: 5, publishInDays: null, publishTime: '18:00', durationSec: 0, creditsSpent: 190, creditsEstimate: 620, agentId: 'ag-principal', thumbHue: 280 }
]

export const VIDEOS: ProtoVideo[] = RAW.map((v, i) => ({ ...v, thumbHue: v.thumbHue ?? (i * 47) % 360 }))

export function videoById(id: string): ProtoVideo | undefined {
  return VIDEOS.find((v) => v.id === id)
}
