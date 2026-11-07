// The team's switch (docs/AGENT-RUNTIME.md §25), on top of Équipe: its state (off, working, paused until a time, waiting
// for Claude), switch on / off, pause 1 h or until tomorrow 8 am, resume, and the red « Tout arrêter ». Real mode only
// (IPC); when the app is linked to a team computer, these calls are answered there, so it is that computer's team.
import { OctagonX, Pause, Play, Power } from 'lucide-react'
import { useState } from 'react'
import { t, type MessageKey } from '../../../shared/fr'
import type { PowerInput, PowerState, PowerView } from '../../../shared/api/autopilot'
import { useConfirm } from '@/components/atelier/confirm'
import { StatusDot, type Tone } from '@/components/atelier/primitives'
import { Button } from '@/components/ui/button'
import { toast } from '@/lib/toast'
import { call, errText, useApi } from '@/state/client'

const TONE: Record<PowerState, Tone> = { off: 'off', on: 'ok', paused: 'warn', blocked: 'err' }
const hhmm = (iso: string): string => new Date(iso).toLocaleString('fr-FR', { weekday: 'short', hour: '2-digit', minute: '2-digit' })

/** Tomorrow at 8:00, local time. */
function tomorrowAt8(): string {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  d.setHours(8, 0, 0, 0)
  return d.toISOString()
}

export function stateLabel(p: PowerView): string {
  return p.state === 'paused' && p.pausedUntil ? t('auto.state.paused', { time: hhmm(p.pausedUntil) }) : t(`auto.state.${p.state}` as MessageKey)
}

export function TeamPower() {
  const power = useApi('autopilot.power', ['orchestra', 'settings'])
  const confirm = useConfirm()
  const [busy, setBusy] = useState(false)
  const p = power.data

  const set = async (input: PowerInput, done: MessageKey) => {
    setBusy(true)
    try {
      await call('autopilot.setPower', input)
      power.reload()
      toast.success(t(done))
    } catch (err) {
      toast.error(errText(err))
    } finally {
      setBusy(false)
    }
  }
  const stop = async () => {
    if (!(await confirm({ title: t('auto.stop'), description: t('auto.stop.confirm'), confirmLabel: t('auto.stop'), danger: true }))) return
    setBusy(true)
    try {
      const r = await call('autopilot.stop')
      power.reload()
      toast.success(t('auto.stop.done', { n: r.killed, runs: r.runsStopped }))
    } catch (err) {
      toast.error(errText(err))
    } finally {
      setBusy(false)
    }
  }

  if (!p) return null
  const enabled = p.state !== 'off'
  return (
    <section data-testid="team-power" data-state={p.state} className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-3 rounded-card border border-line bg-surface-1 px-4 py-3">
      <div className="flex min-w-[220px] flex-1 items-center gap-3">
        <StatusDot tone={TONE[p.state]} pulse={p.state === 'on'} />
        <div className="min-w-0">
          <p className="text-[14px] font-medium text-fg">
            {t('auto.title')} · <span data-testid="team-power-state">{stateLabel(p)}</span>
          </p>
          <p className="text-[12px] text-fg-3">{t(`auto.hint.${p.state}` as MessageKey)}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {!enabled || p.state === 'blocked' ? (
          <Button size="sm" data-testid="team-power-on" disabled={busy || !p.claudeConnected} onClick={() => void set({ state: 'on' }, 'auto.toast.on')}>
            <Power aria-hidden /> {t('auto.on')}
          </Button>
        ) : p.state === 'paused' ? (
          <Button size="sm" data-testid="team-power-resume" disabled={busy} onClick={() => void set({ state: 'on' }, 'auto.toast.on')}>
            <Play aria-hidden /> {t('auto.resume')}
          </Button>
        ) : (
          <>
            <Button size="sm" variant="secondary" data-testid="team-power-pause" disabled={busy} onClick={() => void set({ state: 'paused', until: new Date(Date.now() + 3_600_000).toISOString() }, 'auto.toast.paused')}>
              <Pause aria-hidden /> {t('auto.pause1h')}
            </Button>
            <Button size="sm" variant="secondary" data-testid="team-power-pause-tomorrow" disabled={busy} onClick={() => void set({ state: 'paused', until: tomorrowAt8() }, 'auto.toast.paused')}>
              {t('auto.pauseTomorrow')}
            </Button>
          </>
        )}
        {enabled && (
          <Button size="sm" variant="ghost" data-testid="team-power-off" disabled={busy} onClick={() => void set({ state: 'off' }, 'auto.toast.off')}>
            {t('auto.off')}
          </Button>
        )}
        <Button size="sm" variant="destructive" data-testid="team-power-stop" disabled={busy} onClick={() => void stop()}>
          <OctagonX aria-hidden /> {t('auto.stop')}
        </Button>
      </div>
    </section>
  )
}
