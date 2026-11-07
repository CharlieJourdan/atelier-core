// The real agent runtime (src/main/orchestra) seen from the app: is the team switched on (live, through the switch of
// power.ts: refused until a Claude account passed « Vérifier »), what runs, which accounts (Claude Code / Codex) are ready
// or limited, and a "run one round now" button. Real data over IPC; in the web demo
// (no main process) the panel says it needs the desktop app.
import { Play, Power } from 'lucide-react'
import { useState } from 'react'
import { t } from '../../../shared/fr'
import type { OrchAccount, OrchStatus } from '../../../shared/api/orchestra'
import { ErrorLine, LoadingBlock } from '@/components/atelier/kit'
import { Panel, StatusDot } from '@/components/atelier/primitives'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/input'
import { toast } from '@/lib/toast'
import { call, errText, useApi } from '@/state/client'
import { stateLabel } from './TeamPower'

function AccountRow({ a }: { a: OrchAccount }) {
  const limited = a.limitedUntil !== null
  return (
    <li className="flex items-center gap-3 py-2 text-[13px]">
      <StatusDot tone={!a.enabled ? 'off' : limited ? 'warn' : 'ok'} />
      <span className="min-w-0 flex-1 truncate text-fg">{a.label}</span>
      <span className="text-[12px] text-fg-3">{a.kind === 'codex' ? 'Codex' : a.kind === 'anthropic' ? 'API' : a.kind === 'relay' ? 'Atelier' : 'Claude Code'}</span>
      <span className="num w-28 text-right text-[12px] text-fg-3">
        {limited ? t('orch.limitedUntil', { time: new Date(a.limitedUntil!).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) }) : t('orch.calls', { n: a.calls })}
      </span>
    </li>
  )
}

export function RealEnginePanel() {
  const status = useApi('orchestra.status', ['orchestra'])
  const accounts = useApi('orchestra.accounts', ['orchestra'])
  const power = useApi('autopilot.power', ['orchestra', 'settings'])
  const [busy, setBusy] = useState(false)
  const on = power.data !== null && power.data.state !== 'off'

  const toggle = async (v: boolean) => {
    try {
      await call('autopilot.setPower', { state: v ? 'on' : 'off' })
      power.reload()
      toast.success(v ? t('orch.on.toast') : t('orch.off.toast'))
    } catch (err) {
      toast.error(errText(err))
    }
  }
  const tick = async () => {
    setBusy(true)
    try {
      const r = await call('orchestra.tick', {})
      toast.success(t('orch.tick.done', { n: r.started }))
      status.reload()
    } catch (err) {
      toast.error(errText(err))
    } finally {
      setBusy(false)
    }
  }

  const s: OrchStatus | null = status.data
  return (
    <Panel title={t('orch.title')} data-testid="real-engine-panel">
      <p className="mb-4 max-w-[64ch] text-[12.5px] text-fg-3">{t('orch.blurb')}</p>
      {status.error ? (
        <ErrorLine message={status.error} onRetry={status.reload} />
      ) : !s ? (
        <LoadingBlock rows={2} />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <label className="flex items-center gap-2.5 text-[13px] text-fg">
              <Switch checked={on} onCheckedChange={(v) => void toggle(v)} aria-label={t('orch.enable')} />
              <Power className="size-4 text-fg-3" aria-hidden />
              {power.data && on ? stateLabel(power.data) : t('orch.disabled')}
            </label>
            <span className="num text-[12.5px] text-fg-3">
              {t('orch.summary', { agents: s.agents, running: s.running, max: s.maxConcurrent, inbox: s.openInbox })}
            </span>
            <Button variant="secondary" size="sm" disabled={busy || power.data?.state !== 'on'} onClick={() => void tick()}>
              <Play aria-hidden /> {t('orch.tick')}
            </Button>
          </div>
          <div>
            <p className="micro-label mb-1">{t('orch.accounts')}</p>
            {accounts.error ? (
              <ErrorLine message={accounts.error} onRetry={accounts.reload} />
            ) : !accounts.data ? (
              <LoadingBlock rows={1} />
            ) : accounts.data.length === 0 ? (
              <p className="text-[13px] text-fg-3">{t('orch.noAccount')}</p>
            ) : (
              <ul className="divide-y divide-line">
                {accounts.data.map((a) => (
                  <AccountRow key={a.id} a={a} />
                ))}
              </ul>
            )}
          </div>
          <p className="text-[12px] text-fg-3">{t('orch.howto')}</p>
        </div>
      )}
    </Panel>
  )
}
