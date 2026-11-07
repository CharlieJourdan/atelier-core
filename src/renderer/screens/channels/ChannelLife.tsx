// Real mode, a channel's life (the beta): « Traduire la chaîne » (a dialog: the language, the source's language, the name;
// refused when it already exists in that language) and « Archiver la chaîne » (a confirmation: the channel leaves the lists,
// its agents are paused, nothing is deleted) in the channel sheet; the archived channels and « Restaurer » under the list.
// Everything goes through the channelLife.* IPC module (src/main/channels/life.ts); the next snapshot brings the change.
import { Archive, ArchiveRestore, Languages } from 'lucide-react'
import { useState } from 'react'
import type { ChannelLanguage } from '../../../shared/api/channel-life'
import { CHANNEL_LANGUAGES } from '../../../shared/api/channel-life'
import { t } from '../../../shared/fr'
import { useConfirm } from '@/components/atelier/confirm'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input, Label, Select } from '@/components/ui/input'
import { toast } from '@/lib/toast'
import { useProtoActions } from '@/proto/store'
import type { ProtoChannel } from '@/proto/types'
import { call, errText, useLoader } from '@/state/client'

/** The database id of a real channel (`db-12` → 12), or null for a demo one. */
export function dbIdOf(channel: Pick<ProtoChannel, 'id'>): number | null {
  const m = /^db-(\d+)$/.exec(channel.id)
  return m ? Number(m[1]) : null
}

const langName = (l: ChannelLanguage): string => t(`onb.lang.${l}`)

/** The two actions of the channel sheet (real channels only). `onArchived`: back to the list. */
export function ChannelLifeActions({ channel, onArchived }: { channel: ProtoChannel; onArchived: () => void }) {
  const id = dbIdOf(channel)
  const confirm = useConfirm()
  const { setScope } = useProtoActions()
  const [translating, setTranslating] = useState(false)
  if (id === null) return null

  const archive = async (): Promise<void> => {
    const ok = await confirm({
      title: t('beta.channel.archive.title', { name: channel.name }),
      description: t('beta.channel.archive.body'),
      confirmLabel: t('beta.channel.archive.confirm'),
      danger: true
    })
    if (!ok) return
    try {
      const res = await call('channelLife.archive', id)
      toast.success(t('beta.channel.archived', { name: channel.name, n: res.agentsPaused }))
      setScope('all')
      onArchived()
    } catch (e) {
      toast.error(errText(e))
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="channel-life">
      <Button variant="secondary" size="sm" data-testid="channel-translate" onClick={() => setTranslating(true)}>
        <Languages aria-hidden />
        {t('beta.channel.translate')}
      </Button>
      <Button variant="ghost" size="sm" data-testid="channel-archive" onClick={() => void archive()}>
        <Archive aria-hidden />
        {t('beta.channel.archive')}
      </Button>
      {translating && <TranslateDialog channel={channel} sourceId={id} onClose={() => setTranslating(false)} />}
    </div>
  )
}

function TranslateDialog({ channel, sourceId, onClose }: { channel: ProtoChannel; sourceId: number; onClose: () => void }) {
  const from: ChannelLanguage = channel.language
  const first = CHANNEL_LANGUAGES.find((l) => l !== from) ?? 'en'
  const [sourceLanguage, setSourceLanguage] = useState<ChannelLanguage>(from)
  const [language, setLanguage] = useState<ChannelLanguage>(first)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const existing = useLoader(() => call('channelLife.findTranslation', sourceId, language), `${sourceId}-${language}`, ['channels'])
  const existingName = useLoader(
    () => (existing.data ? call('channels.get', existing.data).then((c) => c.name) : Promise.resolve(null)),
    String(existing.data),
    []
  )
  const blocked = existing.data !== null && existing.data !== undefined
  const same = language === sourceLanguage

  const go = (): void => {
    setBusy(true)
    setError(null)
    call('channelLife.translate', { sourceId, language, sourceLanguage, ...(name.trim() ? { name: name.trim() } : {}) })
      .then((res) => {
        toast.success(t('beta.channel.translate.done', { name: res.channel.name }), res.copied.styleSheet || res.copied.styleProfile ? t('beta.channel.translate.copied') : undefined)
        onClose()
      })
      .catch((e: unknown) => setError(errText(e)))
      .finally(() => setBusy(false))
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent data-testid="translate-dialog" className="w-[min(520px,92vw)]">
        <DialogHeader>
          <DialogTitle className="font-serif text-2xl leading-tight">{t('beta.channel.translate.title', { name: channel.name })}</DialogTitle>
          <DialogDescription className="text-[13px] text-fg-3">{t('beta.channel.translate.blurb')}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="translate-lang">{t('beta.channel.translate.lang')}</Label>
            <Select id="translate-lang" data-testid="translate-lang" value={language} onChange={(e) => setLanguage(e.target.value as ChannelLanguage)}>
              {CHANNEL_LANGUAGES.map((l) => (
                <option key={l} value={l}>
                  {langName(l)}
                </option>
              ))}
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="translate-from">{t('beta.channel.translate.from', { name: channel.name })}</Label>
            <Select id="translate-from" data-testid="translate-from" value={sourceLanguage} onChange={(e) => setSourceLanguage(e.target.value as ChannelLanguage)}>
              {CHANNEL_LANGUAGES.map((l) => (
                <option key={l} value={l}>
                  {langName(l)}
                </option>
              ))}
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="translate-name">{t('beta.channel.translate.name')}</Label>
            <Input id="translate-name" data-testid="translate-name" value={name} maxLength={120} placeholder={`${channel.name} (${language.toUpperCase()})`} onChange={(e) => setName(e.target.value)} />
          </div>
          {blocked && (
            <p role="status" data-testid="translate-exists" className="text-[13px] text-warn">
              {t('beta.channel.translate.exists', { name: existingName.data ?? '' })}
            </p>
          )}
          {error && (
            <p role="alert" data-testid="translate-error" className="text-[13px] text-err">
              {error}
            </p>
          )}
        </div>
        <DialogFooter className="justify-end">
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button data-testid="translate-go" disabled={busy || blocked || same} onClick={go}>
            {t('beta.channel.translate.go')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Under the list (real mode): the archived channels, each with « Restaurer ». Hidden when there is none. */
export function ArchivedChannels() {
  const list = useLoader(() => call('channels.list', true).then((rows) => rows.filter((c) => c.archived)), 'archived', ['channels'])
  const [busy, setBusy] = useState<number | null>(null)
  if (!list.data || list.data.length === 0) return null
  const restore = (id: number, name: string): void => {
    setBusy(id)
    call('channelLife.restore', id)
      .then((res) => toast.success(t('beta.channel.restored', { name, n: res.agentsResumed })))
      .catch((e: unknown) => toast.error(errText(e)))
      .finally(() => setBusy(null))
  }
  return (
    <section className="mt-8" data-testid="archived-channels">
      <h2 className="text-[14px] font-semibold text-fg">{t('beta.channel.archivedList')}</h2>
      <p className="mt-1 text-[12.5px] text-fg-3">{t('beta.channel.archivedList.hint')}</p>
      <ul className="mt-3 flex flex-col divide-y divide-line rounded-card border border-line">
        {list.data.map((c) => (
          <li key={c.id} data-testid="archived-channel" data-channel={c.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
            <span className="min-w-0 truncate text-[13px] text-fg-2">{c.name}</span>
            <Button variant="ghost" size="sm" data-testid="channel-restore" disabled={busy !== null} onClick={() => restore(c.id, c.name)}>
              <ArchiveRestore aria-hidden />
              {t('beta.channel.restore')}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  )
}
