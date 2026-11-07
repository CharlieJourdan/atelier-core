// The Style Definition's OWN defaults (decision 0095): the value of every field when nothing was measured, all marked
// `default`. They belong to the definition, never to a base pipeline's options: plan-rules.ts refuses a `default` field
// whose value differs from this table (no base default sneaks in as « default »). Neutral values; P4 overwrites every field
// the synthesis measured.
import type { Sourced, StyleDefinition } from '../../../shared/clone'

const d = <T>(value: T): Sourced<T> => ({ value, source: 'default', evidence: [] })

export type DefinitionBody = Omit<StyleDefinition, 'schema' | 'cloneId' | 'createdAt' | 'version' | 'channel' | 'analysisMeasures' | 'baseStart'>

export function definitionDefaults(): DefinitionBody {
  return {
    script: {
      partCount: d(5),
      parts: d([]),
      frame: d('essay'),
      hookWindowS: d(15),
      hookPattern: d(''),
      hookLevers: d([]),
      promise: d(''),
      promiseRepeatAt: d([]),
      payoff: d(''),
      maxNoConcreteS: d(30),
      wordsPerMinute: d(150),
      sentenceWordsMean: d(14),
      tone: d(''),
      addressMode: d('you'),
      devices: d([]),
      chapters: d(false),
      cta: d(''),
      bannedOpenings: d([]),
      numbersAsWords: d(true),
      outline: d([]),
      illustratedShare: d(0.9),
      illustratesByPart: d([])
    },
    voice: {
      mode: d('same-kind'),
      kind: d('synthetic'),
      timbre: d(''),
      descriptors: d([]),
      wordsPerMinute: d(150),
      pausesPerMinute: d(0),
      meanPauseS: d(0),
      energy: d('medium'),
      voiceRef: d(null),
      language: d(''),
      wpmByPart: d([])
    },
    presenter: {
      kind: d('none'),
      mode: d('none'),
      identity: d(null),
      angleCount: d(0),
      configurations: d([]),
      layoutCurve: d([]),
      presenceByPart: d([]),
      entries: d([]),
      exits: d([]),
      noSameConfigTwice: d(true),
      presenterRef: d(null),
      talkSecondsPerMinute: d(0),
      windowMeanS: d(0),
      placeholder: d(null)
    },
    motion: {
      elements: d([]),
      palette: d([]),
      fonts: d([]),
      densityByPart: d([]),
      explainWhenNoMedia: d(true),
      neverSameTypeTwice: d(true),
      coverageByPart: d([])
    },
    editing: {
      meanShotS: d(4),
      medianShotS: d(3.5),
      p90ShotS: d(7),
      shotCurve: d([]),
      hookMeanShotS: d(2.5),
      cutTypes: d({}),
      transitions: d([]),
      holdMaxS: d(5),
      cutSnapToPhrase: d(true),
      cameraMoves: d([]),
      colour: d(''),
      illustrationLeadS: d(0),
      letterbox: d(null),
      aspect: d('16:9'),
      shotByPart: d([])
    },
    sourcing: {
      originShares: d({}),
      foundLiteral: d(true),
      generatedOnlyWhereReference: d(true),
      footageMinS: d(1.5),
      footageMaxS: d(7),
      placeContinuity: d(true),
      noRepeatWhileUnused: d(true),
      illustrationStyle: d(''),
      grade: d(''),
      foundStillsShare: d(0),
      kindShares: d({}),
      povShare: d(0),
      depthShare: d(0),
      generatedLook: d(''),
      heldObjects: d([]),
      povOpeningShare: d(0),
      figures: d(null),
      distributions: d([])
    },
    sound: {
      music: d(false),
      musicGenre: d(''),
      musicLevelUnderVoiceDb: d(-24),
      musicChanges: d('none'),
      sfx: d([]),
      loudnessLufs: d(-14)
    },
    captions: {
      burnIn: d(false),
      maxWordsPerCue: d(7),
      maxCueS: d(4),
      style: d(''),
      onScreenTextChecked: d(true),
      syncOffsetS: d(0)
    },
    packaging: {
      titlePattern: d(''),
      thumbnailPattern: d(''),
      thumbnailWords: d(3),
      chapterBar: d(false)
    },
    cost: {
      usdPerMinute: d(1),
      makeMinutesPerMinute: d(10)
    }
  }
}
