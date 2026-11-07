// Réglages › Claude, « Comptes de l'équipe d'agents »: « Ajouter mon compte Claude Code / Codex » makes the account's own
// folder and opens a terminal where the user signs in himself (Atelier never sees a token); « Vérifier » asks Haiku one tiny
// question through that account's CLI — announced first, since it uses the user's subscription. Real data over IPC.
import { PlugZap, Plus, TerminalSquare } from 'lucide-react'
import { useState } from 'react'
import type { OrchAccount, OrchAccountLogin } from '../../../shared/api/orchestra'
import { t, type MessageKey } from '../../../shared/fr'
import { useConfirm } from '@/components/atelier/confirm'
import { ErrorLine, LoadingBlock } from '@/components/atelier/kit'
import { Panel, StatusDot, type Tone } from '@/components/atelier/primitives'
import { Button } from '@/components/ui/button'
import { toast } from '@/lib/toast'
import { call, errText, useApi } from '@/state/client'

const TONE: Record<OrchAccount['state'], Tone> = { ready: 'ok', login: 'warn', checking: 'info', failed: 'err' }

export function CliAccountsPanel() {
  const accounts = useApi('orchestra.accounts', ['orchestra'])
  const confirm = useConfirm()
  const [login, setLogin] = useState<OrchAccountLogin | null>(null)
  const [busy, setBusy] = useState<number | 'add' | null>(null)
  const fail = (e: unknown): void => void toast.error(errText(e))
  const add = (kind: 'claude-code' | 'codex'): void => {
    setBusy('add')
    call('orchestra.addCliAccount', { kind })
      .then((r) => {
        setLogin(r)
        accounts.reload()
      }, fail)
      .finally(() => setBusy(null))
  }
  const check = (a: OrchAccount): void => {
    void confirm({ title: `${t('orch.acct.check')} : ${a.label}`, description: t('orch.acct.check.confirm'), confirmLabel: t('orch.acct.check') }).then((ok) => {
      if (!ok) return
      setBusy(a.id)
      call('orchestra.checkAccount', a.id)
        .then((r) => {
          if (r.state === 'ready') toast.success(r.checkNote ?? t('orch.acct.state.ready'))
          else toast.error(r.checkNote ?? t(`orch.acct.state.${r.state}` as MessageKey))
          accounts.reload()
        }, fail)
        .finally(() => setBusy(null))
    })
  }
  const reopen = (a: OrchAccount): void => {
    call('orchestra.openLogin', a.id).then(setLogin, fail)
  }
  const cli = (accounts.data ?? []).filter((a) => a.kind === 'claude-code' || a.kind === 'codex')
  return (
    <Panel
      title={t('orch.acct.title')}
      data-testid="cli-accounts"
      action={
        <div className="flex gap-2">
          <Button size="sm" disabled={busy === 'add'} onClick={() => add('claude-code')}>
            <Plus aria-hidden /> {t('orch.acct.addClaude')}
          </Button>
          <Button size="sm" variant="secondary" disabled={busy === 'add'} onClick={() => add('codex')}>
            <Plus aria-hidden /> {t('orch.acct.addCodex')}
          </Button>
        </div>
      }
    >
      <p className="mb-3 text-[12px] text-fg-3">{t('orch.acct.hint')}</p>
      {login && (
        <div className="mb-3 rounded-[12px] border border-line-2 bg-surface-2 p-3 text-[12.5px] text-fg-2" data-testid="cli-login">
          <p>{login.note}</p>
          {!login.launched && (
            <>
              <p className="mt-2 text-fg-3">{t('orch.acct.command')}</p>
              <code className="mt-1 block rounded-[8px] bg-surface-3 px-2 py-1 font-mono text-[12px] break-all select-all">{login.command}</code>
            </>
          )}
        </div>
      )}
      {accounts.error ? (
        <ErrorLine message={accounts.error} onRetry={accounts.reload} />
      ) : !accounts.data ? (
        <LoadingBlock rows={2} />
      ) : cli.length === 0 ? (
        <p className="text-[13px] text-fg-3">{t('orch.acct.empty')}</p>
      ) : (
        <ul className="divide-y divide-line">
          {cli.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-3 py-2.5 text-[13px]" data-account={a.id} data-state={a.state} data-reconnect={a.reconnect ? 'true' : undefined}>
              <StatusDot tone={a.reconnect ? 'err' : TONE[a.state]} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-fg">{a.label}</p>
                <p className="truncate text-[11.5px] text-fg-3">
                  {a.reconnect ? t('llmAccess.account.reconnect') : t(`orch.acct.state.${a.state}` as MessageKey)}
                  {a.checkNote ? ` · ${a.checkNote}` : ''}
                  {a.configDir ? ` · ${a.configDir}` : ` · ${t('orch.acct.default')}`}
                </p>
              </div>
              {a.configDir && (
                <Button size="sm" variant={a.reconnect ? 'default' : 'ghost'} data-testid={a.reconnect ? 'cli-account-reconnect' : undefined} onClick={() => reopen(a)}>
                  <TerminalSquare aria-hidden /> {t(a.reconnect ? 'llmAccess.locked.reconnectButton' : 'orch.acct.reopen')}
                </Button>
              )}
              <Button size="sm" variant="outline" disabled={busy === a.id} onClick={() => check(a)}>
                <PlugZap aria-hidden /> {t('orch.acct.check')}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}
