// The brick-bound settings of P5 (decision 0099): `<node>.<setting>` ← Style Definition fields, the compiler writes each into that
// brick of the recipe; `recipe.<field>` ← fields, the recipe document itself. Part of plan-rules.ts SETTING_MAP (so settingProblems
// checks each cites its fields and carries the definition's value). A null value: nothing measured there, the brick's own default.
import type { SettingRule } from '../plan-rules'
import { drawnShareOf, editKitFrom } from './values'
import { figuresFrom, heldFrom, openingFrom, scriptObjectsFrom } from './values-pov'
import { paceRowsFrom } from './values-mix'
import {
  bedDbFrom,
  cardStyleFrom,
  cpmFrom,
  ctaModeFrom,
  cutLeadFrom,
  framingFrom,
  gradeFrom,
  generatedLookFrom,
  handShareFrom,
  povDepthFrom,
  povTypeFrom,
  languageFrom,
  layoutsFrom,
  maxPauseFrom,
  mixFrom,
  motionShareFrom,
  povPaletteFrom,
  presenterLayoutsFrom,
  presenterRefFrom,
  referenceMinutesFrom,
  voiceFrom
} from './values'

const clamp = (n: number, lo: number, hi: number): number => Math.round(Math.min(hi, Math.max(lo, n)) * 100) / 100
const said = (f: { source: string }): boolean => f.source !== 'default'
const orNull = <T>(x: T | undefined): T | null => (x === undefined ? null : x)

const MIX_FIELDS = ['sourcing.originShares', 'presenter.talkSecondsPerMinute', 'editing.cameraMoves', 'sourcing.illustrationStyle', 'presenter.presenceByPart', 'script.hookWindowS', 'script.parts', 'sourcing.distributions']

