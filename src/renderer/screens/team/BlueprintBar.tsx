// Équipe, real mode: « Version publiée N » (the blueprint the founder published to Atelier Cloud) and « Appliquer la version N ».
// Existing agents keep their own settings; the button opens the list of what would change, per agent, and only the agents
// the user leaves ticked are changed (the ones edited by hand start unticked).
import { Check } from 'lucide-react'
import { useEffect, useState } from 'react'
import { t, type MessageKey } from '../../../shared/fr'
import type { BlueprintAgentChange, BlueprintPlan } from '../../../shared/blueprint'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'
import { liveDriver } from '@/proto/live/registry'
import { useProto } from '@/proto/store'

const tierName = (tier: string | null): string => t(`team.blueprint.tier.${tier ?? 'default'}` as MessageKey)

function ChangeRow({ change, on, onToggle }: { change: BlueprintAgentChange; on: boolean; onToggle: () => void }) {
  return (
    <li className="rounded-[10px] border border-line px-3.5 py-3" data-testid={`blueprint-change-${change.agentId}`}>
      <label className="flex cursor-pointer items-start gap-3">
        <input type="checkbox" checked={on} onChange={onToggle} className="peer sr-only" data-testid={`blueprint-pick-${change.agentId}`} />
        <span aria-hidden className={cn('mt-0.5 grid size-4 shrink-0 place-items-center rounded-[5px] border border-line-3 peer-focus-visible:outline-2 peer-focus-visible:outline-ring', on && 'border-transparent bg-fg text-bg')}>
          {on && <Check className="size-3" strokeWidth={3} />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] font-medium text-fg">{change.name}</span>
            {change.handEdited && <span className="rounded-full bg-hover px-2 py-0.5 text-[11px] text-fg-2">{t('team.blueprint.edited')}</span>}
          </span>
          {change.tier && (
            <span className="mt-1 block text-[12.5px] text-fg-3">
              {t('team.blueprint.model')} : {tierName(change.tier.from)} → <span className="text-fg-2">{tierName(change.tier.to)}</span>
            </span>
          )}
          {change.routines && (
            <span className="mt-1 block text-[12.5px] text-fg-3">
              {t('team.blueprint.routines')} : <span className="text-fg-2">{change.routines.join(' · ')}</span>
            </span>
          )}
          {change.instructions && (
            <details className="mt-1 text-[12.5px] text-fg-3" onClick={(e) => e.stopPropagation()}>
              <summary className="cursor-pointer">{t('team.blueprint.instructions')}</summary>
              <div className="mt-1.5 grid gap-2 sm:grid-cols-2">
                <div>
                  <p className="mb-0.5 text-[11px] uppercase tracking-wide text-fg-4">{t('team.blueprint.before')}</p>
                  <p className="max-h-32 overflow-y-auto whitespace-pre-wrap leading-[1.45]">{change.instructions.from}</p>
                </div>
                <div>
                  <p className="mb-0.5 text-[11px] uppercase tracking-wide text-fg-4">{t('team.blueprint.after')}</p>
                  <p className="max-h-32 overflow-y-auto whitespace-pre-wrap leading-[1.45] text-fg-2">{change.instructions.to}</p>
                </div>
              </div>
            </details>
          )}
        </span>
      </label>
    </li>
  )
}

function ApplyDialog({ open, onOpenChange, plan, onApplied }: { open: boolean; onOpenChange: (o: boolean) => void; plan: BlueprintPlan; onApplied: () => void }) {
  const [picked, setPicked] = useState<Set<number>>(() => new Set(plan.changes.filter((c) => !c.handEdited).map((c) => c.agentId)))
  const [busy, setBusy] = useState(false)
  const version = plan.version ?? 0
  const toggle = (id: number): void =>
    setPicked((cur) => {
      const next = new Set(cur)
      if (!next.delete(id)) next.add(id)
      return next
    })
  const apply = async (): Promise<void> => {
    const driver = liveDriver()?.blueprint
    if (!driver) return
    setBusy(true)
    try {
      const r = await driver.apply(version, [...picked])
      toast.success(t('team.blueprint.done', { n: r.applied, version: r.version }))
      onOpenChange(false)
      onApplied()
    } catch (err) {
      toast.error(t('team.blueprint.failed', { message: err instanceof Error ? err.message : String(err) }))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="blueprint-apply-dialog" className="w-[min(640px,94vw)] gap-0 p-0" closeLabel={t('common.close')}>
        <DialogHeader className="px-6 pt-6 pb-4">
          <DialogTitle className="text-[18px] font-semibold tracking-[-0.02em]">{t('team.blueprint.title', { version })}</DialogTitle>
          <DialogDescription>{t('team.blueprint.blurb')}</DialogDescription>
        </DialogHeader>
        <ul className="m-0 flex max-h-[420px] list-none flex-col gap-2 overflow-y-auto border-t border-line p-4">
          {plan.changes.map((c) => (
            <ChangeRow key={c.agentId} change={c} on={picked.has(c.agentId)} onToggle={() => toggle(c.agentId)} />
          ))}
        </ul>
        <DialogFooter className="justify-end border-t border-line px-6 py-4">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button data-testid="blueprint-apply-confirm" disabled={busy || picked.size === 0} onClick={() => void apply()}>
            {t('team.blueprint.confirm', { n: picked.size })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function BlueprintBar() {
  const { mode, liveBlueprint, live } = useProto()
  const driver = liveDriver()?.blueprint
  const version = liveBlueprint?.state === 'ok' ? liveBlueprint.version : null
  const [plan, setPlan] = useState<BlueprintPlan | null>(null)
  const [open, setOpen] = useState(false)
  const [round, setRound] = useState(0)

  // the plan follows the team: any change of an agent (a snapshot) recomputes what is different from the version
  useEffect(() => {
    if (mode !== 'live' || version === null || !driver) return
    let current = true
    driver
      .plan()
      .then((p) => current && setPlan(p))
      .catch(() => current && setPlan(null))
    return () => {
      current = false
    }
  }, [mode, version, driver, live.syncedAt, round])

  if (mode !== 'live' || version === null || !liveBlueprint) return null
  const changes = plan && plan.version === version ? plan.changes.length : 0
  return (
    <div className="mb-6 flex flex-wrap items-center gap-3 rounded-[12px] border border-line px-4 py-3" data-testid="blueprint-bar">
      <span className="text-[13px] font-medium text-fg" data-testid="blueprint-version">
        {t('team.blueprint.badge', { version })}
      </span>
      {liveBlueprint.stale && <span className="text-[12px] text-fg-3">{t('team.blueprint.stale')}</span>}
      <span className="flex-1" />
      {plan && changes === 0 ? (
        <span className="text-[12.5px] text-fg-3">{t('team.blueprint.upToDate', { version })}</span>
      ) : plan ? (
        <Button size="sm" variant="secondary" data-testid="blueprint-apply" onClick={() => setOpen(true)}>
          {t('team.blueprint.apply', { version })}
        </Button>
      ) : null}
      {plan && changes > 0 && open && <ApplyDialog key={`${plan.version}-${round}`} open={open} onOpenChange={setOpen} plan={plan} onApplied={() => setRound((r) => r + 1)} />}
    </div>
  )
}
