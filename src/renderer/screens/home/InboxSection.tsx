// "À valider": what waits for the user, one row per inbox item with the one inline action that fits its kind. Every
// action ends in `resolveInbox`; the row then folds away. Heavier choices (read a script, import files, pick ideas)
// open a Dialog from InboxDialogs.tsx.
import { Check, FileText, ListChecks, Upload } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { t } from '../../../shared/fr'
import { AgentAvatar, ChannelTag, fmtAgo, SectionHead, Thumb } from '@/components/proto/kit'
import { Button } from '@/components/ui/button'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'
import { channelOf, useProto, useProtoActions } from '@/proto/store'
import type { InboxAnswer, InboxItem } from '@/proto/types'
import { InboxDialog, type DialogKind } from './InboxDialogs'
import { LiveInboxDialog, liveActionLabel } from './LiveInboxDialog'

/** Which dialog (if any) an item opens. */
export function dialogKindOf(item: InboxItem): DialogKind | null {
  // an agent asks for a script (agents-production): « Importer le script » sends the text as its answer
  if (item.live?.source === 'orchestra' && (item.live.kind === 'files' || item.live.kind === 'input') && /script/i.test(item.title)) return 'import-script'
  if (item.live) return null
  if (item.kind === 'validate-script') return 'script'
  if (item.kind === 'validate-idea') return 'ideas'
  if (item.kind === 'upload-input') return /script/i.test(item.title) ? 'import-script' : 'import-files'
  return null
}

function actionLabel(item: InboxItem): string {
  if (dialogKindOf(item) === 'import-script') return t('home.dash.action.importScript')
  if (item.live) return liveActionLabel(item)
  switch (item.kind) {
    case 'validate-script':
      return t('home.dash.action.readScript')
    case 'validate-idea':
      return t('home.dash.action.pickIdeas')
    case 'validate-director':
      return t('home.dash.action.validatePlan')
    case 'approve-publish':
      return t('home.dash.action.approve')
    case 'validate-thumbnail':
      return t('home.dash.action.chooseThumb')
    case 'upload-input':
      return /script/i.test(item.title) ? t('home.dash.action.importScript') : t('home.dash.action.dropFiles')
  }
}

function ThumbPicker({ hue, format, value, onChange }: { hue: number; format: 'long' | 'short'; value: number; onChange: (i: number) => void }) {
  const hues = [hue, (hue + 55) % 360, (hue + 200) % 360]
  return (
    <div role="radiogroup" aria-label={t('home.dash.thumbs')} className="mt-2.5 flex gap-2.5" data-testid="thumb-picker">
      {hues.map((h, i) => {
        const on = i === value
        return (
          <button
            key={h}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={t('home.dash.thumb', { n: i + 1 })}
            onClick={() => onChange(i)}
            className={cn(
              'relative rounded-[12px] p-0.5 outline-none transition-colors focus-visible:outline-2 focus-visible:outline-ring',
              on ? 'ring-2 ring-ink' : 'ring-1 ring-transparent hover:ring-line-3'
            )}
          >
            <Thumb hue={h} format={format} className="w-[116px] rounded-[10px]">
              <span className="absolute bottom-1.5 left-1.5 flex size-5 items-center justify-center rounded-full bg-black/55 text-[10.5px] font-semibold text-white">
                {on ? <Check className="size-3" strokeWidth={3} aria-hidden /> : String.fromCharCode(65 + i)}
              </span>
            </Thumb>
          </button>
        )
      })}
    </div>
  )
}