export const BRICK_SETTINGS: readonly SettingRule[] = [
  // the recipe document
  { key: 'recipe.language', fields: ['voice.language'], from: (d) => languageFrom(d) },
  { key: 'recipe.aspect', fields: ['editing.aspect'], from: (d) => (said(d.editing.aspect) ? d.editing.aspect.value : null) },
  { key: 'recipe.minutes', fields: ['script.hookWindowS', 'script.parts'], from: (d) => referenceMinutesFrom(d) },
  // the mix and its curve: from every element's measured distribution along the video when measured (values-mix.ts)
  { key: 'recipe.mix', fields: MIX_FIELDS, from: (d) => mixFrom(d) },
  // the script
  { key: 'script.write.wpm', fields: ['script.wordsPerMinute'], from: (d) => Math.round(clamp(d.script.wordsPerMinute.value, 60, 300)) },
  { key: 'script.write.hookSeconds', fields: ['script.hookWindowS'], from: (d) => clamp(d.script.hookWindowS.value, 0, 120) },
  { key: 'script.write.hookPattern', fields: ['script.hookPattern'], from: (d) => (d.script.hookPattern.value.trim() ? d.script.hookPattern.value.trim().slice(0, 80) : null) },
  // moteur-pov-2: the things the stories handle in the viewer's hands (the demo script follows them too)
  { key: 'script.write.objects', fields: ['sourcing.heldObjects', 'sourcing.povOpeningShare', 'sourcing.povShare', 'script.wordsPerMinute'], from: (d) => orNull(scriptObjectsFrom(d)) },
  { key: 'script.write.address', fields: ['script.addressMode'], from: (d) => (said(d.script.addressMode) ? d.script.addressMode.value : null) },
  { key: 'script.write.ctaMode', fields: ['script.cta'], from: (d) => ctaModeFrom(d) },
  {
    key: 'script.write.persona',
    fields: ['script.tone', 'script.addressMode'],
    from: (d) => (said(d.script.tone) && d.script.tone.value.trim() ? `${d.script.tone.value.trim()}; address: ${d.script.addressMode.value}`.slice(0, 300) : null)
  },
  // the voice
  { key: 'voice.tts.wpm', fields: ['voice.wordsPerMinute'], from: (d) => clamp(d.voice.wordsPerMinute.value, 80, 450) },
  { key: 'voice.tts.maxPauseS', fields: ['voice.meanPauseS'], from: (d) => maxPauseFrom(d) },
  { key: 'voice.tts.voice', fields: ['voice.voiceRef'], from: (d) => orNull(voiceFrom(d)) },
  // the director of filmed / found / generated pictures with a presenter (director.plan)
  { key: 'director.plan.cpm', fields: ['editing.meanShotS'], from: (d) => cpmFrom(d) },
  // the cadence part by part (the hook's shots shorter, the end's longer), as measured: a factor on every shot length from each part on
  { key: 'director.plan.paceRows', fields: ['editing.shotByPart', 'editing.meanShotS', 'script.parts', 'script.hookWindowS'], from: (d) => orNull(paceRowsFrom(d, referenceMinutesFrom(d))) },
  { key: 'director.plan.cutLeadS', fields: ['editing.illustrationLeadS'], from: (d) => cutLeadFrom(d) },
  { key: 'director.plan.layouts', fields: ['presenter.configurations'], from: (d) => orNull(layoutsFrom(d)) },
  { key: 'director.plan.presenterLayouts', fields: ['presenter.layoutCurve', 'script.hookWindowS', 'script.parts'], from: (d) => orNull(presenterLayoutsFrom(d)) },
  { key: 'director.plan.presenterRunMaxS', fields: ['presenter.windowMeanS'], from: (d) => (d.presenter.windowMeanS.value > 0 ? clamp(d.presenter.windowMeanS.value * 2, 3, 120) : null) },
  { key: 'director.plan.cards', fields: ['motion.elements'], from: (d) => d.motion.elements.value.length > 0 },
  { key: 'director.plan.locale', fields: ['voice.language'], from: (d) => languageFrom(d) },
  // the director of drawn 2D scenes (director.pov)
  { key: 'director.pov.shotS', fields: ['editing.meanShotS'], from: (d) => clamp(d.editing.meanShotS.value, 1, 10) },
  { key: 'director.pov.hookShotS', fields: ['editing.hookMeanShotS'], from: (d) => clamp(d.editing.hookMeanShotS.value, 1, 10) },
  { key: 'director.pov.maxStillS', fields: ['editing.holdMaxS'], from: (d) => clamp(d.editing.holdMaxS.value, 3, 20) },
  { key: 'director.pov.palette', fields: ['motion.palette'], from: (d) => orNull(povPaletteFrom(d)) },
  // moteur-briques: depth of field, first-person hand shots and the cards' type, measured
  { key: 'director.pov.depth', fields: ['sourcing.depthShare'], from: (d) => orNull(povDepthFrom(d)) },
  { key: 'director.pov.handShare', fields: ['sourcing.povShare'], from: (d) => orNull(handShareFrom(d)) },
  { key: 'director.pov.type', fields: ['motion.fonts', 'motion.palette'], from: (d) => orNull(povTypeFrom(d)) },
  // moteur-pov-2: the things held up and what is on them, the opening's first-person share, the cast's drawing
  { key: 'director.pov.held', fields: ['sourcing.heldObjects'], from: (d) => orNull(heldFrom(d)) },
  { key: 'director.pov.opening', fields: ['sourcing.povOpeningShare', 'sourcing.povShare'], from: (d) => orNull(openingFrom(d)) },
  { key: 'director.pov.figures', fields: ['sourcing.figures'], from: (d) => orNull(figuresFrom(d)) },
  // motion design in the channel's measured style (the styled card family, decision 0099)
  { key: 'motion.render.style', fields: ['motion.elements', 'motion.palette', 'motion.fonts', 'sourcing.originShares'], from: (d) => orNull(cardStyleFrom(d)) },
  { key: 'motion.render.share', fields: ['sourcing.originShares'], from: (d) => motionShareFrom(d) },
  // a drawn channel's cards are drawn scenes placed by director.pov itself: no overlay pass over them
  { key: 'motion.render.overlays', fields: ['motion.elements', 'sourcing.originShares'], from: (d) => d.motion.elements.value.length > 0 && drawnShareOf(d) < 0.5 },
  // the presenter: his measured angles switched, his placeholder's pictures
  { key: 'avatar.speak.framing', fields: ['presenter.angleCount'], from: (d) => framingFrom(d) },
  { key: 'avatar.speak.presenter', fields: ['presenter.presenterRef', 'presenter.placeholder'], from: (d) => orNull(presenterRefFrom(d)) },
  // the drawn channel's transitions (blur smear, dip), only when measured
  { key: 'edit.fx.kit', fields: ['editing.transitions', 'sourcing.originShares'], from: (d) => orNull(editKitFrom(d)) },
  // captions, sound, grade
  { key: 'captions.make.burn', fields: ['captions.burnIn'], from: (d) => d.captions.burnIn.value },
  { key: 'sound.music.mood', fields: ['sound.musicGenre'], from: (d) => (d.sound.musicGenre.value.trim() ? d.sound.musicGenre.value.trim().slice(0, 40) : null) },
  { key: 'sound.music.bedDb', fields: ['sound.musicLevelUnderVoiceDb'], from: (d) => bedDbFrom(d) },
  // the pace and the illustration part by part: stated in the pipeline with their evidence (no brick takes them per part yet; the
  // voice speaks at voice.tts.wpm, the director illustrates every sentence it can)
  { key: 'voice.wpmByPart', fields: ['voice.wpmByPart'], from: (d) => (d.voice.wpmByPart.value.length ? d.voice.wpmByPart.value : null) },
  { key: 'script.illustratesByPart', fields: ['script.illustratesByPart'], from: (d) => (d.script.illustratesByPart.value.length ? d.script.illustratesByPart.value : null) },
  { key: 'render.assemble.grade', fields: ['editing.colour', 'sourcing.grade'], from: (d) => orNull(gradeFrom(d)) },
  // the generated pictures in the reference's own look (moteur-briques), only where the reference generates
  { key: 'visuals.fulfil.look', fields: ['sourcing.generatedLook', 'sourcing.originShares'], from: (d) => orNull(generatedLookFrom(d)) },
  // the letterbox the reference keeps (moteur-briques): its picture aspect between the bars
  // moteur-pov-2: the reference's format is a blocking check on the delivered film (re-framed, else refused)
  { key: 'render.assemble.aspect', fields: ['editing.aspect'], from: (d) => (said(d.editing.aspect) ? d.editing.aspect.value : null) },
  { key: 'render.assemble.letterbox', fields: ['editing.letterbox'], from: (d) => d.editing.letterbox.value?.aspect ?? null }
]

