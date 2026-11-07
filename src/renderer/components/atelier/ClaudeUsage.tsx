// What a run (or the last 7 days) consumed on the user's Claude subscription: tokens, and the API-equivalent cost as a
// figure of comparison only — never money Atelier charges (usage-claude).
import { t } from '../../../shared/fr'
import type { ClaudeUsage } from '../../../shared/api'
import { call, useLoader } from '@/state/client'
import { Panel } from './primitives'

export const fmtTokens = (n: number): string => Math.round(n).toLocaleString('fr-FR')
export const fmtUsd = (n: number): string => n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
export function fmtWork(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s} s`
  const m = Math.floor(s / 60)
  return m < 60 ? `${m} min ${String(s % 60).padStart(2, '0')} s` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`
}

/** « Claude : N tokens (≈ X $ en équivalent API) » for a finished video; nothing when the subscription served nothing. */
export function ClaudeVideoUsage({ videoId, reloadKey }: { videoId: number; reloadKey?: string }) {
  const usage = useLoader(() => call('spend.claudeUsage', { videoId }), `${videoId}:${reloadKey ?? ''}`, ['spend'])
  const u = usage.data
  if (!u || u.calls === 0) return null
  return (
    <p className="m-0 text-[12.5px] text-fg-2" data-testid="claude-usage-video" title={t('claudeUsage.videoDetail', { calls: u.calls, time: fmtWork(u.durationMs) })}>
      {t('claudeUsage.video', { tokens: fmtTokens(u.totalTokens), usd: fmtUsd(u.apiEquivalentUsd) })}
    </p>
  )
}

export function weekDetail(u: ClaudeUsage): string {
  return t('claudeUsage.weekDetail', {
    calls: u.calls,
    time: fmtWork(u.durationMs),
    input: fmtTokens(u.inputTokens),
    output: fmtTokens(u.outputTokens),
    cache: fmtTokens(u.cacheReadTokens + u.cacheWriteTokens)
  })
}

/** Réglages › Claude: the weekly total, by model. */
export function ClaudeWeekPanel() {
  const usage = useLoader(() => call('spend.claudeUsage', { lastWeek: true }), 'week', ['spend'])
  const u = usage.data
  return (
    <Panel title={t('claudeUsage.title')} data-testid="claude-usage-week">
      {!u || u.calls === 0 ? (
        <p className="m-0 text-[13px] text-fg-3">{t('claudeUsage.empty')}</p>
      ) : (
        <div className="flex flex-col gap-1.5 text-[13px]">
          <p className="m-0 font-medium">{t('claudeUsage.week', { tokens: fmtTokens(u.totalTokens), usd: fmtUsd(u.apiEquivalentUsd) })}</p>
          <p className="m-0 text-fg-2">{weekDetail(u)}</p>
          <ul className="m-0 list-none p-0 text-fg-2">
            {u.byModel.map((m) => (
              <li key={m.model}>
                {t('claudeUsage.model', { model: m.model, tokens: fmtTokens(m.inputTokens + m.outputTokens + m.cacheReadTokens + m.cacheWriteTokens), calls: m.calls })}
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="mb-0 mt-3 text-[12px] text-fg-3">{t('claudeUsage.note')}</p>
    </Panel>
  )
}
