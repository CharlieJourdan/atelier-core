// One channel in the list: identity, figures (or the invitation to connect Analytics), cadence, who does what as five tiny
// step pills, and the styles assigned. The whole card opens the detail; "Connecter" opens it on the connections tab.
import { CalendarDays, Languages } from 'lucide-react'
import { t, type MessageKey } from '../../../shared/fr'
import { ChannelAvatar, fmtCompact } from '@/components/proto/kit'
import { cn } from '@/lib/utils'
import { channelColorVar } from '@/proto/store'
import { call, useLoader } from '@/state/client'
import type { AutomationMode, ProtoChannel, ProtoPipeline } from '@/proto/types'
import { AUTOMATION_KEYS } from '../onboarding/parts'

export const MODE_LETTER: Record<AutomationMode, string> = { auto: 'A', validate: 'V', human: 'M' }
const STEP_SHORT: Record<(typeof AUTOMATION_KEYS)[number], MessageKey> = {
  idea: 'chan.step.idea',
  script: 'chan.step.script',
  production: 'chan.step.production',
  packaging: 'chan.step.packaging',
  publishing: 'chan.step.publishing'
}

/** The five steps as tiny pills: filled = automatic, soft = you validate, dashed = you do it. */
export function StepPills({ automation, className }: { automation: ProtoChannel['automation']; className?: string }) {
  return (
    <ul className={cn('flex flex-wrap gap-1.5', className)} data-testid="step-pills" aria-label={t('chan.pills.label')}>
      {AUTOMATION_KEYS.map((key) => {
        const mode = automation[key]
        return (
          <li
            key={key}
            data-mode={mode}
            title={`${t(STEP_SHORT[key])} : ${t(`automation.${mode}`)}`}
            className={cn(
              'inline-flex h-[22px] items-center gap-1.5 rounded-full px-2 text-[11px] font-medium',
              mode === 'auto' && 'bg-ink text-ink-fg',
              mode === 'validate' && 'bg-surface-3 text-fg',
              mode === 'human' && 'border border-dashed border-line-3 text-fg-2'
            )}
          >
            <span className="opacity-80">{t(STEP_SHORT[key])}</span>
            <span className="font-semibold">{MODE_LETTER[mode]}</span>
          </li>
        )
      })}
    </ul>
  )
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[11.5px] text-fg-3">{label}</p>
      <p className="num mt-0.5 text-[20px] leading-tight font-medium tracking-[-0.02em] text-fg">{value}</p>
    </div>
  )
}

/** The names of the pipelines the channel's film types use (`recipes.channel`): a live channel is `db-<id>`; none for the examples (QA C1). */
export function useAssignedPipelineNames(channelId: string): string[] {
  const id = /^db-(\d+)$/.exec(channelId)?.[1]
  const names = useLoader(
    async () => {
      if (id === undefined) return []
      const [view, list] = await Promise.all([call('recipes.channel', Number(id)), call('recipes.list')])
      const used = new Set(Object.values(view.recipes))
      return list.filter((r) => used.has(r.id)).map((r) => r.name)
    },
    `assigned-${channelId}`,
    ['production', 'channels']
  )
  return names.data ?? []
}

export function ChannelCard({
  channel,
  source,
  pipelines,
  onOpen
}: {
  channel: ProtoChannel
  source: ProtoChannel | undefined
  pipelines: ProtoPipeline[]
  onOpen: (tab?: string) => void
}) {
  const own = pipelines.filter((p) => channel.pipelineIds.includes(p.id)).map((p) => p.name)
  const assigned = useAssignedPipelineNames(channel.id)
  const shown = assigned.length > 0 ? assigned : own
  return (
    <article data-testid={`channel-card-${channel.id}`} className="card card-hover relative flex min-w-0 flex-col p-5">
      <button
        type="button"
        data-testid={`channel-open-${channel.id}`}
        aria-label={t('chan.open', { name: channel.name })}
        onClick={() => onOpen()}
        className="absolute inset-0 rounded-[16px] outline-none focus-visible:outline-2 focus-visible:outline-ring"
      />
      <header className="flex items-start gap-3">
        <ChannelAvatar channel={channel} size={42} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[15px] font-semibold tracking-[-0.014em] text-fg">{channel.name}</h2>
          <p className="truncate text-[12.5px] text-fg-3">{channel.handle}</p>
        </div>
        <span className="num shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-[11.5px] font-medium text-fg-2">{channel.language.toUpperCase()}</span>
      </header>
      <p className="mt-3 mb-4 line-clamp-2 min-h-[2.6em] text-[13px] leading-[1.45] text-fg-2">{channel.niche}</p>
      {source && (
        <p className="mt-2 inline-flex items-center gap-1.5 self-start rounded-full border border-line-2 px-2.5 py-0.5 text-[11.5px] text-fg-2" data-testid="translated-tag">
          <Languages className="size-3" aria-hidden />
          {t('chan.translatedFrom', { name: source.name })}
        </p>
      )}

      <div className="mt-auto border-t border-line pt-4">
        {channel.connected ? (
          <div className="grid grid-cols-3 gap-3" data-testid="channel-figures">
            <Figure label={t('chan.subscribers')} value={fmtCompact(channel.subscribers)} />
            <Figure label={t('chan.views28')} value={fmtCompact(channel.views28d)} />
            <div className="min-w-0">
              <p className="text-[11.5px] text-fg-3">{t('chan.trend')}</p>
              <p className={cn('num mt-0.5 text-[20px] leading-tight font-medium tracking-[-0.02em]', channel.trend >= 0 ? 'text-ok' : 'text-err')}>
                {channel.trend >= 0 ? '+' : '−'}
                {Math.abs(channel.trend)} %
              </p>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3" data-testid="channel-not-connected">
            <div className="min-w-0">
              <p className="text-[11.5px] text-fg-3">{t('chan.subscribers')}</p>
              <p className="num mt-0.5 text-[20px] leading-tight font-medium tracking-[-0.02em] text-fg">{fmtCompact(channel.subscribers)}</p>
            </div>
            <div className="relative z-10 flex min-w-0 items-center gap-2.5 text-right">
              <span className="text-[12.5px] leading-tight text-fg-3">{t('chan.analyticsOff')}</span>
              <button
                type="button"
                data-testid={`channel-connect-${channel.id}`}
                onClick={() => onOpen('connections')}
                className="shrink-0 rounded-full border border-line-3 px-3 py-1 text-[12.5px] font-medium text-fg outline-none hover:bg-hover focus-visible:outline-2 focus-visible:outline-ring"
              >
                {t('chan.connect')}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="mt-4 flex items-center gap-2 text-[12.5px] text-fg-3">
        <CalendarDays className="size-3.5 shrink-0" aria-hidden />
        <span className="truncate">{channel.cadence}</span>
      </div>
      <StepPills automation={channel.automation} className="mt-3" />
      <p className="mt-3.5 flex min-w-0 items-center gap-2 text-[12.5px] text-fg-3">
        <span aria-hidden className="h-3 w-[3px] shrink-0 rounded-full" style={{ background: channelColorVar(channel) }} />
        <span className="truncate" data-testid="channel-pipelines">
          {shown.length > 0 ? shown.join(' · ') : t('chan.noPipeline')}
        </span>
      </p>
    </article>
  )
}
