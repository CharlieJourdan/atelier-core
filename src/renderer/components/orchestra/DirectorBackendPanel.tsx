// Réglages › Claude, « Le réalisateur »: the beta rule (decision 0038) lets the director's pass of a run (scenes, cuts,
// editing) run on the user's Claude subscription or on the Anthropic API key (paid per token, in the run quote). The
// default is the subscription when one works. The agents and script writing stay on the subscription. Real data over IPC.
import { t } from '../../../shared/fr'
import type { DirectorBackend } from '../../../shared/api'
import { ErrorLine, LoadingBlock } from '@/components/atelier/kit'
import { Panel } from '@/components/atelier/primitives'
import { Button } from '@/components/ui/button'
import { toast } from '@/lib/toast'
import { call, errText, useApi } from '@/state/client'

export function DirectorBackendPanel() {
  const access = useApi('llm.access', ['orchestra', 'routes', 'providers'])
  const pick = (b: DirectorBackend): void => {
    call('llm.setDirectorBackend', b).then(access.reload, (e: unknown) => void toast.error(errText(e)))
  }
  const d = access.data?.director
  const current = d?.choice ?? d?.effective ?? null
  return (
    <Panel title={t('llmAccess.director.title')} data-testid="director-backend">
      <p className="mb-3 text-[12px] text-fg-3">{t('llmAccess.director.blurb')}</p>
      {access.error ? (
        <ErrorLine message={access.error} onRetry={access.reload} />
      ) : !d ? (
        <LoadingBlock rows={1} />
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant={current === 'subscription' ? 'default' : 'outline'} data-testid="director-subscription" aria-pressed={current === 'subscription'} onClick={() => pick('subscription')}>
              {t('llmAccess.director.subscription')}
            </Button>
            <Button size="sm" variant={current === 'api' ? 'default' : 'outline'} data-testid="director-api" aria-pressed={current === 'api'} disabled={!d.apiKeySet} onClick={() => pick('api')}>
              {t('llmAccess.director.api')}
            </Button>
          </div>
          <p className="mt-2 text-[12px] text-fg-3" data-testid="director-effective">
            {t(d.effective === 'subscription' ? 'llmAccess.director.effective.subscription' : d.effective === 'api' ? 'llmAccess.director.effective.api' : 'llmAccess.director.effective.none')}
            {!d.apiKeySet ? ` ${t('llmAccess.director.noKey')}` : ''}
          </p>
        </>
      )}
    </Panel>
  )
}
