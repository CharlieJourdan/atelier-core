// DémoBadge and DemoBoundary (PLAN-V2 §8.4): anything that is not real is labelled, and says how to make it real.
// Demo code must never call a write method of the API (a lint rule guards src/renderer/demo/**).
import { FlaskConical } from 'lucide-react'
import type * as React from 'react'
import type { FeatureId } from '../../../shared/features'
import { t } from '../../../shared/fr'
import { useFeature } from '@/lib/features'
import { cn } from '@/lib/utils'

export function DemoBadge({ className, title }: { className?: string; title?: string }) {
  return (
    <span
      data-testid="demo-badge"
      title={title}
      className={cn(
        'inline-flex items-center gap-1 rounded-full border border-line-2 bg-surface-2 px-2 py-[3px] text-[11px] leading-none font-medium text-fg-2',
        className
      )}
    >
      <FlaskConical className="size-3" aria-hidden />
      {t('demo.badge')}
    </span>
  )
}

/** The banner shown above demo content (also used directly in tests and the gallery). */
export function DemoBanner({ reason, unlockedBy }: { reason?: string; unlockedBy?: string }) {
  return (
    <div
      data-testid="demo-banner"
      role="note"
      className="mb-4 flex items-start gap-3 rounded-card border border-brand/30 bg-brand-soft px-4 py-3"
    >
      <DemoBadge className="mt-0.5" />
      <div className="text-[13px] text-fg-2">
        <p>
          {t('demo.boundary')}
          {reason ? ` ${reason}` : ''}
        </p>
        {unlockedBy && <p className="mt-0.5 text-fg-3">{t('demo.unlock', { how: unlockedBy })}</p>}
      </div>
    </div>
  )
}

/** Wraps a screen or block that depends on `feature`: real → just the children; otherwise banner + children. */
export function DemoBoundary({ feature, children }: { feature: FeatureId; children: React.ReactNode }) {
  const state = useFeature(feature)
  if (state.status === 'real') return <>{children}</>
  return (
    <div data-feature={feature} data-status={state.status}>
      <DemoBanner reason={state.reason} unlockedBy={state.unlockedBy} />
      {children}
    </div>
  )
}
