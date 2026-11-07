// Mes outils › import a manifest (paste or drop a JSON file): French errors per path, the permissions it asks for, then
// « Ajouter » (new tool, after the user accepted the permissions) or « Importer la version » (existing tool).
import { CircleAlert, CircleCheck, FileUp } from 'lucide-react'
import { useRef, useState } from 'react'
import { t } from '../../../shared/fr'
import type { ToolValidation } from '../../../shared/tools'
import { ErrorLine } from '@/components/atelier/kit'
import { Button } from '@/components/ui/button'
import { DialogFooter } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/input'
import { toast } from '@/lib/toast'
import { call, errText, useLoader } from '@/state/client'
import { kindLabel, permissionLabel } from './common'

export type ImportMode = { kind: 'add' } | { kind: 'version'; slug: string }

export function ValidationView({ result, mode }: { result: ToolValidation; mode: ImportMode }) {
  if (!result.ok) {
    return (
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0" data-testid="manifest-errors" aria-live="polite">
        {result.errors.map((e, i) => (
          <li key={`${e.path}-${i}`} className="flex items-start gap-2 text-[12.5px] text-err">
            <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span>
              {e.path && <code className="mr-1.5 rounded-chip bg-surface-2 px-1.5 py-px font-mono text-[11.5px] text-fg-2">{e.path}</code>}
              {e.message}
            </span>
          </li>
        ))}
      </ul>
    )
  }
  const s = result.summary
  return (
    <div className="flex flex-col gap-3" data-testid="manifest-ok" aria-live="polite">
      {s && (
        <p className="flex items-center gap-2 text-[13px] text-fg-2">
          <CircleCheck className="size-4 text-ok" aria-hidden />
          <span>
            <span className="font-medium text-fg">{s.name}</span> · {kindLabel(s.kind)} · v{s.version}
          </span>
        </p>
      )}
      {mode.kind === 'add' && result.exists && <p className="text-[12.5px] text-warn">{t('tools.import.exists')}</p>}
      {mode.kind === 'version' && s && s.id !== mode.slug && <p className="text-[12.5px] text-warn">{t('tools.import.otherId', { slug: mode.slug })}</p>}
      <div>
        <h4 className="micro-label mb-1.5">{t('tools.import.asks')}</h4>
        {result.permissions.length === 0 ? (
          <p className="text-[12.5px] text-fg-3">{t('tools.import.asksNothing')}</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[12.5px] text-fg-2" data-testid="manifest-permissions">
            {result.permissions.map((p) => (
              <li key={p.id}>{permissionLabel(p)}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

export function ImportForm({ mode, onDone, onCancel }: { mode: ImportMode; onDone: (slug: string) => void; onCancel: () => void }) {
  const [text, setText] = useState('')
  const [accepted, setAccepted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const picker = useRef<HTMLInputElement>(null)
  // The check runs in main (the real schema and French messages) and follows the text.
  const checked = useLoader(() => (text.trim() ? call('tools.validate', text) : Promise.resolve(null)), `manifest:${text}`, [])
  const result: ToolValidation | null = text.trim() ? checked.data : null
  const shown = error ?? (text.trim() ? checked.error : null)

  const read = async (file: File | undefined): Promise<void> => {
    if (!file) return
    if (file.size > 1_000_000) return setError(t('tools.import.tooBig'))
    setError(null)
    setText(await file.text())
  }

  const ready = result?.ok === true && (mode.kind === 'add' ? !result.exists && accepted : result.summary?.id === mode.slug)
  const run = async (): Promise<void> => {
    setBusy(true)
    try {
      if (mode.kind === 'add') {
        const tool = await call('tools.add', text)
        toast.success(t('tools.import.added', { name: tool.name }))
        onDone(tool.slug)
      } else {
        const r = await call('tools.importVersion', mode.slug, text)
        toast.success(t('tools.import.versioned', { version: r.tool.version }), r.newPermissions.length > 0 ? t('tools.import.newPerms', { n: r.newPermissions.length }) : undefined)
        onDone(r.tool.slug)
      }
    } catch (err) {
      setError(errText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <input ref={picker} type="file" accept=".json,application/json,text/plain" className="sr-only" aria-label={t('tools.import.pick')} onChange={(e) => void read(e.target.files?.[0])} />
        <Button type="button" variant="secondary" size="sm" onClick={() => picker.current?.click()}>
          <FileUp /> {t('tools.import.pick')}
        </Button>
        <span className="text-[12px] text-fg-3">{t('tools.import.dropHint')}</span>
      </div>
      <Textarea
        value={text}
        rows={12}
        spellCheck={false}
        aria-label={t('tools.import.text')}
        placeholder={t('tools.import.placeholder')}
        data-dragging={dragging}
        className={`font-mono text-[12px] ${dragging ? 'border-brand' : ''}`}
        onChange={(e) => {
          setError(null)
          setText(e.target.value)
        }}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          void read(e.dataTransfer.files[0])
        }}
      />
      {shown && <ErrorLine message={shown} />}
      {result && <ValidationView result={result} mode={mode} />}
      {mode.kind === 'add' && result?.ok && !result.exists && (
        <label className="flex items-start gap-2.5 text-[12.5px] text-fg-2">
          <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} className="mt-0.5 size-4 accent-[var(--brand)]" />
          {t('tools.import.accept')}
        </label>
      )}
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onCancel}>
          {t('tools.cancel')}
        </Button>
        <Button type="button" disabled={!ready || busy} onClick={() => void run()}>
          {t(mode.kind === 'add' ? 'tools.import.add' : 'tools.import.version')}
        </Button>
      </DialogFooter>
    </div>
  )
}
