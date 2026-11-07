// Mes outils › the list of tools: status, version, kind and what they are exposed to.
import { Wrench } from 'lucide-react'
import { t } from '../../../shared/fr'
import type { ToolRow } from '../../../shared/tools'
import { ExampleBadge } from '@/components/atelier/kit'
import { cn } from '@/lib/utils'
import { StatusChip, kindLabel } from './common'

export function ToolList({ tools, selected, onSelect }: { tools: readonly ToolRow[]; selected: string | null; onSelect: (slug: string) => void }) {
  return (
    <ul className="m-0 flex list-none flex-col gap-2 p-0" data-testid="tools-list" aria-label={t('tools.list.label')}>
      {tools.map((tool) => (
        <li key={tool.slug}>
          <button
            type="button"
            aria-pressed={tool.slug === selected}
            onClick={() => onSelect(tool.slug)}
            className={cn(
              'flex w-full flex-col gap-1.5 rounded-card border bg-surface-1 p-3.5 text-left outline-none transition-colors hover:border-line-3 focus-visible:ring-2 focus-visible:ring-brand/70',
              tool.slug === selected ? 'border-brand/60 bg-brand-soft' : 'border-line'
            )}
          >
            <span className="flex items-center gap-2">
              <Wrench className="size-3.5 shrink-0 text-fg-3" aria-hidden />
              <span className="line-clamp-1 text-[14px] font-medium text-fg">{tool.name}</span>
              {tool.example && <ExampleBadge />}
            </span>
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-fg-3">
              <StatusChip status={tool.status} />
              <span>
                {kindLabel(tool.kind)} · v{tool.version}
              </span>
            </span>
            {tool.status === 'error' && tool.error && <span className="line-clamp-2 text-[12px] text-err">{tool.error}</span>}
            <span className="text-[11.5px] text-fg-3">
              {tool.grantedAgents.length > 0 ? t('tools.list.agents', { n: tool.grantedAgents.length }) : t('tools.list.noAgents')}
              {' · '}
              {t('tools.list.perms', { granted: tool.permissionsGranted, total: tool.permissionsRequested })}
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}
