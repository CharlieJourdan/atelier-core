// "Cette semaine": the next seven days, one column each, one dot per video to publish in the colour of its channel.
import { t } from '../../../shared/fr'
import { SectionHead } from '@/components/proto/kit'
import { cn } from '@/lib/utils'
import { channelColorVar, channelOf, useProto } from '@/proto/store'
import type { Route } from '../../../shared/sections'
import { addDays, fmtLongDay, fmtWeekdayShort, startOfDay } from '../planning/dates'
import { weekStrip } from './home-model'

export function WeekStrip({ onRoute, today = new Date() }: { onRoute: (r: Route) => void; today?: Date }) {
  const state = useProto()
  const days = weekStrip(state.videos, state.scope)
  const total = days.reduce((n, d) => n + d.dots.length, 0)
  const base = startOfDay(today)
  return (
    <section data-testid="home-week" aria-label={t('home.dash.week')}>
      <SectionHead
        title={t('home.dash.week')}
        action={
          <button type="button" onClick={() => onRoute({ section: 'planning' })} className="text-[12.5px] font-medium text-fg-3 hover:text-fg">
            {t('home.dash.openPlanning')}
          </button>
        }
      />
      <div className="grid grid-cols-7 overflow-hidden rounded-[16px] border border-line-2 bg-surface-1">
        {days.map((d, i) => {
          const date = addDays(base, d.offset)
          return (
            <button
              key={d.offset}
              type="button"
              data-testid="week-day"
              aria-label={t('home.dash.week.day', { day: fmtLongDay(date), n: d.dots.length })}
              onClick={() => onRoute({ section: 'planning' })}
              className={cn(
                'flex min-h-[104px] min-w-0 flex-col px-3 py-2.5 text-left outline-none transition-colors hover:bg-hover focus-visible:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring',
                i > 0 && 'border-l border-line'
              )}
            >
              <span className={cn('text-[11.5px] font-medium', d.offset === 0 ? 'text-fg' : 'text-fg-3')}>{d.offset === 0 ? t('common.today') : fmtWeekdayShort(date)}</span>
              <span className="num mt-0.5 flex items-baseline gap-1">
                <span className={cn('text-[20px] leading-none font-medium tracking-[-0.02em]', d.dots.length === 0 && 'text-fg-4')}>{d.dots.length}</span>
              </span>
              <span className="mt-auto flex flex-wrap gap-[3px] pt-2" aria-hidden>
                {d.dots.slice(0, 12).map((dot) => (
                  <span key={dot.videoId} className="size-[7px] rounded-full" style={{ background: channelColorVar(channelOf(state, dot.channelId)) }} />
                ))}
              </span>
            </button>
          )
        })}
      </div>
      {total === 0 && <p className="mt-2 text-[12.5px] text-fg-3">{t('home.dash.week.empty')}</p>}
    </section>
  )
}
