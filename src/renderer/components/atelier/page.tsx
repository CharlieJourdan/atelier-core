// Page chrome shared by every section: a generated "aurora" background tinted per section and a serif title.
import type * as React from 'react'
import type { SectionId } from '../../../shared/sections'
import { cn } from '@/lib/utils'

export function Aurora({ section }: { section: SectionId }) {
  // `--tint-<section>` holds "r g b"; `.aurora` reads --aurora.
  return (
    <div
      aria-hidden
      data-aurora={section}
      className="aurora grain"
      style={{ ['--aurora' as string]: `var(--tint-${section}, var(--tint-accueil))` }}
    />
  )
}

export function PageShell({
  section,
  title,
  subtitle,
  actions,
  children,
  className
}: {
  section: SectionId
  title: string
  subtitle?: string
  actions?: React.ReactNode
  children?: React.ReactNode
  className?: string
}) {
  return (
    <section
      data-testid={`view-${section}`}
      aria-labelledby={`title-${section}`}
      className="relative flex h-full min-h-0 flex-col"
    >
      <Aurora section={section} />
      <div className={cn('relative flex min-h-0 flex-1 flex-col overflow-auto px-10 pt-8 pb-10', className)}>
        <header className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 id={`title-${section}`} className="page-title">
              {title}
            </h1>
            {subtitle && <p className="mt-1.5 text-[13px] text-fg-3">{subtitle}</p>}
          </div>
          {actions}
        </header>
        {children}
      </div>
    </section>
  )
}
