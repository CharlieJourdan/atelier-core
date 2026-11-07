// Shared bits of the Idées / Automatisations / Ressources screens: labels and the channel list hook.
import { t, type MessageKey } from '../../../shared/fr'
import type { AutomationRow, IdeaStatus } from '../../../shared/api/ideas'
import { call, useLoader } from '@/state/client'

export const ideaStatusLabel = (s: IdeaStatus): string => t(`ideas.status.${s}` as MessageKey)

export function useChannels() {
  return useLoader(() => call('channels.list'), 'ideas-channels', ['channels', 'example'])
}

/** 0 = Sunday … 6 = Saturday. */
export const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const
export const weekdayLabel = (d: number): string => t(`automations.weekday.${d}` as MessageKey)

export const hourLabel = (h: number): string => `${String(h).padStart(2, '0')} h`

/** « Chaque jour à 08 h », « Chaque lundi à 09 h », « À la main ». */
export function cadenceText(a: Pick<AutomationRow, 'cadence' | 'weekday' | 'hour'>): string {
  if (a.cadence === 'manual') return t('automations.cadence.manual')
  if (a.cadence === 'daily') return t('automations.cadence.dailyAt', { hour: hourLabel(a.hour) })
  return t('automations.cadence.weeklyAt', { day: weekdayLabel(a.weekday ?? 1), hour: hourLabel(a.hour) })
}

export const budgetLabel = (m: AutomationRow['budgetMode']): string => t(`runs.budget.${m}` as MessageKey)
export const gateLabel = (m: AutomationRow['gateMode']): string => t(`runs.gateMode.${m}` as MessageKey)
