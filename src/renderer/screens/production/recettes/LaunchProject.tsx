// Launching a project (production-16): « Moteur réel (bêta) », off by default and explained in one line, with the quote
// shown before anything is spent. On, the paid bricks go through Atelier Cloud (its prices, its wallet); off, a demo run
// that sends nothing to paid providers. The switch is greyed out, with the reason, while the app is not signed in.
import { useState } from 'react'
import { t } from '../../../../shared/fr'
import type { ProjectSummary } from '../../../../shared/recipes'
import { ErrorLine } from '@/components/atelier/kit'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/input'
import { toast } from '@/lib/toast'
import { call, errText, useLoader } from '@/state/client'

export function LaunchProject({ project, onDone, onClose }: { project: ProjectSummary; onDone: () => void; onClose: () => void }) {
  const [real, setReal] = useState(false)
  const [busy, setBusy] = useState(false)
  const quote = useLoader(() => call('projects.quote', project.id, real ? { real: true } : {}), `${project.id}:${String(real)}`, ['cloud', 'credits'])
  const q = quote.data
  const mode = q ? q.modes[q.budgetMode ?? 'usage_max'] : null
  const available = q?.real.available ?? false
  const launch = async (): Promise<void> => {
    setBusy(true)
    try {
      await call('projects.run', project.id, real ? { real: true } : {})
      toast.success(t('projects.running'))
      onDone()
    } catch (e) {
      toast.error(errText(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="flex w-full flex-col gap-2 rounded-field border border-line bg-surface-1 px-3 py-2.5" data-testid={`launch-${project.id}`}>
      <label className="flex items-center gap-2 text-[12.5px] font-medium text-fg">
        <Switch checked={real} onCheckedChange={setReal} disabled={!available && !real} aria-label={t('runs.real.label')} data-testid="real-switch" />
        {t('runs.real.label')}
      </label>
      <p className="m-0 text-[12px] text-fg-3" data-testid="real-line">
        {q && !available ? q.real.reason : t(real ? 'runs.real.hint' : 'runs.real.off')}
      </p>
      {quote.error && <ErrorLine message={quote.error} onRetry={quote.reload} />}
      {q && mode && (
        <p className="m-0 text-[12.5px] text-fg-2 tabular-nums" data-testid="launch-quote">
          {real
            ? t('runs.real.quote', { credits: mode.totalCredits, eur: mode.totalEur.toFixed(2).replace('.', ','), available: q.balance.available })
            : t('runs.real.demoQuote', { credits: mode.totalCredits })}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="secondary" onClick={onClose} disabled={busy}>
          {t('common.cancel')}
        </Button>
        <Button size="sm" variant={real ? 'brand' : 'default'} disabled={busy || !q || (real && !available)} onClick={() => void launch()} data-testid={`project-launch-${project.id}`}>
          {t(real ? 'runs.real.launch' : 'projects.run')}
        </Button>
      </div>
    </div>
  )
}
