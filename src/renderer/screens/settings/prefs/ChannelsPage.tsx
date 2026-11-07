// Réglages › Chaînes: create, rename, archive and restore the channels the team manages (workflow API), and the Google
// block that reads the owner's real YouTube figures (GoogleBlock.tsx).
import { Archive, ArchiveRestore, Pencil, Plus } from 'lucide-react'
import { useState } from 'react'
import { t } from '../../../../shared/fr'
import type { ChannelRow } from '../../../../shared/workflow'
import { useConfirm } from '@/components/atelier/confirm'
import { ExampleBadge, Field } from '@/components/atelier/kit'
import { EmptyState } from '@/components/atelier/primitives'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from '@/lib/toast'
import { call, errText, useLoader } from '@/state/client'
import type { ScreenProps } from '../../registry'
import { Block, Loaded, PrefsPage } from './common'
import { GoogleBlock } from './GoogleBlock'

export interface ChannelActions {
  create: (name: string, niche: string) => Promise<boolean>
  rename: (id: number, name: string) => Promise<boolean>
  setArchived: (channel: ChannelRow, archived: boolean) => Promise<void>
}

export function NewChannelForm({ onCreate }: { onCreate: ChannelActions['create'] }) {
  const [name, setName] = useState('')
  const [niche, setNiche] = useState('')
  const [busy, setBusy] = useState(false)
  const ok = name.trim().length > 0
  return (
    <form
      className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
      onSubmit={(e) => {
        e.preventDefault()
        if (!ok || busy) return
        setBusy(true)
        void onCreate(name.trim(), niche.trim())
          .then((done) => {
            if (done) {
              setName('')
              setNiche('')
            }
          })
          .finally(() => setBusy(false))
      }}
    >
      <Field label={t('prefs.chaines.name')} htmlFor="prefs-channel-name">
        <Input id="prefs-channel-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
      </Field>
      <Field label={t('prefs.chaines.niche')} htmlFor="prefs-channel-niche">
        <Input id="prefs-channel-niche" value={niche} onChange={(e) => setNiche(e.target.value)} maxLength={200} />
      </Field>
      <Button type="submit" variant="brand" disabled={!ok || busy}>
        <Plus /> {t('prefs.chaines.create')}
      </Button>
    </form>
  )
}

function ChannelLine({ channel, example, actions }: { channel: ChannelRow; example: boolean; actions: ChannelActions }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(channel.name)
  const save = (): void => {
    const next = name.trim()
    if (!next || next === channel.name) return setEditing(false)
    void actions.rename(channel.id, next).then((ok) => ok && setEditing(false))
  }
  return (
    <li data-testid="channel-line" data-channel={channel.id} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0 flex-1">
        {editing ? (
          <Input
            autoFocus
            value={name}
            aria-label={t('prefs.chaines.rename')}
            maxLength={120}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') save()
              if (e.key === 'Escape') setEditing(false)
            }}
          />
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-[13.5px] font-medium text-fg">{channel.name}</p>
            {example && <ExampleBadge />}
            {channel.archived && <Badge variant="outline">{t('prefs.chaines.archived')}</Badge>}
            {channel.autopilotOn && <Badge variant="brand">{t('prefs.chaines.autopilot')}</Badge>}
          </div>
        )}
        {!editing && <p className="mt-0.5 truncate text-[12px] text-fg-3">{channel.niche.trim() || t('prefs.chaines.noNiche')}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {editing ? (
          <>
            <Button size="sm" variant="secondary" onClick={save}>
              {t('prefs.save')}
            </Button>
          </>
        ) : (
          <>
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
              <Pencil /> {t('prefs.chaines.rename')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void actions.setArchived(channel, !channel.archived)}>
              {channel.archived ? <ArchiveRestore /> : <Archive />} {channel.archived ? t('prefs.chaines.restore') : t('prefs.chaines.archive')}
            </Button>
          </>
        )}
      </div>
    </li>
  )
}

export function ChannelsBody({
  channels,
  exampleIds,
  actions,
  showArchived,
  onShowArchived
}: {
  channels: readonly ChannelRow[]
  exampleIds: readonly number[]
  actions: ChannelActions
  showArchived: boolean
  onShowArchived: (v: boolean) => void
}) {
  const shown = channels.filter((c) => showArchived || !c.archived)
  const hasArchived = channels.some((c) => c.archived)
  return (
    <>
      <Block title={t('prefs.chaines.add')}>
        <NewChannelForm onCreate={actions.create} />
      </Block>
      {shown.length === 0 ? (
        <EmptyState title={t('prefs.chaines.empty.title')} blurb={t('prefs.chaines.empty.blurb')} />
      ) : (
        <Block
          title={t('prefs.chaines.list')}
          action={
            hasArchived ? (
              <label className="flex items-center gap-2 text-[12px] text-fg-3">
                <input type="checkbox" checked={showArchived} onChange={(e) => onShowArchived(e.target.checked)} />
                {t('prefs.chaines.showArchived')}
              </label>
            ) : undefined
          }
        >
          <ul className="flex flex-col divide-y divide-line">
            {shown.map((c) => (
              <ChannelLine key={c.id} channel={c} example={exampleIds.includes(c.id)} actions={actions} />
            ))}
          </ul>
        </Block>
      )}
    </>
  )
}

export function ChannelsPage(_props: ScreenProps) {
  const confirm = useConfirm()
  const [showArchived, setShowArchived] = useState(false)
  const list = useLoader(() => call('channels.list', true), 'prefs-channels', ['channels', 'example'])
  const example = useLoader(() => call('example.status'), 'prefs-channels-example', ['example'])

  const actions: ChannelActions = {
    create: async (name, niche) => {
      try {
        await call('channels.create', { name, ...(niche ? { niche } : {}) })
        toast.success(t('prefs.chaines.created'))
        return true
      } catch (err) {
        toast.error(t('prefs.saveError'), errText(err))
        return false
      }
    },
    rename: async (id, name) => {
      try {
        await call('channels.update', id, { name })
        toast.success(t('prefs.chaines.renamed'))
        return true
      } catch (err) {
        toast.error(t('prefs.saveError'), errText(err))
        return false
      }
    },
    setArchived: async (channel, archived) => {
      if (archived) {
        const ok = await confirm({
          title: t('prefs.chaines.archive.title', { name: channel.name }),
          description: t('prefs.chaines.archive.body'),
          confirmLabel: t('prefs.chaines.archive'),
          danger: true
        })
        if (!ok) return
      }
      try {
        await call('channels.archive', channel.id, archived)
        toast.success(t(archived ? 'prefs.chaines.archive.done' : 'prefs.chaines.restore.done'))
      } catch (err) {
        toast.error(t('prefs.saveError'), errText(err))
      }
    }
  }
  return (
    <PrefsPage page="chaines">
      <Loaded data={list.data} error={list.error} onRetry={list.reload}>
        {(channels) => (
          <ChannelsBody
            channels={channels}
            exampleIds={example.data?.channelIds ?? []}
            actions={actions}
            showArchived={showArchived}
            onShowArchived={setShowArchived}
          />
        )}
      </Loaded>
      <GoogleBlock channels={list.data ?? []} />
    </PrefsPage>
  )
}
