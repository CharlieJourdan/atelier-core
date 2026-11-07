// Shared pieces of the Réglages preference pages: the page shell, a titled block, an info row, and the two setting
// editors (switch, bounded number) that write through the generic `settings.set`.
import { useState, type ReactNode } from 'react'
import type { JsonValue } from '../../../../shared/api'
import { t, type MessageKey } from '../../../../shared/fr'
import { ErrorLine, LoadingBlock } from '@/components/atelier/kit'
import { PageShell } from '@/components/atelier/page'
import { Panel } from '@/components/atelier/primitives'
import { Button } from '@/components/ui/button'
import { Input, Switch } from '@/components/ui/input'
import { toast } from '@/lib/toast'
import { call, errText } from '@/state/client'

export type PrefsPageId =
  | 'general'
  | 'moteur'
  | 'budgets'
  | 'chaines'
  | 'notifications'
  | 'discord'
  | 'ordinateur'
  | 'audio'
  | 'apparence'
  | 'fonctions'
  | 'donnees'
  | 'avance'
  | 'apropos'

export function PrefsPage({ page, actions, children }: { page: PrefsPageId; actions?: ReactNode; children: ReactNode }) {
  return (
    <PageShell
      section="reglages"
      title={t(`prefs.${page}.title` as MessageKey)}
      subtitle={t(`prefs.${page}.subtitle` as MessageKey)}
      actions={actions}
    >
      <div className="flex max-w-3xl flex-col gap-5" data-testid={`prefs-${page}`}>
        {children}
      </div>
    </PageShell>
  )
}

/** Loading / error / content for a page that reads data. */
export function Loaded<T>({ data, error, onRetry, children }: { data: T | null; error: string | null; onRetry?: () => void; children: (d: T) => ReactNode }) {
  if (error) return <ErrorLine message={error} {...(onRetry ? { onRetry } : {})} />
  if (data === null) return <LoadingBlock rows={4} />
  return <>{children(data)}</>
}

export function InfoRow({ label, children, mono = false }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-6 border-b border-line py-2.5 last:border-b-0">
      <dt className="text-[13px] text-fg-3">{label}</dt>
      <dd className={`min-w-0 text-right text-[13px] break-all text-fg ${mono ? 'font-mono text-[12px]' : ''}`}>{children}</dd>
    </div>
  )
}

export function InfoList({ children }: { children: ReactNode }) {
  return <dl className="flex flex-col">{children}</dl>
}

export function Block({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <Panel title={title} action={action} className="p-5">
      {children}
    </Panel>
  )
}

/** A line with a label and its explanation on the left, a control on the right. */
export function SettingRow({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 border-b border-line py-3 first:pt-0 last:border-b-0 last:pb-0">
      <div className="min-w-0">
        <p className="text-[13px] font-medium text-fg">{label}</p>
        {hint && <p className="mt-0.5 text-[12px] text-fg-3">{hint}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  )
}

/** Parses a bounded number typed by the user; null when it is not valid. */
export function parseBounded(text: string, opts: { min: number; max: number; integer: boolean }): number | null {
  const s = text.trim().replace(',', '.')
  if (s === '' || !/^-?\d+(\.\d+)?$/.test(s)) return null
  const n = Number(s)
  if (!Number.isFinite(n) || n < opts.min || n > opts.max) return null
  if (opts.integer && !Number.isInteger(n)) return null
  return n
}

async function saveSetting(key: string, value: JsonValue): Promise<boolean> {
  try {
    await call('settings.set', key, value)
    toast.success(t('prefs.saved'))
    return true
  } catch (err) {
    toast.error(t('prefs.saveError'), errText(err))
    return false
  }
}

export function ToggleSetting({ settingKey, label, hint, value }: { settingKey: string; label: string; hint?: string; value: boolean }) {
  const [busy, setBusy] = useState(false)
  return (
    <SettingRow {...(hint ? { label, hint } : { label })}>
      <Switch
        checked={value}
        disabled={busy}
        aria-label={label}
        data-setting={settingKey}
        onCheckedChange={(v) => {
          setBusy(true)
          void saveSetting(settingKey, v).finally(() => setBusy(false))
        }}
      />
    </SettingRow>
  )
}

export function NumberSetting({
  settingKey,
  label,
  hint,
  value,
  min,
  max,
  integer = true,
  unit
}: {
  settingKey: string
  label: string
  hint?: string
  value: number
  min: number
  max: number
  integer?: boolean
  unit?: string
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const text = draft ?? String(value)
  const parsed = parseBounded(text, { min, max, integer })
  const invalid = draft !== null && parsed === null
  const dirty = draft !== null && parsed !== null && parsed !== value
  return (
    <SettingRow {...(hint ? { label, hint } : { label })}>
      <div className="flex flex-col items-end gap-1">
        <div className="flex items-center gap-2">
          <Input
            inputMode="decimal"
            value={text}
            aria-label={label}
            aria-invalid={invalid}
            data-setting={settingKey}
            className="w-24 text-right"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && dirty && parsed !== null) void saveSetting(settingKey, parsed).then((ok) => ok && setDraft(null))
            }}
          />
          {unit && <span className="w-12 text-[12px] text-fg-3">{unit}</span>}
          <Button
            size="sm"
            variant="secondary"
            disabled={!dirty}
            onClick={() => {
              if (parsed !== null) void saveSetting(settingKey, parsed).then((ok) => ok && setDraft(null))
            }}
          >
            {t('prefs.save')}
          </Button>
        </div>
        {invalid && (
          <p role="alert" className="text-[11.5px] text-err">
            {t(integer ? 'prefs.invalid.int' : 'prefs.invalid.num', { min, max })}
          </p>
        )}
      </div>
    </SettingRow>
  )
}

/** A number setting that may only be read from the settings map: valid number, otherwise the default the main process uses. */
export function numberOf(settings: Readonly<Record<string, JsonValue>>, key: string, fallback: number, min: number, max: number, integer = true): number {
  const v = settings[key]
  return typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max && (!integer || Number.isInteger(v)) ? v : fallback
}

export function boolOf(settings: Readonly<Record<string, JsonValue>>, key: string, fallback: boolean): boolean {
  const v = settings[key]
  return typeof v === 'boolean' ? v : fallback
}
