// The sidebar (proto refresh): one labelled, collapsible column in the ChatGPT / Apple manner. Top: the mark and the
// channel switcher (which channel the whole app shows, or all of them). Middle: two groups of sections. Bottom: the
// credits meter, Réglages and the profile. Collapsed, it keeps icons only (tooltips carry the labels).
import { Check, ChevronsUpDown, CloudOff, Languages, LogIn, LogOut, PanelLeftClose, PanelLeftOpen, Plus, Search, Settings2, Sparkles, UserRound } from 'lucide-react'
import { t } from '../../../shared/fr'
import { SIDEBAR_GROUPS, type SectionId } from '../../../shared/sections'
import { Logo } from '@/components/atelier/logo'
import { ChannelAvatar, fmtNum } from '@/components/proto/kit'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useLocale } from '@/lib/locale'
import { useRoute } from '@/lib/router'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'
import { useProto, useProtoActions, type Scope } from '@/proto/store'
import { requestAddChannel } from '@/screens/channels/add-intent'
import { backToWelcome } from '@/screens/welcome/gate'
import { SectionIcon } from './icons'

export type SidebarBadges = Partial<Record<SectionId, number>>

function NavRow({
  section,
  active,
  collapsed,
  badge,
  onClick
}: {
  section: SectionId
  active: boolean
  collapsed: boolean
  badge?: number | undefined
  onClick: () => void
}) {
  const label = t(`section.${section}`)
  const row = (
    <button
      type="button"
      data-testid={`rail-${section}`}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
      className={cn(
        'no-drag group relative flex h-8 w-full items-center gap-2.5 rounded-[10px] text-[13.5px] tracking-[-0.006em] outline-none transition-colors duration-150 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring',
        collapsed ? 'justify-center px-0' : 'px-2.5',
        active ? 'bg-brand-soft font-medium text-fg' : 'text-fg-2 hover:bg-hover hover:text-fg'
      )}
    >
      <SectionIcon section={section} className={cn('size-[17px] shrink-0', active ? 'text-brand-fg' : 'text-fg-3 group-hover:text-fg-2')} />
      {!collapsed && <span className="min-w-0 flex-1 truncate text-left">{label}</span>}
      {badge !== undefined && badge > 0 && (
        <span
          data-testid={`rail-${section}-badge`}
          className={cn(
            'num rounded-full bg-brand px-1.5 py-px text-[10.5px] font-semibold text-brand-ink',
            collapsed && 'absolute top-0.5 right-1 min-w-[16px] px-1 text-center text-[9.5px]'
          )}
        >
          {badge}
        </span>
      )}
    </button>
  )
  if (!collapsed) return row
  return (
    <Tooltip>
      <TooltipTrigger asChild>{row}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  )
}

