// The rail (PLAN-V2 §2.1): 76 px, logo with the engine light, the sections, ⌘K, Réglages and the profile.
import { Search } from 'lucide-react'
import { t } from '../../../shared/fr'
import { SECTION_IDS, type SectionId } from '../../../shared/sections'
import { Logo } from '@/components/atelier/logo'
import { StatusDot, type Tone } from '@/components/atelier/primitives'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { SectionIcon } from './icons'

export interface RailBadge {
  count?: number
  tone?: Tone
}

export type RailBadges = Partial<Record<SectionId, RailBadge>>

const TOP: readonly SectionId[] = SECTION_IDS.filter((s) => s !== 'reglages')

function RailButton({
  testId,
  label,
  active,
  onClick,
  children,
  badge
}: {
  testId: string
  label: string
  active?: boolean
  onClick: () => void
  children: React.ReactNode
  badge?: RailBadge | undefined
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          data-testid={testId}
          aria-label={label}
          aria-current={active ? 'page' : undefined}
          onClick={onClick}
          className={cn(
            'no-drag relative flex w-[68px] flex-col items-center gap-1 rounded-field py-2 text-[9.5px] leading-none text-fg-3 outline-none focus-visible:ring-2 focus-visible:ring-brand/70 hover:bg-surface-2 hover:text-fg',
            active && 'bg-surface-2 text-fg'
          )}
        >
          {active && <span aria-hidden className="absolute top-2.5 -left-[10px] h-4 w-[2px] rounded-full bg-brand" />}
          {children}
          {badge && (badge.count ?? 0) > 0 && (
            <span
              data-testid={`${testId}-badge`}
              className="absolute top-1 right-1.5 flex min-w-[15px] items-center justify-center rounded-full bg-brand px-1 py-[2px] font-mono text-[9px] text-ink-fg"
            >
              {badge.count}
            </span>
          )}
          {badge && !badge.count && badge.tone && <StatusDot tone={badge.tone} className="absolute top-2 right-3" />}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  )
}

export function Rail({
  current,
  onSelect,
  onPalette,
  badges = {},
  engine = 'off',
  mac = false
}: {
  current: SectionId
  onSelect: (section: SectionId) => void
  onPalette: () => void
  badges?: RailBadges
  engine?: 'ok' | 'warn' | 'err' | 'off'
  /** macOS: leave room for the traffic lights at the top of the rail. */
  mac?: boolean
}) {
  return (
    <nav
      aria-label={t('shell.rail')}
      data-testid="rail"
      className={cn(
        'drag relative z-10 flex w-[var(--rail-w)] shrink-0 flex-col items-center gap-1 border-r border-line bg-bg pb-3',
        mac ? 'pt-11' : 'pt-3'
      )}
    >
      <button
        type="button"
        data-testid="rail-logo"
        aria-label={t('shell.logo')}
        title={t('shell.logo')}
        onClick={() => onSelect('accueil')}
        className="no-drag relative mb-2 rounded-field p-1 outline-none focus-visible:ring-2 focus-visible:ring-brand/70 transition-transform hover:scale-105"
      >
        <Logo />
        <StatusDot
          tone={engine}
          label={t(`engine.${engine}`)}
          className="absolute -right-0.5 -bottom-0.5 ring-2 ring-bg"
        />
      </button>

      {TOP.map((id) => (
        <RailButton
          key={id}
          testId={`rail-${id}`}
          label={t(`section.${id}`)}
          active={id === current}
          badge={badges[id]}
          onClick={() => onSelect(id)}
        >
          <SectionIcon section={id} />
          <span>{t(`section.${id}`)}</span>
        </RailButton>
      ))}

      <div className="flex-1" />

      <RailButton testId="rail-palette" label={`${t('shell.palette')} (${t('shell.paletteKey')})`} onClick={onPalette}>
        <Search className="size-[18px]" strokeWidth={1.7} aria-hidden />
        <span>{t('shell.paletteKey')}</span>
      </RailButton>
      <RailButton
        testId="rail-reglages"
        label={t('section.reglages')}
        active={current === 'reglages'}
        badge={badges.reglages}
        onClick={() => onSelect('reglages')}
      >
        <SectionIcon section="reglages" />
        <span>{t('section.reglages')}</span>
      </RailButton>
      <button
        type="button"
        data-testid="rail-profile"
        aria-label={t('shell.profile')}
        title={t('shell.profile')}
        onClick={() => onSelect('reglages')}
        className="no-drag mt-1 flex size-8 items-center justify-center rounded-full border border-line-2 bg-surface-2 text-xs font-medium text-fg-2 transition-colors hover:text-fg"
      >
        C
      </button>
    </nav>
  )
}
