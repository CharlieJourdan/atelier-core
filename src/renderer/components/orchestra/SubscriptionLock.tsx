// The beta rule on models (decision 0038), on screen: without a working Claude Code or Codex subscription, the agents
// (Équipe, Messages, the switch) and script writing are locked; this card says why, names an account whose sign-in
// expired, and opens Réglages › Claude. Nothing is shown while a subscription works. Real data over IPC (`llm.access`).
import { Lock } from 'lucide-react'
import { t, type MessageKey } from '../../../shared/fr'
import type { Route } from '../../../shared/sections'
import { Button } from '@/components/ui/button'
import { useRoute } from '@/lib/router'
import { cn } from '@/lib/utils'
import { useApi } from '@/state/client'

export const CLAUDE_SETTINGS_ROUTE: Route = { section: 'reglages', page: 'claude' }

/** The lock card; `body` replaces the general blurb (e.g. the script's « import your own, it is free »). */
export function SubscriptionLock({ body, className }: { body?: MessageKey; className?: string }) {
  const access = useApi('llm.access', ['orchestra', 'routes'])
  const { navigate } = useRoute()
  const a = access.data
  if (!a || a.subscription) return null
  const reconnect = a.reconnect.map((r) => r.label).join(' », « ')
  return (
    <div data-testid="subscription-lock" role="note" className={cn('flex flex-wrap items-center justify-between gap-4 rounded-[16px] border border-dashed border-line-3 px-5 py-4', className)}>
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <Lock className="mt-0.5 size-4 shrink-0 text-fg-3" aria-hidden />
        <div className="min-w-0">
          <p className="text-[13.5px] font-medium text-fg">{t('llmAccess.locked.title')}</p>
          <p className="mt-0.5 text-[12.5px] text-fg-3">{t(body ?? 'llmAccess.locked.blurb')}</p>
          {reconnect && (
            <p className="mt-1 text-[12.5px] text-warn" data-testid="subscription-lock-reconnect">
              {t('llmAccess.locked.reconnect', { labels: reconnect })}
            </p>
          )}
        </div>
      </div>
      <Button size="sm" data-testid="subscription-lock-connect" onClick={() => navigate(CLAUDE_SETTINGS_ROUTE)}>
        {t(reconnect ? 'llmAccess.locked.reconnectButton' : 'llmAccess.locked.button')}
      </Button>
    </div>
  )
}