function ChannelSwitcher({ collapsed, onManage }: { collapsed: boolean; onManage: () => void }) {
  const { channels, scope } = useProto()
  const { setScope } = useProtoActions()
  const current = scope === 'all' ? undefined : channels.find((c) => c.id === scope)
  const pick = (s: Scope) => setScope(s)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-testid="channel-switcher"
          aria-label={t('scope.label')}
          className={cn(
            'no-drag flex h-11 w-full items-center gap-2.5 rounded-[12px] text-left outline-none hover:bg-hover focus-visible:outline-2 focus-visible:outline-ring',
            collapsed ? 'justify-center' : 'border border-line-2 bg-surface-1 px-2.5'
          )}
        >
          {current ? (
            <ChannelAvatar channel={current} size={24} />
          ) : (
            <span aria-hidden className="grid size-6 shrink-0 grid-cols-2 gap-[2px] rounded-full p-[3px] ring-1 ring-line-2">
              {channels.slice(0, 4).map((c) => (
                <span key={c.id} className="rounded-full" style={{ background: `var(--ch-${c.color})` }} />
              ))}
            </span>
          )}
          {!collapsed && (
            <>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-fg">{current ? current.name : t('scope.all')}</span>
                <span className="block truncate text-[11.5px] text-fg-3">
                  {current ? current.handle : t('scope.all.hint', { n: channels.length })}
                </span>
              </span>
              <ChevronsUpDown className="size-3.5 shrink-0 text-fg-3" aria-hidden />
            </>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side={collapsed ? 'right' : 'bottom'} className="w-[260px]">
        <DropdownMenuLabel className="text-[11.5px] font-medium text-fg-3">{t('scope.label')}</DropdownMenuLabel>
        <DropdownMenuItem data-testid="scope-all" onSelect={() => pick('all')}>
          <span aria-hidden className="grid size-5 grid-cols-2 gap-[2px] rounded-full p-[2px] ring-1 ring-line-2">
            {channels.slice(0, 4).map((c) => (
              <span key={c.id} className="rounded-full" style={{ background: `var(--ch-${c.color})` }} />
            ))}
          </span>
          <span className="flex-1">{t('scope.all')}</span>
          {scope === 'all' && <Check className="size-4" aria-hidden />}
        </DropdownMenuItem>
        {channels.map((c) => (
          <DropdownMenuItem key={c.id} data-testid={`scope-${c.id}`} onSelect={() => pick(c.id)}>
            <ChannelAvatar channel={c} size={20} />
            <span className="min-w-0 flex-1 truncate">{c.name}</span>
            <span className="text-[11px] text-fg-3 uppercase">{c.language}</span>
            {scope === c.id && <Check className="size-4" aria-hidden />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          data-testid="scope-add"
          onSelect={() => {
            requestAddChannel()
            onManage()
          }}
        >
          <Plus aria-hidden />
          {t('scope.add')}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onManage}>
          <Settings2 aria-hidden />
          {t('scope.manage')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function CreditsMeter({ collapsed, onOpen }: { collapsed: boolean; onOpen: () => void }) {
  const { workspace } = useProto()
  // real mode: the Cloud account's credits (no meter without a monthly allowance); offline: nothing to count
  if (collapsed || workspace.cloud === 'offline') return null
  const pct = workspace.creditsMonthly > 0 ? Math.min(100, Math.round((workspace.credits / workspace.creditsMonthly) * 100)) : null
  return (
    <button
      type="button"
      data-testid="sidebar-credits"
      onClick={onOpen}
      className="no-drag mb-1 w-full rounded-[12px] px-2.5 py-2 text-left outline-none hover:bg-hover focus-visible:outline-2 focus-visible:outline-ring"
    >
      <span className="flex items-baseline justify-between gap-2 text-[12px]">
        <span className="text-fg-3">{t('credits.title')}</span>
        <span className="num font-medium text-fg">{fmtNum(workspace.credits)}</span>
      </span>
      {pct !== null && (
        <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-surface-3">
          <span className="block h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
        </span>
      )}
    </button>
  )
}

function ProfileMenu({ collapsed, onSettings }: { collapsed: boolean; onSettings: () => void }) {
  const { workspace } = useProto()
  const { setOnboarded } = useProtoActions()
  const { locale, setLocale } = useLocale()
  const { navigate } = useRoute()
  const offline = workspace.cloud === 'offline'
  const signedIn = workspace.cloud === 'signed-in'
  const me = workspace.members[0]
  const name = offline ? t('beta.account.offline') : (me?.name ?? '')
  const sub = offline ? t('beta.account.offline.sub') : signedIn ? workspace.plan : t('shell.plan', { plan: workspace.plan })
  const leave = (signOut: boolean): void => {
    backToWelcome(signOut)
      .then(() => signOut && toast.success(t('beta.account.signedOut')))
      .catch((e: unknown) => toast.error(e instanceof Error ? e.message : String(e)))
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-testid="rail-profile"
          className={cn(
            'no-drag mt-1 flex w-full items-center gap-2.5 rounded-[8px] py-1.5 text-left outline-none hover:bg-hover focus-visible:outline-2 focus-visible:outline-ring',
            collapsed ? 'justify-center' : 'px-2.5'
          )}
        >
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-3 text-[12px] font-semibold text-fg">
            {offline ? <CloudOff className="size-3.5 text-fg-3" aria-hidden /> : (me?.initials ?? '·')}
          </span>
          {!collapsed && (
            <span className="min-w-0 flex-1" data-testid="profile-identity" data-cloud={workspace.cloud ?? 'demo'}>
              <span className="block truncate text-[13px] font-medium text-fg">{name}</span>
              <span className="block truncate text-[11.5px] text-fg-3">{sub}</span>
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-[260px]">
        {signedIn && (
          <>
            <DropdownMenuLabel className="flex flex-col gap-0.5 font-normal" data-testid="profile-account">
              <span className="truncate text-[13px] font-medium text-fg">{me?.name}</span>
              <span className="truncate text-[11.5px] text-fg-3">{workspace.email}</span>
              <span className="truncate text-[11.5px] text-fg-3">
                {workspace.name} · {workspace.plan} · {t('beta.account.credits', { n: fmtNum(workspace.credits) })}
              </span>
            </DropdownMenuLabel>
            <DropdownMenuItem data-testid="profile-account-settings" onSelect={() => navigate({ section: 'reglages', page: 'compte' })}>
              <UserRound aria-hidden />
              {t('beta.account.settings')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        {offline && (
          <>
            <DropdownMenuItem data-testid="profile-sign-in" onSelect={() => leave(false)}>
              <LogIn aria-hidden />
              {t('beta.account.signIn')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuLabel className="text-[11.5px] font-medium text-fg-3">{t('shell.locale')}</DropdownMenuLabel>
        {(['fr', 'en'] as const).map((l) => (
          <DropdownMenuItem key={l} data-testid={`locale-${l}`} onSelect={() => setLocale(l)}>
            <Languages aria-hidden />
            <span className="flex-1">{t(`shell.locale.${l}`)}</span>
            {locale === l && <Check className="size-4" aria-hidden />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => setOnboarded(false)}>
          <Sparkles aria-hidden />
          {t('shell.replayOnboarding')}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onSettings}>
          <Settings2 aria-hidden />
          {t('section.reglages')}
        </DropdownMenuItem>
        {signedIn && (
          <DropdownMenuItem data-testid="profile-sign-out" onSelect={() => leave(true)}>
            <LogOut aria-hidden />
            {t('beta.account.signOut')}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function Sidebar({
  current,
  onSelect,
  onPalette,
  collapsed,
  onToggle,
  badges = {},
  mac = false
}: {
  current: SectionId
  onSelect: (section: SectionId) => void
  onPalette: () => void
  collapsed: boolean
  onToggle: () => void
  badges?: SidebarBadges
  mac?: boolean
}) {
  return (
    <nav
      aria-label={t('shell.sidebar')}
      data-testid="rail"
      className={cn(
        'relative z-20 flex h-full shrink-0 flex-col border-r border-line bg-sidebar transition-[width] duration-200 ease-out',
        collapsed ? 'w-[var(--sidebar-w-collapsed)] px-2' : 'w-[var(--sidebar-w)] px-3'
      )}
    >
      <div className={cn('drag flex h-[var(--titlebar-h)] shrink-0 items-center gap-2', mac && !collapsed && 'pl-[68px]', collapsed && 'justify-center')}>
        {!collapsed && (
          <span className="flex min-w-0 flex-1 items-center gap-2">
            <Logo size={22} />
            <span className="truncate text-[14px] font-semibold tracking-[-0.014em]">{t('app.name')}</span>
          </span>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              data-testid="sidebar-toggle"
              aria-label={collapsed ? t('shell.sidebar.expand') : t('shell.sidebar.collapse')}
              onClick={onToggle}
              className="no-drag flex size-7 items-center justify-center rounded-[8px] text-fg-3 outline-none hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-ring"
            >
              {collapsed ? <PanelLeftOpen className="size-4" aria-hidden /> : <PanelLeftClose className="size-4" aria-hidden />}
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">
            {collapsed ? t('shell.sidebar.expand') : t('shell.sidebar.collapse')} <span className="kbd ml-1">Ctrl B</span>
          </TooltipContent>
        </Tooltip>
      </div>

      <div className="flex flex-col gap-2 pt-1 pb-3">
        <ChannelSwitcher collapsed={collapsed} onManage={() => onSelect('chaines')} />
        <button
          type="button"
          data-testid="rail-palette"
          aria-label={t('shell.search')}
          onClick={onPalette}
          className={cn(
            'no-drag flex h-8 items-center gap-2.5 rounded-[8px] text-[13.5px] text-fg-3 outline-none hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-ring',
            collapsed ? 'justify-center' : 'px-2.5'
          )}
        >
          <Search className="size-[17px] shrink-0" aria-hidden />
          {!collapsed && (
            <>
              <span className="flex-1 text-left">{t('shell.search')}</span>
              <span className="kbd">Ctrl K</span>
            </>
          )}
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
        {SIDEBAR_GROUPS.map((group, gi) => (
          <div key={gi} className="flex flex-col gap-px">
            {group.map((s) => (
              <NavRow key={s} section={s} active={current === s} collapsed={collapsed} badge={badges[s]} onClick={() => onSelect(s)} />
            ))}
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-px border-t border-line pt-2 pb-3">
        <CreditsMeter collapsed={collapsed} onOpen={() => onSelect('monetisation')} />
        <NavRow section="reglages" active={current === 'reglages'} collapsed={collapsed} onClick={() => onSelect('reglages')} />
        <ProfileMenu collapsed={collapsed} onSettings={() => onSelect('reglages')} />
      </div>
    </nav>
  )
}
