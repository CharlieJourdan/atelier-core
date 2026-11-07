// « J'ai mon script » (agents-production): paste the script, or import a .txt / .docx file (read by the main process,
// `projects.readScript`, so a Word file needs no library here). Used by « Nouvelle vidéo » and the inbox's « Importer le
// script ». The text is the project's `script` input, said as it is written.
import { FileText } from 'lucide-react'
import { useRef, useState } from 'react'
import { t } from '../../../../shared/fr'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/input'
import { toast } from '@/lib/toast'
import { call, errText } from '@/state/client'

const words = (s: string): number => s.split(/\s+/).filter(Boolean).length

async function base64Of(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

/** The text of a dropped script file (.txt read here, .docx by the main process). */
export async function readScriptFile(file: File): Promise<string> {
  if (/\.(txt|md)$/i.test(file.name)) return (await file.text()).trim()
  return (await call('projects.readScript', { name: file.name, base64: await base64Of(file) })).text
}

export function ScriptField({ id, value, onChange, autoFocus = false }: { id: string; value: string; onChange: (v: string) => void; autoFocus?: boolean }) {
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const take = async (list: FileList | null): Promise<void> => {
    const file = list?.[0]
    if (!file) return
    setBusy(true)
    try {
      const text = await readScriptFile(file)
      onChange(text)
      toast.success(t('projects.script.read', { name: file.name, n: words(text) }))
    } catch (e) {
      toast.error(errText(e))
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }
  return (
    <div className="flex flex-col gap-1.5">
      <Textarea
        id={id}
        rows={8}
        autoFocus={autoFocus}
        value={value}
        maxLength={200_000}
        placeholder={t('projects.script.placeholder')}
        onChange={(e) => onChange(e.target.value)}
        data-testid="script-text"
      />
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] text-fg-3" data-testid="script-words">
          {t('projects.script.words', { n: words(value) })}
        </span>
        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => input.current?.click()} data-testid="script-file">
          <FileText aria-hidden />
          {t('projects.script.file')}
        </Button>
        <input ref={input} type="file" accept=".txt,.md,.docx,text/plain" className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => void take(e.target.files)} data-testid="script-file-input" />
      </div>
    </div>
  )
}
