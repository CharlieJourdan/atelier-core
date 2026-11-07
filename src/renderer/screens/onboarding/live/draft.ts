// What the flow's answers say to the real backend (real mode): the channel to create, what the analysis looks at, the
// footage answers, the jobs the user does herself, the test video. Pure functions over the answers.
import { t } from '../../../../shared/fr'
import type { InputId } from '../../../../shared/gauge'
import { NICHES } from '@/proto/data-onboarding'
import type { LiveDraft, TestRunDraft } from '@/proto/live/onboarding-live'
import type { ProtoChannel } from '@/proto/types'
import { analysedLink, channelNameOf, sourceKind, type Answers } from '../model'

/** The channel, the link and the words that pick the reference channel. */
export function liveDraftOf(a: Answers, known: Pick<ProtoChannel, 'name' | 'handle'>[]): LiveDraft {
  const kind = sourceKind(a)
  const link = kind === 'own' || kind === 'translate' ? analysedLink(a).trim() : ''
  const niche = NICHES.find((n) => n.id === a.nicheId)
  const standards =
    kind === 'own' ? t('onb.live.note.own', { link }) : kind === 'translate' ? t('onb.live.note.translate', { link, lang: t(`onb.lang.${a.targetLang}`) }) : ''
  return {
    kind,
    name: channelNameOf(a, known),
    niche: kind === 'niche' && niche ? t(niche.nameKey) : kind === 'idea' ? a.idea.trim().slice(0, 120) : '',
    standards,
    link,
    hint: [kind === 'niche' ? a.nicheId : '', link, kind === 'idea' ? a.idea : ''].join(' ').trim(),
    versionNote: t('onb.live.version')
  }
}

/** The questions the analysis asks about the user's footage, answered by the « ce que tu fournis » switches. */
export function footageAnswers(a: Answers): Partial<Record<InputId, boolean>> {
  return { gameplay: a.gameplay, camera: a.rushes }
}

/** The team roles that stay idle because the user does the job herself. */
export function pausedRolesOf(a: Answers): string[] {
  const roles: string[] = []
  if (a.automation.script === 'human') roles.push('scriptwriter')
  if (a.automation.packaging === 'human') roles.push('packaging')
  return roles
}

export function testRunDraftOf(channelName: string, topic: string): TestRunDraft {
  return { title: t('onb.live.test.videoTitle', { channel: channelName }), topic }
}
