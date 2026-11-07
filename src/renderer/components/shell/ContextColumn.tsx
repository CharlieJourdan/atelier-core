// The context column (248 px): the sub-pages of the current section. Hidden for sections without pages, and when the
// user folds it.
import { t, type MessageKey } from '../../../shared/fr'
import { pagesOf, type SectionId } from '../../../shared/sections'
import { cn } from '@/lib/utils'

export function pageLabel(section: SectionId, page: string): string {
  return t(`page.${section}.${page}` as MessageKey)
}

export function ContextColumn({
  section,
  page,
  onSelect,
  mac = false
}: {
  section: SectionId
  page: string | undefined
  onSelect: (page: string) => void
  mac?: boolean
}) {
  const pages = pagesOf(section)
  if (pages.length === 0) return null
  return (
    <aside
      aria-label={t('shell.context')}
      data-testid="context-column"
      className={cn('relative z-10 flex w-[var(--context-w)] shrink-0 flex-col gap-0.5 border-r border-line bg-bg px-3 pb-4', mac ? 'pt-11' : 'pt-12')}
    >
      <h2 className="micro-label mb-2 px-2">{t(`section.${section}`)}</h2>
      {pages.map((p) => {
        const active = p === page
        return (
          <button
            key={p}
            type="button"
            data-testid={`page-${section}-${p}`}
            aria-current={active ? 'page' : undefined}
            onClick={() => onSelect(p)}
            className={cn(
              'no-drag rounded-field px-2.5 py-1.5 text-left text-[13px] text-fg-3 outline-none focus-visible:ring-2 focus-visible:ring-brand/70 hover:bg-surface-2 hover:text-fg',
              active && 'bg-surface-2 text-fg'
            )}
          >
            {pageLabel(section, p)}
          </button>
        )
      })}
    </aside>
  )
}
