// The shell (proto refresh): sidebar | (top bar + page) | main-agent panel. The top bar is the drag area of the window;
// on Windows it leaves room for the native window controls, on macOS the traffic lights sit above the sidebar.
// Sections with curated pages show them as tabs in the top bar; Réglages keeps its column (System Settings style).
// « Nouvelle vidéo » left the top bar for Production's Lab (production-lab, Charlie 01/11).
import { CircleHelp, Moon, Sun } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { t } from '../../../shared/fr'
import { COLUMN_SECTIONS, tabsOf, type Route } from '../../../shared/sections'
import { AgentPanel } from '@/components/agent-panel/AgentPanel'
import { HelpDialog } from '@/components/help/HelpDialog'
import { AgentAvatar } from '@/components/proto/kit'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useRoute } from '@/lib/router'
import { useTheme } from '@/lib/theme'
import { cn } from '@/lib/utils'
import { principal, useProto, useProtoActions } from '@/proto/store'
import { buildCommands } from './commands'
import { CommandPalette } from './CommandPalette'
import { ContextColumn, pageLabel } from './ContextColumn'
import { DataModeSwitch, PresentationBanner } from './DataModeSwitch'
import { BrainBadge } from './BrainBadge'
import type { RailBadges } from './Rail'
import { Sidebar } from './Sidebar'

const SIDEBAR_KEY = 'atelier.sidebar.collapsed'

function readCollapsed(): boolean {
  try {
    return globalThis.localStorage?.getItem(SIDEBAR_KEY) === '1'
  } catch {
    return false
  }
}

function IconButton({ label, onClick, children, testId }: { label: string; onClick: () => void; children: ReactNode; testId?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          data-testid={testId}
          aria-label={label}
          onClick={onClick}
          className="no-drag flex size-8 items-center justify-center rounded-full text-fg-3 outline-none transition-colors duration-150 hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-ring"
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
}

function PageTabs({ route, onSelect }: { route: Route; onSelect: (page: string) => void }) {
  const tabs = tabsOf(route.section)
  if (tabs.length === 0 || COLUMN_SECTIONS.includes(route.section)) return null
  return (
    <div role="tablist" aria-label={t(`section.${route.section}`)} className="no-drag flex items-center gap-0.5" data-testid="page-tabs">
      {tabs.map((p) => {
        const active = p === route.page
        return (
          <button
            key={p}
            type="button"
            role="tab"
            aria-selected={active}
            data-testid={`page-${route.section}-${p}`}
            onClick={() => onSelect(p)}
            className={cn(
              'h-7 rounded-full px-3 text-[13px] whitespace-nowrap outline-none transition-[color,background-color,box-shadow] duration-150 focus-visible:outline-2 focus-visible:outline-ring',
              active ? 'bg-surface-pop font-medium text-fg shadow-[var(--shadow-1)] ring-1 ring-line-2' : 'text-fg-3 hover:bg-hover hover:text-fg'
            )}
          >
            {pageLabel(route.section, p)}
          </button>
        )
      })}
    </div>
  )
}

export function Shell({
  children,
  mac = false,
  badges
}: {
  children: (route: Route, navigate: (r: Route) => void) => ReactNode
  mac?: boolean
  badges?: RailBadges
  engine?: 'ok' | 'warn' | 'err' | 'off'
}) {
  const { route, navigate } = useRoute()
  const { theme, toggle } = useTheme()
  const state = useProto()
  const { toggleAgentPanel } = useProtoActions()
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const hasColumn = COLUMN_SECTIONS.includes(route.section)
  const commands = useMemo(() => buildCommands({ navigate, toggleTheme: toggle }), [navigate, toggle])
  const onPalette = useCallback(() => setPaletteOpen(true), [])
  const agent = principal(state)

  const toggleSidebar = useCallback(() => {
    setCollapsed((v) => {
      try {
        globalThis.localStorage?.setItem(SIDEBAR_KEY, v ? '0' : '1')
      } catch {
        /* not remembered */
      }
      return !v
    })
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey) return
      const k = e.key.toLowerCase()
      if (k === 'b') {
        e.preventDefault()
        toggleSidebar()
      } else if (k === 'j') {
        e.preventDefault()
        toggleAgentPanel()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggleSidebar, toggleAgentPanel])

  const unread = state.threads.reduce((n, th) => n + th.unread, 0)
  const sidebarBadges = {
    accueil: state.inbox.length,
    conversations: unread || (badges?.conversations?.count ?? 0)
  }

  return (
    <div data-testid="shell" data-theme-mode={theme} className="flex h-full bg-bg text-fg">
      <Sidebar
        current={route.section}
        onSelect={navigate}
        onPalette={onPalette}
        collapsed={collapsed}
        onToggle={toggleSidebar}
        badges={sidebarBadges}
        mac={mac}
      />
      {hasColumn && (
        <ContextColumn section={route.section} page={route.page} mac={mac} onSelect={(page) => navigate({ section: route.section, page })} />
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className={cn('drag flex h-[var(--titlebar-h)] shrink-0 items-center justify-between gap-3 pl-4', mac ? 'pr-3' : 'pr-[140px]')}>
          <div className="flex min-w-0 flex-1 items-center gap-3 overflow-hidden">
            <span className="sr-only" data-testid="breadcrumb">
              {t(`section.${route.section}`)}
              {route.page ? ` › ${pageLabel(route.section, route.page)}` : ''}
            </span>
            <PageTabs route={route} onSelect={(page) => navigate({ section: route.section, page })} />
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <BrainBadge />
            <DataModeSwitch />
            <IconButton label={t('shell.help')} onClick={() => setHelpOpen(true)} testId="help-button">
              <CircleHelp className="size-4" aria-hidden />
            </IconButton>
            <IconButton testId="theme-toggle" label={theme === 'dark' ? t('theme.toLight') : t('theme.toDark')} onClick={toggle}>
              {theme === 'dark' ? <Sun className="size-4" aria-hidden /> : <Moon className="size-4" aria-hidden />}
            </IconButton>
            <button
              type="button"
              data-testid="agent-panel-toggle"
              aria-pressed={state.agentPanelOpen}
              aria-label={state.agentPanelOpen ? t('shell.agentPanel.close') : t('shell.agentPanel.open', { name: agent.name })}
              onClick={toggleAgentPanel}
              className={cn(
                'no-drag ml-1 flex h-8 items-center gap-2 rounded-full border border-line-2 pr-3 pl-1.5 text-[13px] font-medium outline-none transition-colors duration-150 hover:border-line-3 hover:bg-hover focus-visible:outline-2 focus-visible:outline-ring',
                state.agentPanelOpen ? 'bg-selected text-fg' : 'text-fg-2'
              )}
            >
              <AgentAvatar agent={agent} size={20} showStatus={false} />
              {agent.name}
            </button>
          </div>
        </div>
        <PresentationBanner />
        <div className="flex min-h-0 flex-1">
          <main className="min-h-0 min-w-0 flex-1">{children(route, navigate)}</main>
          <AgentPanel />
        </div>
      </div>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} commands={commands} />
      <HelpDialog open={helpOpen} onOpenChange={setHelpOpen} />
    </div>
  )
}
