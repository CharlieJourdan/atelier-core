// « Briques sur mesure » (Production › Briques, real mode): the custom bricks the channels' Monteurs wrote (docs/ENGINE-SPEC.md §25.2), with
// their last preview's stills, their state (brouillon / à valider / validée) and the lint verdict. A brick waiting for Charlie is decided
// here like in his inbox (Valider, or Refuser with a note: the agent revises it); a validated one can be switched off for the channel's
// films. « Demander une brique » sends the request to Atlas, who hands it to the channel's team.
import { Sparkles } from 'lucide-react'
import { useState } from 'react'
import { t, type MessageKey } from '../../../../shared/fr'
import type { CustomBrick } from '../../../../shared/api/bricks'
import { SectionHead } from '@/components/proto/kit'
import { Button } from '@/components/ui/button'
import { Label, Select, Textarea } from '@/components/ui/input'
import { toast } from '@/lib/toast'
import { useProto } from '@/proto/store'
import { call, errText, useApi } from '@/state/client'

const STATE_DOT: Record<CustomBrick['state'], string> = { draft: 'bg-fg-4', review: 'bg-warn', approved: 'bg-ok' }

function BrickRequest({ onDone }: { onDone: () => void }) {
  const state = useProto()
  const [text, setText] = useState('')
  const [channel, setChannel] = useState('')
  const [busy, setBusy] = useState(false)
  const send = async (): Promise<void> => {
    setBusy(true)
    try {
      const id = /^db-(\d+)$/.exec(channel)?.[1]
      await call('bricks.request', { channelId: id ? Number(id) : null, text })
      toast.success(t('prod.res.custom.sent'))
      onDone()
    } catch (e) {
      toast.error(errText(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="card mb-3 flex flex-col gap-3 p-4" data-testid="brick-request">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="brick-channel">{t('prod.res.custom.askChannel')}</Label>
        <Select id="brick-channel" value={channel} onChange={(e) => setChannel(e.target.value)}>
          <option value="">{t('prod.res.custom.askAny')}</option>
          {state.channels.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="brick-text">{t('prod.res.custom.askTitle')}</Label>
        <Textarea id="brick-text" rows={3} value={text} placeholder={t('prod.res.custom.askPlaceholder')} onChange={(e) => setText(e.target.value)} />
      </div>
      <div className="flex justify-end">
        <Button size="sm" disabled={busy || !text.trim()} onClick={() => void send()} data-testid="brick-request-send">
          {t('prod.res.custom.send')}
        </Button>
      </div>
    </div>
  )
}

function BrickItem({ brick, channel, reload }: { brick: CustomBrick; channel: string | null; reload: () => void }) {
  const [refusing, setRefusing] = useState(false)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const act = async (work: () => Promise<unknown>, done: MessageKey): Promise<void> => {
    setBusy(true)
    try {
      await work()
      toast.success(t(done))
      setRefusing(false)
      reload()
    } catch (e) {
      toast.error(errText(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <article data-testid={`custom-brick-${brick.slug}`} data-state={brick.state} className="card flex flex-col gap-3 p-4">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[13.5px] font-semibold tracking-[-0.01em] text-fg">{brick.name}</h3>
          <div className="truncate text-[12px] text-fg-3">
            {channel ?? '—'} · {t('prod.res.custom.version', { n: brick.version })}
            {brick.approvedVersion !== null && brick.approvedVersion !== brick.version ? ` · ${t('prod.res.custom.approvedVersion', { n: brick.approvedVersion })}` : ''}
          </div>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1.5 text-[11.5px] text-fg-3">
          <span aria-hidden className={`size-1.5 rounded-full ${STATE_DOT[brick.state]}`} />
          {t(`prod.res.custom.state.${brick.state}` as MessageKey)}
        </span>
      </div>
      {brick.description && <p className="line-clamp-2 text-[12.5px] leading-[1.45] text-fg-3">{brick.description}</p>}
      {brick.stills.length > 0 ? (
        <div className="grid grid-cols-3 gap-2">
          {brick.stills.map((s) => (
            <img key={s.share} src={s.dataUrl} alt={t('prod.res.custom.still', { n: Math.round(s.share * 100) })} className="aspect-video w-full rounded-md object-cover ring-1 ring-line" />
          ))}
        </div>
      ) : (
        <p className="text-[12px] text-fg-3">{t('prod.res.custom.noPreview')}</p>
      )}
      {brick.lintOk !== null && (
        <p className={`text-[12px] ${brick.lintOk ? 'text-ok' : 'text-warn'}`} title={brick.lint.join('\n')}>
          {t(brick.lintOk ? 'prod.res.custom.lintOk' : 'prod.res.custom.lintFail')}
        </p>
      )}
      {brick.note && brick.state === 'draft' && <p className="text-[12px] text-fg-2">{t('prod.res.custom.note', { note: brick.note })}</p>}
      {brick.state === 'review' && !refusing && (
        <div className="flex gap-2">
          <Button size="sm" disabled={busy} data-testid="brick-approve" onClick={() => void act(() => call('bricks.decide', brick.id, { approve: true }), 'prod.res.custom.approved')}>
            {t('prod.res.custom.approve')}
          </Button>
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => setRefusing(true)}>
            {t('prod.res.custom.refuse')}
          </Button>
        </div>
      )}
      {brick.state === 'review' && refusing && (
        <div className="flex flex-col gap-2">
          <Textarea rows={2} value={note} placeholder={t('prod.res.custom.refuseNote')} onChange={(e) => setNote(e.target.value)} />
          <div className="flex justify-end">
            <Button size="sm" disabled={busy || !note.trim()} onClick={() => void act(() => call('bricks.decide', brick.id, { approve: false, note }), 'prod.res.custom.refused')}>
              {t('prod.res.custom.refuseSend')}
            </Button>
          </div>
        </div>
      )}
      {brick.approvedVersion !== null && (
        <label className="flex items-center gap-2 text-[12.5px] text-fg-2">
          <input type="checkbox" checked={brick.enabled} disabled={busy} onChange={(e) => void act(() => call('bricks.setEnabled', brick.id, e.target.checked), e.target.checked ? 'prod.res.custom.used' : 'prod.res.custom.unused')} />
          {t(brick.enabled ? 'prod.res.custom.used' : 'prod.res.custom.unused')}
        </label>
      )}
    </article>
  )
}

/** The section, real mode only (the demo has no agent writing bricks). */
export function CustomBricks() {
  const state = useProto()
  const list = useApi('bricks.list', ['orchestra'])
  const [asking, setAsking] = useState(false)
  const bricks = list.data ?? []
  const nameOf = (channelId: number): string | null => state.channels.find((c) => c.id === `db-${channelId}`)?.name ?? null
  return (
    <section className="mb-9" data-testid="custom-bricks">
      <SectionHead
        title={t('prod.res.custom')}
        count={bricks.length}
        action={
          <Button variant="secondary" size="sm" data-testid="ask-brick" onClick={() => setAsking((a) => !a)}>
            <Sparkles />
            {t('prod.res.custom.ask')}
          </Button>
        }
      />
      <p className="mb-3 text-[12.5px] leading-[1.5] text-fg-3">{t('prod.res.custom.blurb')}</p>
      {asking && <BrickRequest onDone={() => setAsking(false)} />}
      {list.error && <p className="mb-3 text-[12.5px] text-warn">{list.error}</p>}
      {list.data && bricks.length === 0 && <p className="mb-3 text-[12.5px] text-fg-3">{t('prod.res.custom.empty')}</p>}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {bricks.map((b) => (
          <BrickItem key={b.id} brick={b} channel={nameOf(b.channelId)} reload={list.reload} />
        ))}
      </div>
    </section>
  )
}
