// The production nodes of lot P4 (PLAN-V2-PRODUCTION §7 P4: one simple video, rendered by ffmpeg), registered side by
// side with their versions (R2.1). `productionRegistry()` is the catalogue the app, the worker and the demo share.
import { NodeRegistry, type AnyNodeDef } from '../registry'
import { avatarSpeak } from './avatar-speak'
import { backgroundClips } from './background-clips'
import { beatsSplit } from './beats-split'
import { cardIntro } from './card-intro'
import { clipMake } from './clip-make'
import { captionsMake } from './captions-make'
import { directorPlan } from './director-plan'
import { directorPov } from './director-pov'
import { editChapters } from './edit-chapters'
import { editFx } from './edit-fx'
import { editSponsor } from './edit-sponsor'
import { ideaBriefNode, ideaSupport } from './idea'
import { motionRender } from './motion-render'
import { packageYoutube } from './package-youtube'
import { qcCheck } from './qc-check'
import { renderAssemble } from './render-assemble'
import { researchTopic } from './research-topic'
import { scriptFactcheck } from './script-factcheck'
import { scriptSponsor } from './script-sponsor'
import { scriptTranslate } from './script-translate'
import { scriptWrite } from './script-write'
import { scriptWrite2 } from './script-write2'
import { soundMusic } from './sound-music'
import { thumbnailMake } from './thumbnail-make'
import { visualsFulfil } from './visuals-fulfil'
import { voiceOwn } from './voice-own'
import { voiceTts } from './voice-tts'
import { wordsAlign } from './words-align'

export const P4_NODES: readonly AnyNodeDef[] = [
  researchTopic,
  scriptWrite,
  voiceTts,
  voiceOwn,
  beatsSplit,
  directorPlan,
  directorPov,
  visualsFulfil,
  captionsMake,
  soundMusic,
  renderAssemble,
  packageYoutube,
  // the faceless formats' own nodes: a gameplay background, an intro card, the free quality check, the translation
  backgroundClips,
  cardIntro,
  qcCheck,
  scriptTranslate,
  thumbnailMake,
  // a talking presenter for the hook and the outro (Hedra through the Cloud)
  avatarSpeak,
  // animated overlays from our templates (titles, figures, lower thirds, lists, quotes, a message conversation)
  motionRender,
  // production-4: the idea, its support videos, the presenter's script, its sponsor mentions, the fact check
  ideaBriefNode,
  ideaSupport,
  scriptWrite2,
  scriptSponsor,
  scriptFactcheck,
  // production-8: clips made from their still (two shots per generation in eco)
  clipMake,
  // production-9: the chapter marks and the sponsor's slot with its QR code
  editChapters,
  editSponsor,
  // record 0059: every word timed on the voice we ship (« Minutage des mots »)
  wordsAlign,
  // motion-montage (record 0073): the style's editing kit: transitions, camera, punch-ins, sound effects
  editFx
]

export function productionRegistry(): NodeRegistry {
  return new NodeRegistry(P4_NODES)
}

export {
  avatarSpeak,
  backgroundClips,
  beatsSplit,
  captionsMake,
  cardIntro,
  clipMake,
  directorPlan,
  directorPov,
  editChapters,
  editFx,
  editSponsor,
  ideaBriefNode,
  ideaSupport,
  motionRender,
  packageYoutube,
  qcCheck,
  renderAssemble,
  researchTopic,
  scriptFactcheck,
  scriptSponsor,
  scriptTranslate,
  scriptWrite,
  scriptWrite2,
  soundMusic,
  thumbnailMake,
  visualsFulfil,
  voiceOwn,
  voiceTts,
  wordsAlign
}
