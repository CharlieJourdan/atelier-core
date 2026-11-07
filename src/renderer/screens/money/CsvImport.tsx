// Revenus › Importer un CSV: paste or pick a file, check it line by line (nothing is written), then import.
import { CircleAlert, CircleCheck, FileUp } from 'lucide-react'
import { useRef, useState } from 'react'
import { t } from '../../../shared/fr'
import type { CsvPreview } from '../../../shared/api/money'
import { ErrorLine } from '@/components/atelier/kit'
import { Button } from '@/components/ui/button'
import { DialogFooter } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/input'
import { toast } from '@/lib/toast'
import { call, errText, useLoader } from '@/state/client'
import { centsToTyped } from './common'

const SAMPLE = 'date;montant;devise;chaîne;type;note\n2026-10-03;152,40;EUR;;adsense;relevé AdSense'

export function PreviewTable({ preview }: { preview: CsvPreview }) {
  return (
    <div className="max-h-64 overflow-auto rounded-card border border-line" data-testid="csv-preview">
      <table className="w-full border-collapse text-[12.5px]">
        <thead>
          <tr className="border-b border-line bg-surface-1">
            <th scope="col" className="micro-label w-14 px-3 py-2 text-left font-normal">
              {t('money.csv.line')}
            </th>
            <th scope="col" className="micro-label px-3 py-2 text-left font-normal">
              {t('money.csv.result')}
            </th>
          </tr>
        </thead>
        <tbody>
          {preview.lines.map((l) => (
            <tr key={l.line} className="border-b border-line last:border-b-0">
              <td className="px-3 py-1.5 text-fg-3 tabular-nums">{l.line}</td>
              <td className="px-3 py-1.5">
                {l.ok && l.value ? (
                  <span className="inline-flex items-center gap-2 text-fg-2">
                    <CircleCheck className="size-3.5 text-ok" aria-label={t('money.csv.ok')} />
                    {l.value.date} · {centsToTyped(l.value.amountCents)} {l.value.currency} · {t(`money.type.${l.value.type}`)}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-2 text-err">
                    <CircleAlert className="size-3.5" aria-label={t('money.csv.error')} />
                    {l.error}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function CsvImport({ onDone }: { onDone: () => void }) {
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const picker = useRef<HTMLInputElement>(null)

  // The preview is computed in main (so channel names resolve) and follows the text; no effect, no extra state.
  const checked = useLoader(() => (text.trim() ? call('money.revenues.previewCsv', text) : Promise.resolve(null)), `csv:${text}`, [])
  const preview: CsvPreview | null = text.trim() ? checked.data : null
  const shownError = error ?? (text.trim() ? checked.error : null)

  const pick = async (file: File | undefined): Promise<void> => {
    if (!file) return
    if (file.size > 2_000_000) return setError(t('money.csv.tooBig'))
    setError(null)
    setText(await file.text())
  }

  const run = async (): Promise<void> => {
    setBusy(true)
    try {
      const r = await call('money.revenues.importCsv', text)
      toast.success(t('money.csv.done', { n: r.imported }), r.skipped > 0 ? t('money.csv.skipped', { n: r.skipped }) : undefined)
      onDone()
    } catch (err) {
      setError(errText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <input ref={picker} type="file" accept=".csv,.txt,text/csv,text/plain" className="sr-only" aria-label={t('money.csv.pick')} onChange={(e) => void pick(e.target.files?.[0])} />
        <Button type="button" variant="secondary" size="sm" onClick={() => picker.current?.click()}>
          <FileUp /> {t('money.csv.pick')}
        </Button>
        <button type="button" className="text-[12px] text-brand-fg underline underline-offset-2" onClick={() => setText(SAMPLE)}>
          {t('money.csv.sample')}
        </button>
      </div>
      <Textarea value={text} onChange={(e) => {
          setError(null)
          setText(e.target.value)
        }} placeholder={SAMPLE} rows={6} aria-label={t('money.csv.text')} className="font-mono text-[12px]" spellCheck={false} />
      {shownError && <ErrorLine message={shownError} />}
      {preview && (
        <>
          <p className="text-[13px] text-fg-2" aria-live="polite">
            {t('money.csv.summary', { valid: preview.valid, invalid: preview.invalid })}
          </p>
          <PreviewTable preview={preview} />
        </>
      )}
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onDone}>
          {t('money.cancel')}
        </Button>
        <Button type="button" disabled={busy || !preview || preview.valid === 0} onClick={() => void run()}>
          {t('money.csv.import', { n: preview?.valid ?? 0 })}
        </Button>
      </DialogFooter>
    </div>
  )
}