function Row({
  item,
  first,
  leaving,
  onResolve,
  onOpen,
  onOpenLive
}: {
  item: InboxItem
  first: boolean
  leaving: boolean
  onResolve: (item: InboxItem, message: string) => void
  onOpen: (item: InboxItem, kind: DialogKind) => void
  onOpenLive: (item: InboxItem) => void
}) {
  const state = useProto()
  const agent = state.agents.find((a) => a.id === item.agentId)
  const channel = channelOf(state, item.channelId)
  const video = state.videos.find((v) => v.id === item.videoId)
  const [pick, setPick] = useState(0)
  const kind = dialogKindOf(item)
  const isUpload = item.kind === 'upload-input'

  const onClick = () => {
    if (kind) onOpen(item, kind)
    else if (item.live) onOpenLive(item)
    else if (item.kind === 'validate-thumbnail') onResolve(item, t('home.dash.done.thumb', { n: pick + 1 }))
    else onResolve(item, t('home.dash.done.generic'))
  }

  const Icon = isUpload ? Upload : item.kind === 'validate-idea' ? ListChecks : item.kind === 'validate-script' ? FileText : Check

  return (
    <li
      data-testid="inbox-row"
      data-kind={item.kind}
      aria-hidden={leaving || undefined}
      className={cn('grid transition-[grid-template-rows,opacity] duration-300 ease-out', leaving ? 'grid-rows-[0fr] opacity-0' : 'grid-rows-[1fr] opacity-100')}
    >
      <div className="min-h-0 overflow-hidden">
        <div className={cn('px-4 py-3', !first && 'border-t border-line')}>
          <div className="flex items-center gap-3">
            {agent ? <AgentAvatar agent={agent} size={28} /> : <span className="size-7 rounded-full bg-surface-3" aria-hidden />}
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13.5px] font-medium text-fg">{item.title}</p>
              <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[12px] text-fg-3">
                <ChannelTag channel={channel} className="shrink-0" />
                <span aria-hidden>·</span>
                <span className="truncate">{item.detail}</span>
                <span aria-hidden className="shrink-0">·</span>
                <span className="shrink-0 whitespace-nowrap">{fmtAgo(item.minutesAgo)}</span>
              </p>
            </div>
            <Button
              size="sm"
              variant={isUpload ? 'outline' : 'default'}
              onClick={onClick}
              data-testid={`inbox-action-${item.id}`}
              className={cn('shrink-0', isUpload && 'border-dashed')}
            >
              <Icon aria-hidden />
              {actionLabel(item)}
            </Button>
          </div>
          {item.kind === 'validate-thumbnail' && (
            <div className="pl-10">
              <ThumbPicker hue={video?.thumbHue ?? 200} format={video?.format ?? 'long'} value={pick} onChange={setPick} />
            </div>
          )}
        </div>
      </div>
    </li>
  )
}

export function InboxSection({ items }: { items: InboxItem[] }) {
  const { resolveInbox } = useProtoActions()
  const [leaving, setLeaving] = useState<string[]>([])
  const [dialog, setDialog] = useState<{ item: InboxItem; kind: DialogKind } | null>(null)
  const [liveItem, setLiveItem] = useState<InboxItem | null>(null)
  const timers = useRef<number[]>([])
  useEffect(() => () => timers.current.forEach((id) => window.clearTimeout(id)), [])

  const resolve = (item: InboxItem, message: string, answer: InboxAnswer = {}) => {
    setLeaving((l) => [...l, item.id])
    setDialog(null)
    setLiveItem(null)
    toast.success(message)
    timers.current.push(window.setTimeout(() => resolveInbox(item.id, answer), 320))
  }

  const visible = items.length
  return (
    <section data-testid="home-inbox" aria-label={t('home.dash.inbox')}>
      <SectionHead title={t('home.dash.inbox')} count={visible} />
      {visible === 0 ? (
        <div className="rounded-[16px] border border-dashed border-line-2 px-5 py-8 text-center" data-testid="inbox-empty">
          <p className="text-[14px] font-medium text-fg">{t('home.dash.inbox.empty')}</p>
          <p className="mt-1 text-[12.5px] text-fg-3">{t('home.dash.inbox.empty.hint')}</p>
        </div>
      ) : (
        <ul className="overflow-hidden rounded-[16px] border border-line-2 bg-surface-1">
          {items.map((item, i) => (
            <Row key={item.id} item={item} first={i === 0} leaving={leaving.includes(item.id)} onResolve={resolve} onOpen={(it, kind) => setDialog({ item: it, kind })} onOpenLive={setLiveItem} />
          ))}
        </ul>
      )}
      {liveItem && <LiveInboxDialog item={liveItem} onClose={() => setLiveItem(null)} onDone={(answer, message) => resolve(liveItem, message, answer)} />}
      {dialog && <InboxDialog item={dialog.item} kind={dialog.kind} onClose={() => setDialog(null)} onDone={(message, answer) => resolve(dialog.item, message, answer)} />}
    </section>
  )
}
