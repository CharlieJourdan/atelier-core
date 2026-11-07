// What a story pipeline takes from the channel (clone-reddit-shorts): « Nouvelle vidéo » shows the channel's clip library (made once, read
// by every video of the channel) with a way to fill it with free clips (Wikimedia Commons, free; Pixabay / Pexels through Atelier Cloud), or
// the folder of the owner's own clips for this video (the project's `gameplay` input); the picture of the title card (who or what: the
// channel's picture, a mascot, a face…) and the channel's own music, both kept with the channel (Charlie's review of 02/11).
import { Film, Image as ImageIcon, Music } from 'lucide-react'
import { useState } from 'react'
import { t } from '../../../../shared/fr'
import { Button } from '@/components/ui/button'
import { Input, Label } from '@/components/ui/input'
import { toast } from '@/lib/toast'
import { call, errText, useLoader } from '@/state/client'

const fileName = (p: string | null | undefined): string => (p ? (p.split(/[\\/]/).pop() ?? p) : '')

/** A path field with its « Enregistrer » button: the picture or the music the channel keeps. */
function AssetField({ id, icon, label, current, placeholder, onSave }: { id: string; icon: React.ReactNode; label: string; current: string; placeholder: string; onSave: (file: string) => Promise<void> }) {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const save = async (): Promise<void> => {
    setBusy(true)
    try {
      await onSave(value.trim())
      setValue('')
    } catch (e) {
      toast.error(errText(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id} className="flex items-center gap-1.5">
        {icon}
        {label}
      </Label>
      <p className="m-0 text-[12px] text-fg-3">{current}</p>
      <div className="flex gap-1.5">
        <Input id={id} value={value} placeholder={placeholder} onChange={(e) => setValue(e.target.value)} />
        <Button type="button" size="sm" variant="outline" disabled={busy || !value.trim()} onClick={() => void save()} data-testid={`${id}-save`}>
          {t('clips.save')}
        </Button>
      </div>
    </div>
  )
}

export function ClipLibraryField({ channelId, folder, onFolder }: { channelId: number | null; folder: string; onFolder: (v: string) => void }) {
  const lib = useLoader(() => (channelId === null ? Promise.resolve(null) : call('channelClips.get', channelId)), String(channelId), ['production'])
  const [busy, setBusy] = useState<'commons' | 'cloud' | null>(null)
  const fill = async (source: 'commons' | 'cloud'): Promise<void> => {
    if (channelId === null) return
    setBusy(source)
    try {
      const r = await call('channelClips.fromStock', channelId, { source })
      toast.success(t('clips.added', { n: String(r.added), total: String(r.clips) }))
      lib.reload()
    } catch (e) {
      toast.error(errText(e))
    } finally {
      setBusy(null)
    }
  }
  const clips = lib.data?.clips ?? 0
  return (
    <div className="flex flex-col gap-3 md:col-span-2" data-testid="clip-library">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="project-clips">{t('clips.title')}</Label>
        <p className="m-0 flex items-center gap-1.5 text-[12.5px] text-fg-2">
          <Film className="size-3.5" aria-hidden />
          {channelId === null ? t('clips.noChannel') : clips > 0 ? t('clips.count', { n: String(clips) }) : t('clips.none')}
        </p>
        {channelId !== null && (
          <div className="flex flex-wrap gap-1.5">
            <Button type="button" size="sm" variant="outline" disabled={busy !== null} onClick={() => void fill('commons')} data-testid="clips-commons">
              {busy === 'commons' ? t('clips.busy') : t('clips.commons')}
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={busy !== null} onClick={() => void fill('cloud')} data-testid="clips-cloud">
              {busy === 'cloud' ? t('clips.busy') : t('clips.cloud')}
            </Button>
          </div>
        )}
        <Input id="project-clips" value={folder} placeholder={t('clips.folder.placeholder')} onChange={(e) => onFolder(e.target.value)} />
        <p className="m-0 text-[12px] text-fg-3">{t('clips.hint')}</p>
      </div>
      {channelId !== null && (
        <>
          <AssetField
            id="clips-avatar"
            icon={<ImageIcon className="size-3.5" aria-hidden />}
            label={t('clips.avatar')}
            current={lib.data?.avatar ? t('clips.avatar.current', { name: fileName(lib.data.avatar) }) : t('clips.avatar.none')}
            placeholder={t('clips.avatar.placeholder')}
            onSave={async (file) => {
              await call('channelClips.setAvatar', channelId, file)
              lib.reload()
            }}
          />
          <AssetField
            id="clips-music"
            icon={<Music className="size-3.5" aria-hidden />}
            label={t('clips.music')}
            current={lib.data?.music ? t('clips.music.current', { name: fileName(lib.data.music) }) : t('clips.music.none')}
            placeholder={t('clips.music.placeholder')}
            onSave={async (file) => {
              await call('channelClips.setMusic', channelId, file)
              lib.reload()
            }}
          />
        </>
      )}
    </div>
  )
}
