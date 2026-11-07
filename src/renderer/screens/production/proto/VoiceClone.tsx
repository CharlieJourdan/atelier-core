// « Ajouter une voix » in real mode: pick a recording, name it, and the Cloud clones it (checked here first: format and
// size; the main process measures the length, at least 10 s). The new voice shows in « Mes voix » with the next snapshot.
import { FileAudio } from 'lucide-react'
import { useRef, useState } from 'react'
import { t } from '../../../../shared/fr'
import { Button } from '@/components/ui/button'
import { Input, Label, Select } from '@/components/ui/input'
import { toast } from '@/lib/toast'
import { liveDriver } from '@/proto/live/registry'
import type { LiveVoices } from '@/proto/live/mapping-voices'

const MAX_BYTES = 20 * 1024 * 1024
const EXTENSIONS = ['mp3', 'm4a', 'wav']

/** The French message of a recording the clone call cannot take, or null when it looks fine. */
export function clipProblem(name: string, size: number): 'cloud.clone.format' | 'cloud.clone.tooBig' | 'cloud.clone.unreadable' | null {
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase()
  if (!EXTENSIONS.includes(ext)) return 'cloud.clone.format'
  if (size <= 0) return 'cloud.clone.unreadable'
  if (size > MAX_BYTES) return 'cloud.clone.tooBig'
  return null
}

export function VoiceClone({ clone, onDone }: { clone: LiveVoices['clone']; onDone: () => void }) {
  const [name, setName] = useState('')
  const [language, setLanguage] = useState('fr')
  const [file, setFile] = useState<File | null>(null)
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const picker = useRef<HTMLInputElement>(null)

  const pick = (f: File | null) => {
    setFile(f)
    const problem = f ? clipProblem(f.name, f.size) : null
    setError(problem ? t(problem) : null)
  }
  // decision 0025: the consent tick is required before anything is sent
  const ready = name.trim().length > 0 && file !== null && consent && error === null && !busy

  const submit = async () => {
    const driver = liveDriver()?.voices
    if (!file || !driver || !ready) return
    setBusy(true)
    setError(null)
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const voice = await driver.clone({ name: name.trim(), language, fileName: file.name, bytes, consent })
      toast.success(t('prod.res.addVoice.done', { name: voice.name }))
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      data-testid="voice-clone"
      className="card mb-3 flex flex-col gap-4 p-4"
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      <div>
        <h3 className="text-[13.5px] font-semibold tracking-[-0.01em] text-fg">{t('prod.res.addVoice.title')}</h3>
        <p className="mt-1 text-[12.5px] leading-[1.5] text-fg-3">{t('prod.res.addVoice.intro')}</p>
        {clone === 'demo' && <p className="mt-1 text-[12.5px] leading-[1.5] text-fg-3">{t('prod.res.addVoice.demoClone')}</p>}
      </div>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_140px]">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="vc-name">{t('prod.res.addVoice.name')}</Label>
          <Input id="vc-name" data-testid="voice-clone-name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder={t('prod.res.addVoice.namePh')} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="vc-lang">{t('prod.res.addVoice.language')}</Label>
          <Select id="vc-lang" value={language} onChange={(e) => setLanguage(e.target.value)}>
            <option value="fr">Français</option>
            <option value="en">English</option>
          </Select>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="vc-file">{t('prod.res.addVoice.file')}</Label>
        <div className="flex items-center gap-3">
          <input
            ref={picker}
            id="vc-file"
            data-testid="voice-clone-file"
            type="file"
            accept=".mp3,.m4a,.wav,audio/mpeg,audio/mp4,audio/wav,audio/x-wav"
            className="sr-only"
            onChange={(e) => pick(e.target.files?.[0] ?? null)}
          />
          <Button type="button" variant="secondary" size="sm" onClick={() => picker.current?.click()}>
            <FileAudio />
            {t('prod.res.addVoice.pick')}
          </Button>
          <span className="min-w-0 truncate text-[12.5px] text-fg-3">{file ? file.name : ''}</span>
        </div>
      </div>
      <label className="flex items-start gap-2 text-[12.5px] leading-[1.5] text-fg-2">
        <input type="checkbox" data-testid="voice-clone-consent" className="mt-0.5" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        <span>{t('prod.res.addVoice.consent')}</span>
      </label>
      {error && (
        <p role="alert" data-testid="voice-clone-error" className="text-[12.5px] text-err">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onDone} disabled={busy}>
          {t('prod.res.addVoice.cancel')}
        </Button>
        <Button type="submit" size="sm" disabled={!ready} data-testid="voice-clone-submit">
          {busy ? t('prod.res.addVoice.working') : t('prod.res.addVoice.submit')}
        </Button>
      </div>
    </form>
  )
}
