// The agent sheet's real-mode panels (Équipe › fiche d'un agent): its « Technologies » (the tools it may call, editable,
// with its model tier) and « Ce que l'agent sait » (the exact sections its next turn reads, read-only, secrets removed).
// Both talk to the runtime over IPC (orchestra.*); in the web demo there is no runtime and they say so.
import { RotateCcw } from 'lucide-react'
import type * as React from 'react'
import { useState } from 'react'
import type { OrchTechnology } from '../../../shared/api/orchestra'
import { t, type MessageKey } from '../../../shared/fr'
import { ErrorLine, LoadingBlock } from '@/components/atelier/kit'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/input'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'
import { call, errText, useLoader } from '@/state/client'

const GROUPS: OrchTechnology['group'][] = ['team', 'memory', 'eyes', 'research', 'script', 'packaging', 'production', 'qc']

function Title({ children, hint }: { children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="mb-2">
      <h3 className="text-[13px] font-semibold tracking-[-0.01em] text-fg">{children}</h3>
      {hint && <p className="mt-0.5 text-[12px] text-fg-3">{hint}</p>}
    </div>
  )
}

export function AgentTechnologies({ liveId }: { liveId: number }) {
  const data = useLoader(
    async () => {
      const [catalogue, agents] = await Promise.all([call('orchestra.technologies'), call('orchestra.agents')])
      return { catalogue, agent: agents.find((a) => a.id === liveId) ?? null }
    },
    `tech-${liveId}`,
    ['orchestra']
  )
  const [busy, setBusy] = useState(false)
  if (data.error) return <ErrorLine message={data.error} onRetry={data.reload} />
  if (!data.data) return <LoadingBlock rows={3} />
  const { catalogue, agent } = data.data
  if (!agent) return null
  const save = (technologies: string[] | null): void => {
    setBusy(true)
    call('orchestra.updateAgent', liveId, { technologies })
      .then(() => {
        toast.success(t('team.sheet.tech.saved'))
        data.reload()
      }, (e: unknown) => toast.error(errText(e)))
      .finally(() => setBusy(false))
  }
  const has = new Set(agent.technologies)
  const toggle = (id: string, on: boolean): void => save(catalogue.map((c) => c.id).filter((x) => (x === id ? on : has.has(x))))
  return (
    <section data-testid="agent-technologies">
      <Title hint={t('team.sheet.tech.hint')}>
        <span className="flex items-center gap-2">
          {t('team.sheet.tech')}
          {agent.technologiesCustom && <Badge variant="outline">{t('team.sheet.tech.custom')}</Badge>}
        </span>
      </Title>
      <p className="mb-2 text-[12.5px] text-fg-2" data-testid="agent-tier">
        {t('team.sheet.tier')} : <span className="font-medium text-fg">{t(`team.sheet.tier.${agent.tier}` as MessageKey)}</span>
      </p>
      <div className="flex flex-col gap-3">
        {GROUPS.map((g) => {
          const items = catalogue.filter((c) => c.group === g)
          if (!items.length) return null
          return (
            <div key={g}>
              <p className="mb-1 text-[11.5px] font-medium tracking-wide text-fg-3 uppercase">{t(`tech.group.${g}` as MessageKey)}</p>
              <ul className="divide-y divide-line rounded-[12px] border border-line-2">
                {items.map((c) => (
                  <li key={c.id} className="flex items-center gap-3 px-3.5 py-2" data-tech={c.id} data-on={has.has(c.id)}>
                    <div className="min-w-0 flex-1">
                      <p className={cn('text-[13px]', has.has(c.id) ? 'text-fg' : 'text-fg-3')}>{t(`tech.${c.id}` as MessageKey)}</p>
                      <p className="text-[11.5px] text-fg-4">
                        <code>{c.tool}</code>
                        {c.spends && ` · ${t('team.sheet.tech.spends')}`}
                      </p>
                    </div>
                    <Switch checked={has.has(c.id)} disabled={busy} onCheckedChange={(v) => toggle(c.id, v)} aria-label={t(`tech.${c.id}` as MessageKey)} />
                  </li>
                ))}
              </ul>
            </div>
          )
        })}
      </div>
      {agent.technologiesCustom && (
        <Button size="sm" variant="ghost" className="mt-2" disabled={busy} onClick={() => save(null)}>
          <RotateCcw aria-hidden /> {t('team.sheet.tech.reset')}
        </Button>
      )}
    </section>
  )
}

export function AgentKnows({ liveId }: { liveId: number }) {
  const ctx = useLoader(() => call('orchestra.agentContext', liveId), `knows-${liveId}`, ['orchestra'])
  if (ctx.error) return <ErrorLine message={ctx.error} onRetry={ctx.reload} />
  if (!ctx.data) return <LoadingBlock rows={4} />
  const c = ctx.data
  return (
    <section data-testid="agent-knows">
      <Title hint={t('team.sheet.knows.hint')}>{t('team.sheet.knows')}</Title>
      {c.resumed && <p className="mb-2 rounded-[10px] bg-surface-2 px-3 py-2 text-[12px] text-fg-2">{t('team.sheet.knows.resumed')}</p>}
      <p className="num mb-3 text-[12px] text-fg-3">{t('team.sheet.knows.total', { n: c.totalTokens, session: c.sessionTokens, max: c.compactAtTokens })}</p>
      <ol className="flex flex-col gap-3">
        {c.sections.map((s) => (
          <li key={s.id} data-section={s.id} className="rounded-[12px] border border-line-2">
            <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-1.5">
              <span className="text-[12.5px] font-medium text-fg">{t(`team.sheet.knows.section.${s.id}` as MessageKey)}</span>
              <span className="num text-[11.5px] text-fg-3">
                {t('team.sheet.knows.tokens', { n: s.tokens, max: s.budget })}
                {s.truncated && ` · ${t('team.sheet.knows.cut')}`}
              </span>
            </div>
            <pre className="max-h-56 overflow-auto px-3 py-2 font-mono text-[11.5px] leading-[1.5] whitespace-pre-wrap text-fg-2">{s.text || t('team.sheet.knows.empty')}</pre>
          </li>
        ))}
      </ol>
    </section>
  )
}

