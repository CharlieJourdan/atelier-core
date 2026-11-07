// The daily digest and the weekly report in « Activité » (docs/AGENT-RUNTIME.md §27): what shipped, what is late and why,
// what waits for Charlie's decision and what the team spent — the same numbers the bot posts in #atlas, computed from the
// real state (orchestra/reports.ts). Refetched on every runtime event (topic `orchestra`).
import { useState } from 'react'
import { t, type MessageKey } from '../../../shared/fr'
import type { ReportKind, TeamReport } from '../../../shared/api/autopilot'
import { ErrorLine, LoadingBlock } from '@/components/atelier/kit'
import { Panel } from '@/components/atelier/primitives'
import { Button } from '@/components/ui/button'
import { call, useLoader } from '@/state/client'

const when = (iso: string): string => new Date(iso).toLocaleString('fr-FR', { weekday: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
const usd = (v: number): string => v.toFixed(2).replace('.', ',')

function Block({ title, empty, items }: { title: string; empty: string; items: string[] }) {
  return (
    <div>
      <p className="micro-label mb-1">
        {title} <span className="num text-fg-3">· {items.length}</span>
      </p>
      {items.length === 0 ? (
        <p className="text-[13px] text-fg-3">{empty}</p>
      ) : (
        <ul className="grid gap-1 text-[13px] text-fg-2">
          {items.slice(0, 8).map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function ReportPanel() {
  const [kind, setKind] = useState<ReportKind>('daily')
  const report = useLoader(() => call('autopilot.report', kind), `report-${kind}`, ['orchestra'])
  const r: TeamReport | null = report.data
  return (
    <Panel title={t('auto.report.title')} className="lg:col-span-2" data-testid="activity-report">
      <div className="mb-3 flex gap-2" role="tablist">
        {(['daily', 'weekly'] as const).map((k) => (
          <Button key={k} size="sm" variant={k === kind ? 'secondary' : 'ghost'} role="tab" aria-selected={k === kind} onClick={() => setKind(k)} data-testid={`report-${k}`}>
            {t(`auto.report.${k}` as MessageKey)}
          </Button>
        ))}
      </div>
      {report.error ? (
        <ErrorLine message={report.error} onRetry={report.reload} />
      ) : !r ? (
        <LoadingBlock rows={3} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <Block
            title={t('auto.report.shipped')}
            empty={t('auto.report.none')}
            items={r.shipped.map((s) => `${s.channelName} — ${s.title} (${s.state === 'ready' ? t('auto.report.ready', { at: when(s.at) }) : t('auto.report.published')})`)}
          />
          <Block title={t('auto.report.late')} empty={t('auto.report.none')} items={r.late.map((l) => `${l.channelName} · ${when(l.slotAt)} — ${l.text}`)} />
          <Block
            title={t('auto.report.decisions')}
            empty={t('auto.report.none')}
            items={r.decisions.map((d) => `${d.channelName ? `${d.channelName} — ` : ''}${d.title} · ${t('auto.report.waitingFor', { h: d.hours })}`)}
          />
          <div>
            <p className="micro-label mb-1">{t('auto.report.spend')}</p>
            <p className="num text-[13px] text-fg-2" data-testid="report-spend">
              {t('auto.report.spend.line', { usd: usd(r.spend.usd), calls: r.spend.calls, month: usd(r.spend.monthUsd) })}
            </p>
            <p className="mt-2 text-[13px] text-fg-3">
              {t('auto.report.tasks', { done: r.tasks.done, stopped: r.tasks.stopped })}
              {r.autoApproved.level + r.autoApproved.rules > 0 && ` · ${t('auto.report.auto', { n: r.autoApproved.level + r.autoApproved.rules, rules: r.autoApproved.rules })}`}
            </p>
          </div>
        </div>
      )}
    </Panel>
  )
}