/**
 * Definition fields no brick setting reads, with WHO reads them instead (spec §2: every non-default field must end up used). The
 * coverage test (tests/unit/clone-pipeline.test.ts) refuses a measured field that is in neither SETTING_MAP nor this list.
 */
export const PLANNER_ONLY: Readonly<Record<string, string>> = {
  'script.partCount': 'P6 script idea (compare/runner.ts passageIdea: the reference outline)',
  'script.frame': 'P6 script idea (passageIdea)',
  'script.hookLevers': 'P6 script idea; P7 blind judge axis « script »',
  'script.promise': 'P6 script idea (passageIdea)',
  'script.promiseRepeatAt': 'P7 review: promise repeated at the measured points',
  'script.payoff': 'P6 script idea (passageIdea)',
  'script.maxNoConcreteS': 'P7 review: dead stretches',
  'script.sentenceWordsMean': 'P7 curves: pace',
  'script.devices': 'P6 script idea (passageIdea)',
  'script.bannedOpenings': 'P6 script idea (passageIdea)',
  'script.numbersAsWords': 'P7 review: on-screen figures',
  'script.outline': 'P6 script idea (the reference outline)',
  'script.illustratedShare': 'P7 review: illustration on its words',
  'voice.mode': 'P4 voice choice (people.ts), resolved into voice.voiceRef',
  'voice.kind': 'P4 voice choice (people.ts)',
  'voice.timbre': 'P4 voice choice (voices.sameKind descriptors)',
  'voice.descriptors': 'P4 voice choice (voices.sameKind)',
  'voice.pausesPerMinute': 'P7 curves: pace (voice holes)',
  'voice.energy': 'P4 voice choice; P7 blind judge axis « voice »',
  'presenter.kind': 'P5 brick choice (avatar.speak or none)',
  'presenter.mode': 'P5 slots (placeholder / own clone)',
  'presenter.identity': 'P4 look-alike placeholder spec (lookalike.ts)',
  'presenter.entries': 'P7 review: how the presenter enters',
  'presenter.exits': 'P7 review: how the presenter leaves',
  'presenter.noSameConfigTwice': 'engine: avatar.speak multi framing cycles the angles (presenter/batch.ts framingsOf), never the same twice',
  'motion.densityByPart': 'P7 curves: motion density per part',
  'motion.explainWhenNoMedia': 'director (motion cards when no picture fits)',
  'motion.neverSameTypeTwice': 'motion.render coverage (noRepeatInRow, the brick default true)',
  'motion.coverageByPart': 'P7 curves: motion coverage per part',
  'editing.medianShotS': 'P7 curves: shot lengths',
  'editing.p90ShotS': 'P7 curves: shot lengths',
  'editing.shotCurve': 'P7 curves: shot-length curve over time',
  'editing.cutTypes': 'P7 curves; edit.fx kit when the reference has transitions',
  'editing.transitions': 'P5 brick choice (edit.fx for a drawn channel with transitions)',
  'editing.cutSnapToPhrase': 'director.plan cuts on the named word (the node always snaps)',
  'sourcing.foundLiteral': 'visuals.fulfil literal search (the node default)',
  'sourcing.generatedOnlyWhereReference': 'recipe.mix: generated shares only from measured generated origins',
  'sourcing.footageMinS': 'P7 curves: shot lengths of footage',
  'sourcing.footageMaxS': 'P7 curves: shot lengths of footage',
  'sourcing.placeContinuity': 'visuals.fulfil (room image / place continuity)',
  'sourcing.noRepeatWhileUnused': 'director.plan repeat window (node default)',
  'sourcing.foundStillsShare': 'P7 curves: stills vs footage',
  'sourcing.kindShares': 'P7 curves: shot kinds',
  'sound.musicChanges': 'P7 review: music changes',
  'sound.sfx': 'P5 brick choice: no SFX brick unless measured (edit.fx)',
  'captions.maxCueS': 'captions.make cue length (P7 review)',
  'captions.style': 'P7 blind judge axis « captions »',
  'captions.onScreenTextChecked': 'director.plan text check (node default)',
  'captions.syncOffsetS': 'P7 review: caption sync',
  'packaging.titlePattern': 'P9 packaging (not in a P6 passage)',
  'packaging.thumbnailPattern': 'P9 packaging (not in a P6 passage)',
  'packaging.thumbnailWords': 'P9 packaging (not in a P6 passage)',
  'packaging.chapterBar': 'P9 packaging (edit.chapters when script.chapters)',
  'cost.usdPerMinute': 'P6 runs --max-usd and P8 cost rounds (engine choices)',
  'cost.makeMinutesPerMinute': 'P8 cost rounds (making time)'
}
