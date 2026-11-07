// Mes outils › permissions (granted one by one) and secrets (by NAME: « défini » / « non défini »). A secret value is
// written once and never shown back.
import { KeyRound } from 'lucide-react'
import { useState } from 'react'
import { t } from '../../../shared/fr'
import type { ToolDetail } from '../../../shared/tools'
import { Panel } from '@/components/atelier/primitives'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input, Switch } from '@/components/ui/input'
import { call } from '@/state/client'
import { permissionLabel } from './common'

export type Act = (run: () => Promise<unknown>, success?: string) => Promise<boolean>

export function PermissionsPanel({ tool, act }: { tool: ToolDetail; act: Act }) {
  const perms = tool.permissions
  return (
    <Panel title={t('tools.perms.title')}>
      <p className="mb-3 text-[12.5px] text-fg-3">{t('tools.perms.hint')}</p>
      {perms.length === 0 ? (
        <p className="text-[13px] text-fg-3">{t('tools.perms.none')}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col divide-y divide-line p-0" data-testid="tool-permissions">
          {perms.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-4 py-2.5">
              <span className="text-[13px] text-fg-2">{permissionLabel(p)}</span>
              <Switch checked={p.granted} aria-label={permissionLabel(p)} onCheckedChange={(v) => void act(() => call('tools.setPermission', tool.slug, p.id, v))} />
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

function SecretRow({ slug, name, set, act }: { slug: string; name: string; set: boolean; act: Act }) {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const save = async (): Promise<void> => {
    setBusy(true)
    const ok = await act(() => call('tools.setSecret', slug, name, value), t('tools.secrets.saved', { name }))
    if (ok) setValue('')
    setBusy(false)
  }
  return (
    <li className="flex flex-col gap-2 py-3" data-testid="secret-row" data-secret={name} data-set={set}>
      <div className="flex items-center gap-3">
        <KeyRound className="size-3.5 text-fg-3" aria-hidden />
        <code className="font-mono text-[12.5px] text-fg">{name}</code>
        <Badge variant={set ? 'ok' : 'warn'}>{set ? t('tools.secrets.set') : t('tools.secrets.notSet')}</Badge>
        {set && (
          <Button type="button" variant="ghost" size="sm" className="ml-auto" onClick={() => void act(() => call('tools.clearSecret', slug, name), t('tools.secrets.cleared', { name }))}>
            {t('tools.secrets.clear')}
          </Button>
        )}
      </div>
      <form
        className="flex items-center gap-2"
        autoComplete="off"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <Input
          type="password"
          autoComplete="off"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-label={t('tools.secrets.value', { name })}
          placeholder={set ? t('tools.secrets.replace') : t('tools.secrets.type')}
          className="h-8 max-w-xs"
        />
        <Button type="submit" variant="secondary" size="sm" disabled={busy || value.trim() === ''}>
          {t('tools.secrets.save')}
        </Button>
      </form>
    </li>
  )
}

export function SecretsPanel({ tool, act }: { tool: ToolDetail; act: Act }) {
  return (
    <Panel title={t('tools.secrets.title')}>
      <p className="mb-1 text-[12.5px] text-fg-3">{t('tools.secrets.hint')}</p>
      {tool.secrets.length === 0 ? (
        <p className="pt-2 text-[13px] text-fg-3">{t('tools.secrets.none')}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col divide-y divide-line p-0" data-testid="tool-secrets">
          {tool.secrets.map((s) => (
            <SecretRow key={s.name} slug={tool.slug} name={s.name} set={s.set} act={act} />
          ))}
        </ul>
      )}
    </Panel>
  )
}
