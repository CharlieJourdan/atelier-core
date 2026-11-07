// The « profil mesuré » of `avatar@1` (record 0055): what Charlie's two Headcast reference videos measure
// (research note illustration-grammar-2026-11 (old repository), `measureEditing` over the 427 labelled shots and their word timings), and the
// choices made on them. `avatar@1`'s requirements are derived from it (`settingsFromProfile`); they are this pipeline's settings,
// not the engine's: another base, or a pipeline built from other references, carries its own profile, or none.
import type { ReferenceProfile } from '../reference-profile'

export const AVATAR_PROFILE: ReferenceProfile = {
  source:
    'Charlie’s two Headcast videos (« cette vieille astuce de maçon », « faites ces 5 choses avant les premières… »), 427 shots, ' +
    'measured 2026-11-01 (avatar-qualite)',
  // the full-frame presenter's runs: reference 1 at most 8.56 s (median 7.0), reference 2 at most 7.0 s (median 3.4)
  presenterRunMaxS: 8.56,
  presenterRunMedianS: 7,
  // the word that names the picture comes 0.12 s after the cut (median, both references)
  cutLeadS: 0.12,
  // 93 % and 95 % of their pictures show what the words under them say
  literalShare: 0.93,
  labelsPerMinute: 0,
  // Charlie's verdict on the first real hook (« les 3 derniers plans c'est quasiment les mêmes »)
  repeatWindowS: 20,
  light: 'overcast',
  camera: 'steady',
  // calibrated on run 5 (his four examples scored 1–7, the literal pictures 8–9) and run 4's repeated corners
  illustrationBar: 8,
  alikeWindowS: 20,
  // the presenter's layouts (avatar-efficience, measured on their hand-classed shots): full frame in the hook, then never again
  // after the first split screen (reference 1 at 99 s, reference 2 at 77 s): split 76 % / 78 %, inset 24 % / 22 % of its time.
  // avatar-layouts (research note avatar-layouts-2026-11 (old repository), measured shot by shot on both): the presenter is on the LEFT of every
  // split (67 of 67) and the inset is bottom left, 16:9, 37 % of the width with a white border (17 of 17); two insets are at least
  // 47 s apart (45 here); an appearance that opens on « who I am » is a split. Which sentence gets an inset is not measurable by
  // its words (explanations 5 in 30 and 9 in 38, questions 1 in 7): the shares and the spacing decide, not a trigger.
  presenterLayouts: {
    fromS: 88,
    // the references' last full-frame shot ends at 79 s and 51 s (mean 65 s), their first split starts at 99 s and 77 s
    fullUntilS: 65,
    full: 0,
    split: 0.77,
    pip: 0.23,
    presenterSide: 'left',
    inset: { corner: 'bottom-left', widthFrac: 0.371, marginXFrac: 0.011, marginYFrac: 0.036, borderFrac: 0.003 },
    insetGapS: 45,
    // the last 45 s keep the presenter's share but half of it is the inset (reference 2: 13 of 26 points, reference 1: 10 of 22)
    outro: { lastS: 45, full: 0, split: 0.5, pip: 0.5 },
    triggers: { intro: { split: 1 } }
  }
}
