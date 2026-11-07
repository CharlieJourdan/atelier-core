// Charlie's « Toujours valider » rules of a channel (docs/AGENT-RUNTIME.md §27), under its « Objectifs et validations »: each
// rule says which questions the team no longer asks him (a gate, maybe one series, maybe a number of times), how often it
// served, and « Retirer » gives those questions back to him. Rules are made from a question, in the app or on Discord.
import { useState } from 'react'
import { t, type MessageKey } from '../../../shared/fr'
import type { AllowRule } from '../../../shared/api/autopilot'
import { ErrorLine } from '@/components/atelier/kit'
import { Button } from '@/components/ui/button'
import { toast } from '@/lib/toast'
import { call, errText, useLoader } from '@/state/client'

function ruleText(r: AllowRule): string {
  const parts = [t(`goals.gate.${r.gate}` as MessageKey)]
  if (r.series) parts.push(t('goals.rule.series', { series: r.series }))
  if (r.maxUses) parts.push(t('goals.rule.left', { n: r.maxUses - r.uses }))
  return parts.join(' · ')
}

export function AllowRules({ channelId }: { channelId: number }) {
  const rules = useLoader(() => call('autopilot.rules', channelId), `rules-${channelId}`, ['orchestra'])
  const [busy, setBusy] = useState<number | null>(null)
  const revoke = async (id: number) => {
    setBusy(id)
    try {
      await call('autopilot.revokeRule', id)
      rules.reload()
      toast.success(t('goals.rule.revoked'))
    } catch (err) {
      toast.error(errText(err))
    } finally {
      setBusy(null)
    }
  }
  if (rules.error) return <ErrorLine message={rules.error} onRetry={rules.reload} />
  const list = rules.data ?? []
  return (
    <div className="grid gap-1 py-2 sm:grid-cols-[150px_1fr] sm:gap-4" data-testid="channel-rules">
      <span className="micro-label pt-0.5">{t('goals.rules')}</span>
      {list.length === 0 ? (
        <p className="text-[13px] text-fg-3">{t('goals.rules.none')}</p>
      ) : (
        <ul className="grid gap-1.5">
          {list.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]" data-testid="channel-rule">
              <span className="text-fg">{ruleText(r)}</span>
              <span className="num text-[12px] text-fg-3">{t('goals.rule.uses', { n: r.uses })}</span>
              <Button size="sm" variant="ghost" disabled={busy === r.id} onClick={() => void revoke(r.id)}>
                {t('goals.rule.revoke')}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
