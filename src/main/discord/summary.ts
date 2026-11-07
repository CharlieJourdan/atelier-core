// The daily summary posted in #atlas: what waits for the owner, what is in production, what was published this week and
// what the models cost this month (the Accueil's numbers), then what is late and why and what the team approved without
// asking (the daily report of orchestra/reports.ts).
import { readOverview } from '../home/overview'
import { teamReport } from '../orchestra/reports'
import { t } from '../../shared/fr'
import type { Ctx } from './approvals'
import { excerpt } from './format'

const WEEK_MS = 7 * 24 * 3600 * 1000
const TOP = 5

export function dailySummary(ctx: Ctx, now: number): string {
  const o = readOverview(ctx)
  const published = ctx.workflow.listVideos().filter((v) => v.status === 'published' && Date.parse(v.updatedAt) >= now - WEEK_MS)
  const lines: string[] = [`**${t('discord.summary.title')}**`]

  lines.push('', `**${t('discord.summary.validate')}** : ${o.validations.total}`)
  for (const i of o.validations.top.slice(0, TOP)) lines.push(`• ${i.title} — ${excerpt(i.videoTitle, 80)} (${i.channelName})`)

  lines.push('', `**${t('discord.summary.production')}** : ${o.videos.length}`)
  for (const v of o.videos.slice(0, TOP)) {
    const progress = v.progress === null ? '' : ` ${Math.round(v.progress * 100)} %`
    lines.push(`• ${excerpt(v.title, 80)} (${v.channelName})${progress}${v.step ? ` — ${excerpt(v.step, 60)}` : ''}`)
  }

  lines.push('', `**${t('discord.summary.published')}** : ${published.length}`)
  for (const v of published.slice(0, TOP)) lines.push(`• ${excerpt(v.title, 80)}`)

  lines.push('', `**${t('discord.summary.spend')}** : ${o.spend.spentUsd.toFixed(2)} $`)

  const r = teamReport(ctx.orchestra.parts, 'daily', ctx.orchestra.planner.utc)
  lines.push('', `**${t('discord.summary.late')}** : ${r.late.length}`)
  for (const l of r.late.slice(0, TOP)) lines.push(`• ${l.channelName} — ${excerpt(l.text, 160)}`)
  const auto = r.autoApproved.level + r.autoApproved.rules
  if (auto > 0) lines.push('', t('discord.summary.auto', { n: auto, rules: r.autoApproved.rules }))
  return lines.join('\n')
}
