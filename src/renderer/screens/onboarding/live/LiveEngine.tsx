// Step 2 in real mode: the person's own Claude Code (or Codex) subscription, connected for real (engine-link.ts). The view
// shows exactly what the brain reports — the CLI found or not (with how to install it), the account added, its sign-in, a
// good « Vérifier » — and never claims a connection it did not see. Continuing without a verified account is allowed, with
// an honest warning. The simulated version of this step (steps/Engine.tsx) is only for the presentation mode.
import { AlertTriangle, Bot, Check, Loader2, Plus, PlugZap, Server, Terminal, TerminalSquare } from 'lucide-react'
import { useCallback, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { EventContract } from '../../../../shared/api'
import { t } from '../../../../shared/fr'
import { Button } from '@/components/ui/button'
import { IS_MAC } from '@/lib/platform'
import { onboardingDeps } from '@/proto/live/onboarding-live'
import { call, useEvent } from '@/state/client'
import type { StepProps } from '../model'
import { ChoiceCard, Question, Tag } from '../parts'
import { EngineLink, enginePhase, pendingAccount, verifiedAccount, type CliKind, type EngineLinkState, type EnginePhase } from './engine-link'

const KINDS: { id: CliKind; icon: typeof Terminal }[] = [
  { id: 'claude-code', icon: Terminal },
  { id: 'codex', icon: Bot }
]

const INSTALL: Record<CliKind, string> = { 'claude-code': 'npm i -g @anthropic-ai/claude-code', codex: 'npm install -g @openai/codex' }

export interface EngineViewProps {
  kind: CliKind
  onKind: (k: CliKind) => void
  state: EngineLinkState
  mac: boolean
  onAdd: () => void
  onReopen: (accountId: number) => void
  onCheck: (accountId: number) => void
  onRetryCli: () => void
}

function Command({ text, testId }: { text: string; testId?: string }) {
  return (
    <code data-testid={testId} className="mt-1.5 block rounded-[10px] bg-surface-3 px-3 py-2 font-mono text-[12.5px] break-all text-fg select-all">
      {text}
    </code>
  )
}

function Line({ tone, children, testId, state }: { tone: 'ok' | 'wait' | 'warn' | 'muted'; children: ReactNode; testId?: string; state?: string }) {
  return (
    <p data-testid={testId} data-state={state} className="flex items-start gap-2 text-[13px] leading-[1.5] text-fg-2">
      {tone === 'ok' && <Check className="mt-0.5 size-4 shrink-0 text-ok" aria-hidden />}
      {tone === 'wait' && <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-fg-3" aria-hidden />}
      {tone === 'warn' && <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden />}
      {tone === 'muted' && <span aria-hidden className="mt-[7px] size-2 shrink-0 rounded-full bg-fg-4" />}
      <span className="min-w-0">{children}</span>
    </p>
  )
}

function CliPart({ p, phase }: { p: EngineViewProps; phase: EnginePhase }) {
  const remote = p.state.where?.remote === true
  if (p.kind === 'codex') {
    return (
      <div data-testid="engine-cli" data-state="unknown" className="text-[12.5px] text-fg-3">
        {t('onb.live.engine.codex.install')}
        <Command text={INSTALL.codex} />
      </div>
    )
  }
  const cli = p.state.cli
  if (cli.state === 'loading') return <Line tone="wait" testId="engine-cli" state="loading">{t('onb.live.engine.cli.loading')}</Line>
  if (cli.state === 'found') return <Line tone="ok" testId="engine-cli" state="found">{t('onb.live.engine.cli.found')}</Line>
  return (
    <div className="space-y-2">
      <Line tone="warn" testId="engine-cli" state={cli.state}>
        {t(cli.state === 'missing' ? 'onb.live.engine.cli.missing' : 'onb.live.engine.cli.unknown')}
      </Line>
      {(phase === 'no-cli' || cli.state === 'unknown') && (
        <div data-testid="engine-install" className="rounded-[12px] border border-line-2 bg-surface-2 p-3.5 text-[12.5px] leading-[1.55] text-fg-2">
          <p className="font-medium text-fg">{t('onb.live.engine.install.title')}</p>
          <p className="mt-1">{t('onb.live.engine.install.body')}</p>
          <Command text={INSTALL['claude-code']} testId="engine-install-command" />
          <p className="mt-2 text-fg-3">{t(remote ? 'onb.live.engine.install.remote' : p.mac ? 'onb.live.engine.install.mac' : 'onb.live.engine.install.windows')}</p>
          <Button size="sm" variant="secondary" className="mt-3" data-testid="engine-cli-retry" onClick={p.onRetryCli}>
            {t('onb.live.engine.install.retry')}
          </Button>
        </div>
      )}
    </div>
  )
}

function AccountPart({ p, phase }: { p: EngineViewProps; phase: EnginePhase }) {
  const accounts = p.state.accounts ?? []
  const remote = p.state.where?.remote === true
  const pending = pendingAccount(p.kind, accounts)
  const busy = p.state.busy !== null
  if (phase === 'ready') {
    const ok = verifiedAccount(p.kind, accounts)
    return (
      <Line tone="ok" testId="engine-ready">
        <span className="font-medium text-fg">{t('onb.live.engine.ready')}</span> {ok ? `${ok.label}${ok.checkNote ? ` · ${ok.checkNote}` : ''}` : ''}
      </Line>
    )
  }
  if (phase === 'loading' || phase === 'no-cli') return null
  if (phase === 'add' || !pending) {
    return (
      <div className="space-y-2">
        <Button data-testid="engine-add" disabled={busy} onClick={p.onAdd}>
          <Plus aria-hidden /> {t(`onb.live.engine.add.${p.kind}`)}
        </Button>
        <p className="text-[12.5px] leading-[1.5] text-fg-3">{t('onb.live.engine.add.hint')}</p>
      </div>
    )
  }
  const login = p.state.login && p.state.login.account.id === pending.id ? p.state.login : null
  return (
    <div className="space-y-3" data-testid="engine-login" data-account={pending.id}>
      {phase === 'checking' ? (
        <Line tone="wait">{t('onb.live.engine.checking')}</Line>
      ) : phase === 'failed' ? (
        <Line tone="warn" testId="engine-failed">
          {t('onb.live.engine.failed')} {pending.checkNote ?? ''}
        </Line>
      ) : (
        <Line tone="muted">
          <span className="font-medium text-fg">{t('onb.live.engine.login.title')}</span> · {pending.label}
          <span className="mt-0.5 block text-fg-3">{t(`onb.live.engine.login.${p.kind}`)}</span>
          {pending.checkedAt && pending.checkNote && (
            <span data-testid="engine-check-result" className="mt-0.5 block text-fg-3">
              {pending.checkNote}
            </span>
          )}
        </Line>
      )}
      {login && (remote || !login.launched) && (
        <div className="text-[12.5px] text-fg-3">
          {t(remote ? 'onb.live.engine.command.remote' : 'onb.live.engine.command')}
          <Command text={login.command} testId="engine-command" />
        </div>
      )}
      <p data-testid="engine-check-note" className="text-[12px] leading-[1.5] text-fg-3">
        {t('onb.live.engine.check.note')}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button data-testid="engine-check" disabled={busy} onClick={() => p.onCheck(pending.id)}>
          <PlugZap aria-hidden /> {t('onb.live.engine.check')}
        </Button>
        <Button variant="secondary" data-testid="engine-reopen" disabled={busy} onClick={() => p.onReopen(pending.id)}>
          <TerminalSquare aria-hidden /> {t('onb.live.engine.reopen')}
        </Button>
      </div>
    </div>
  )
}

/** Pure view (rendered in unit tests with a state from a fake `call`). */
export function EngineView(p: EngineViewProps) {
  const phase = enginePhase(p.kind, p.state)
  const where = p.state.where
  return (
    <div>
      <Question title={t('onb.engine.title')} hint={t('onb.engine.hint')} />
      <div role="radiogroup" aria-label={t('onb.engine.title')} className="space-y-3" data-testid="onboarding-engines">
        {KINDS.map(({ id, icon: Icon }) => (
          <ChoiceCard
            key={id}
            testId={`engine-${id}`}
            selected={p.kind === id}
            onSelect={() => p.onKind(id)}
            icon={<Icon className="size-[18px]" aria-hidden />}
            title={t(`onb.engine.${id}`)}
            description={t(`onb.engine.${id}.desc`)}
            badge={id === 'claude-code' ? <Tag tone="ok">{t('onb.engine.recommended')}</Tag> : undefined}
          >
            {p.kind === id && (
              <div className="mx-4 space-y-3 border-t border-line py-3.5" data-testid="engine-live" data-phase={phase} data-kind={id} data-where={where ? (where.remote ? 'remote' : 'local') : 'loading'}>
                {where?.remote && (
                  <Line tone="muted" testId="engine-where">
                    <span className="inline-flex items-center gap-1.5 font-medium text-fg">
                      <Server className="size-3.5" aria-hidden />
                      {t('onb.live.engine.where.remote', { name: where.name ?? '' })}
                    </span>
                    <span className="mt-0.5 block text-fg-3">{t('onb.live.engine.where.remote.hint')}</span>
                  </Line>
                )}
                {phase === 'loading' && !p.state.accounts ? (
                  <Line tone="wait">{t('onb.live.engine.loading')}</Line>
                ) : (
                  <>
                    <CliPart p={p} phase={phase} />
                    <AccountPart p={p} phase={phase} />
                  </>
                )}
                {p.state.error && (
                  <p role="alert" data-testid="engine-error" className="text-[12.5px] text-err">
                    {t('onb.live.failed', { error: p.state.error })}
                  </p>
                )}
              </div>
            )}
          </ChoiceCard>
        ))}
      </div>
      <p className="mt-3 px-1 text-[12.5px] text-fg-3">{t('onb.live.engine.more')}</p>
      {phase !== 'ready' && (
        <div data-testid="engine-warning" className="mt-5 flex items-start gap-2.5 rounded-[14px] border border-line-2 px-4 py-3.5 text-[13px] leading-[1.55] text-fg-2">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden />
          <span>{t('onb.live.engine.warning')}</span>
        </div>
      )}
      <div className="mt-5 rounded-[14px] bg-surface-2 px-4 py-3.5 text-[13px] leading-[1.55] text-fg-2" data-testid="engine-credits-note">
        <span className="font-medium text-fg">{t('onb.engine.credits.title')}</span> {t('onb.engine.credits.body')}
      </div>
    </div>
  )
}

export function LiveEngineStep({ a, set }: StepProps) {
  const [link] = useState(() => new EngineLink(onboardingDeps()?.call ?? call))
  const state = useSyncExternalStore(link.subscribe, link.getState, link.getState)
  useEffect(() => void link.load(), [link])
  const onChanged = useCallback(
    (e: EventContract['atelier:changed']) => {
      if (e.topic === 'orchestra') void link.loadAccounts()
    },
    [link]
  )
  useEvent('atelier:changed', onChanged)
  const kind: CliKind = a.engine === 'codex' ? 'codex' : 'claude-code'
  return (
    <EngineView
      kind={kind}
      onKind={(k) => set({ engine: k })}
      state={state}
      mac={IS_MAC}
      onAdd={() => void link.add(kind)}
      onReopen={(id) => void link.reopen(id)}
      onCheck={(id) => void link.check(id)}
      onRetryCli={() => void link.testCli()}
    />
  )
}
