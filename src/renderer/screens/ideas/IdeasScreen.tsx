// Production › Idées: the ideas of each channel, typed by hand or proposed by the ideas agent (a real model call through
// the user's Claude Code), kept, dropped, or turned into a video row with « Créer la vidéo ». All real.
import { Plus, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { t } from '../../../shared/fr'
import { IDEA_STATUSES, type IdeaRow, type IdeaStatus } from '../../../shared/api/ideas'
import { useConfirm } from '@/components/atelier/confirm'
import { ErrorLine, Field, LoadingBlock } from '@/components/atelier/kit'
import { PageShell } from '@/components/atelier/page'
import { EmptyState } from '@/components/atelier/primitives'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input, Select, Textarea } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { toast } from '@/lib/toast'
import { ShimmeringText } from '@/vendor/elevenlabs-ui'
import { call, errText, useLoader } from '@/state/client'
import type { ScreenProps } from '../registry'
import { IdeaCard } from './IdeaCard'
import { ideaStatusLabel, useChannels } from './common'

type StatusFilter = IdeaStatus | 'all'

function NewIdeaForm({ channels, defaultChannel, onClose }: { channels: { id: number; name: string }[]; defaultChannel: string; onClose: () => void }) {
  const [channelId, setChannelId] = useState(defaultChannel || String(channels[0]?.id ?? ''))
  const [title, setTitle] = useState('')
  const [angle, setAngle] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const submit = async (): Promise<void> => {
    setBusy(true)
    try {
      await call('ideas.create', { channelId: Number(channelId), title, angle })
      toast.success(t('ideas.added'))
      onClose()
    } catch (err) {
      setError(errText(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      <Field label={t('ideas.field.channel')} htmlFor="idea-channel">
        <Select id="idea-channel" value={channelId} onChange={(e) => setChannelId(e.target.value)} required>
          {channels.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t('ideas.field.title')} htmlFor="idea-title">
        <Input id="idea-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} required autoFocus />
      </Field>
      <Field label={t('ideas.field.angle')} htmlFor="idea-angle" hint={t('ideas.field.angleHint')}>
        <Textarea id="idea-angle" value={angle} onChange={(e) => setAngle(e.target.value)} rows={3} />
      </Field>
      {error && <ErrorLine message={error} />}
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onClose}>
          {t('ideas.cancel')}
        </Button>
        <Button type="submit" disabled={busy || !title.trim() || !channelId}>
          {t('ideas.add')}
        </Button>
      </DialogFooter>
    </form>
  )
}

export function IdeasList({ ideas, filter, ...actions }: { ideas: readonly IdeaRow[]; filter: StatusFilter; busyId?: number | null } & Omit<Parameters<typeof IdeaCard>[0], 'idea' | 'busy'>) {
  const shown = filter === 'all' ? ideas : ideas.filter((i) => i.status === filter)
  if (shown.length === 0) return <EmptyState title={t('ideas.empty.title')} blurb={t(ideas.length === 0 ? 'ideas.empty.blurb' : 'ideas.empty.filtered')} className="py-12" />
  const { busyId, ...rest } = actions
  return (
    <ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 xl:grid-cols-2" data-testid="ideas-list">
      {shown.map((i) => (
        <IdeaCard key={i.id} idea={i} busy={busyId === i.id} {...rest} />
      ))}
    </ul>
  )
}

export function IdeasScreen(_props: ScreenProps) {
  const channels = useChannels()
  const [channelId, setChannelId] = useState('')
  const [filter, setFilter] = useState<StatusFilter>('all')
  const [adding, setAdding] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [busyId, setBusyId] = useState<number | null>(null)
  const confirm = useConfirm()
  const ideas = useLoader(() => call('ideas.list', channelId ? Number(channelId) : undefined), `ideas:${channelId}`, ['ideas', 'example'])
  const channelList = channels.data ?? []

  const generate = async (): Promise<void> => {
    setGenerating(true)
    try {
      const rows = await call('ideas.generate', Number(channelId), 5)
      toast.success(t('ideas.generated', { n: rows.length }))
    } catch (err) {
      toast.error(errText(err))
    } finally {
      setGenerating(false)
    }
  }
  const run = async (id: number, action: () => Promise<unknown>, success: string): Promise<void> => {
    setBusyId(id)
    try {
      await action()
      toast.success(success)
    } catch (err) {
      toast.error(errText(err))
    } finally {
      setBusyId(null)
    }
  }
  const remove = async (i: IdeaRow): Promise<void> => {
    const ok = await confirm({ title: t('ideas.deleteTitle'), description: t('ideas.deleteBody', { title: i.title }), confirmLabel: t('ideas.delete'), danger: true })
    if (ok) await run(i.id, () => call('ideas.delete', i.id), t('ideas.deleted'))
  }

  const actions = (
    <div className="flex items-center gap-2">
      <Button variant="secondary" onClick={() => setAdding(true)} disabled={channelList.length === 0}>
        <Plus /> {t('ideas.new')}
      </Button>
      <Button onClick={() => void generate()} disabled={generating || !channelId} title={channelId ? undefined : t('ideas.generate.pick')}>
        <Sparkles /> {t('ideas.generate')}
      </Button>
    </div>
  )
  return (
    <PageShell section="production" title={t('page.production.idees')} subtitle={t('ideas.subtitle')} actions={actions}>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Select aria-label={t('ideas.field.channel')} value={channelId} onChange={(e) => setChannelId(e.target.value)} className="w-56">
          <option value="">{t('ideas.allChannels')}</option>
          {channelList.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <Tabs value={filter} onValueChange={(v) => setFilter(v as StatusFilter)}>
          <TabsList>
            <TabsTrigger value="all">{t('ideas.filter.all')}</TabsTrigger>
            {IDEA_STATUSES.map((s) => (
              <TabsTrigger key={s} value={s}>
                {ideaStatusLabel(s)}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        {!channelId && <p className="text-[12px] text-fg-3">{t('ideas.generate.pick')}</p>}
      </div>
      {generating && <ShimmeringText text={t('ideas.generating')} className="mb-4 text-[13px]" />}
      {ideas.error ? (
        <ErrorLine message={ideas.error} onRetry={ideas.reload} />
      ) : !ideas.data ? (
        <LoadingBlock rows={4} />
      ) : (
        <IdeasList
          ideas={ideas.data}
          filter={filter}
          busyId={busyId}
          onKeep={(i) => void run(i.id, () => call('ideas.update', i.id, { status: 'kept' }), t('ideas.kept'))}
          onReject={(i) => void run(i.id, () => call('ideas.update', i.id, { status: 'rejected' }), t('ideas.rejected'))}
          onCreate={(i) => void run(i.id, () => call('ideas.toVideo', i.id), t('ideas.videoMade', { title: i.title }))}
          onDelete={(i) => void remove(i)}
        />
      )}
      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('ideas.new')}</DialogTitle>
            <DialogDescription>{t('ideas.newHint')}</DialogDescription>
          </DialogHeader>
          {adding && <NewIdeaForm channels={channelList} defaultChannel={channelId} onClose={() => setAdding(false)} />}
        </DialogContent>
      </Dialog>
    </PageShell>
  )
}
