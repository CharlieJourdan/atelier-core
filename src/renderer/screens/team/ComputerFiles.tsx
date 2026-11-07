// Ordinateur › team files (a folder tree and a drop zone that hands files to the agents) and the agents' browsers.
import { ChevronRight, FileText, Folder, FolderOpen, Globe, Upload } from 'lucide-react'
import { useMemo, useState } from 'react'
import type * as React from 'react'
import { t } from '../../../shared/fr'
import { AgentAvatar, ChannelAvatar, fmtAgo } from '@/components/proto/kit'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'
import { BROWSER_SESSIONS, CHANNEL_FOLDERS, FILES, SHARED_FOLDERS, type BrowserSession, type TeamFile } from '@/proto/data-team-computer'
import type { ProtoChannel } from '@/proto/types'
import { DemoBadge } from '@/components/atelier/demo'
import { useProto } from '@/proto/store'
import { BlockTitle, Card, NewTag } from './atoms'
import { leadOf, type TeamAgent } from './model'

function sizeLabel(mb: number): string {
  return mb >= 1_000 ? `${(mb / 1_000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Go` : `${mb} Mo`
}

function FolderRow({ id, label, depth, selected, onSelect, icon }: { id: string; label: string; depth: 0 | 1 | 2; selected: boolean; onSelect: (id: string) => void; icon?: React.ReactNode }) {
  return (
    <button
      type="button"
      data-testid={`folder-${id}`}
      aria-current={selected ? 'true' : undefined}
      onClick={() => onSelect(id)}
      className={cn(
        'flex h-8 w-full items-center gap-2 rounded-[8px] pr-2 text-left text-[13px] outline-none transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring',
        depth === 0 ? 'pl-2' : depth === 1 ? 'pl-6' : 'pl-10',
        selected ? 'bg-selected text-fg' : 'text-fg-2 hover:bg-hover hover:text-fg'
      )}
    >
      {icon ?? (selected ? <FolderOpen className="size-4 shrink-0 text-fg-3" aria-hidden /> : <Folder className="size-4 shrink-0 text-fg-3" aria-hidden />)}
      <span className="truncate">{label}</span>
    </button>
  )
}

interface Added {
  folder: string
  file: TeamFile
}

const DROP_SAMPLES = ['interview-historien.mp4', 'logo-chaine-v2.png', 'musique-ambiance.wav', 'notes-tournage.pdf']

export function FilesCard({ channels, agents }: { channels: readonly ProtoChannel[]; agents: readonly TeamAgent[] }) {
  const first = channels[0]
  const [selected, setSelected] = useState<string>(first ? `${first.id}/rushes` : 'shared/gameplay')
  const [open, setOpen] = useState<Record<string, boolean>>(() => (first ? { [first.id]: true } : {}))
  const [added, setAdded] = useState<Added[]>([])
  const [over, setOver] = useState(false)
  // the beta: the files of the team computer are not wired yet; in real mode the block says it is an example
  const live = useProto().mode === 'live'

  const folderLabel = useMemo(() => {
    const shared = SHARED_FOLDERS.find((f) => f.id === selected)
    if (shared) return [t('team.pc.files.shared'), shared.label]
    const [chId, sub] = selected.split('/')
    const ch = channels.find((c) => c.id === chId)
    const subLabel = CHANNEL_FOLDERS.find((f) => f.suffix === sub)?.label ?? ''
    return [ch?.name ?? '', subLabel]
  }, [selected, channels])

  const owner = (() => {
    const chId = selected.split('/')[0]
    const lead = chId && chId !== 'shared' ? leadOf(agents, chId) : undefined
    return agents.find((a) => a.role === 'editor' && a.channelId === chId)?.name ?? lead?.name ?? agents.find((a) => a.role === 'principal')?.name ?? ''
  })()

  function addFiles(names: string[]) {
    const files = names.map<Added>((name, i) => ({ folder: selected, file: { name, sizeMb: 12 + ((name.length * 7 + i * 13) % 240), by: t('team.pc.files.you'), minutesAgo: 0, note: t('team.pc.files.analysed', { name: owner }) } }))
    setAdded((a) => [...files, ...a])
    toast.success(t('team.pc.files.dropped', { n: names.length }), t('team.pc.files.droppedHint', { name: owner }))
  }

  const rows: { file: TeamFile; isNew: boolean }[] = [...added.filter((a) => a.folder === selected).map((a) => ({ file: a.file, isNew: true })), ...(FILES[selected] ?? []).map((file) => ({ file, isNew: false }))]

  return (
    <Card data-testid="pc-files" className="overflow-hidden">
      <div className="border-b border-line px-5 py-4">
        <BlockTitle title={t('team.pc.files')} hint={t('team.pc.files.hint')} action={live ? <DemoBadge /> : undefined} />
      </div>
      <div className="grid md:grid-cols-[240px_1fr]">
        <nav aria-label={t('team.pc.files')} className="border-b border-line p-2.5 md:border-r md:border-b-0">
          <p className="px-2 pt-1 pb-1.5 text-[11.5px] font-medium text-fg-3">{t('team.pc.files.channels')}</p>
          {channels.map((ch) => {
            const isOpen = open[ch.id] ?? false
            return (
              <div key={ch.id}>
                <button
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() => setOpen((o) => ({ ...o, [ch.id]: !isOpen }))}
                  className="flex h-8 w-full items-center gap-2 rounded-[8px] pr-2 pl-1 text-left text-[13px] font-medium text-fg outline-none hover:bg-hover focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <ChevronRight className={cn('size-3.5 text-fg-3 transition-transform duration-150', isOpen && 'rotate-90')} aria-hidden />
                  <ChannelAvatar channel={ch} size={16} />
                  <span className="truncate">{ch.name}</span>
                </button>
                {isOpen && CHANNEL_FOLDERS.map((f) => <FolderRow key={f.suffix} id={`${ch.id}/${f.suffix}`} label={f.label} depth={1} selected={selected === `${ch.id}/${f.suffix}`} onSelect={setSelected} />)}
              </div>
            )
          })}
          <p className="px-2 pt-3 pb-1.5 text-[11.5px] font-medium text-fg-3">{t('team.pc.files.shared')}</p>
          {SHARED_FOLDERS.map((f) => (
            <FolderRow key={f.id} id={f.id} label={f.label} depth={0} selected={selected === f.id} onSelect={setSelected} />
          ))}
        </nav>
        <div className="min-w-0 p-5">
          <p className="mb-3 flex items-center gap-1.5 text-[12.5px] text-fg-3" data-testid="pc-files-path">
            {folderLabel.map((p, i) => (
              <span key={i} className={cn('flex items-center gap-1.5', i === folderLabel.length - 1 && 'font-medium text-fg')}>
                {i > 0 && <ChevronRight className="size-3" aria-hidden />}
                {p}
              </span>
            ))}
          </p>
          <div
            data-testid="pc-dropzone"
            onDragOver={(e) => {
              e.preventDefault()
              setOver(true)
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault()
              setOver(false)
              const names = Array.from(e.dataTransfer.files).map((f) => f.name)
              addFiles(names.length > 0 ? names : [DROP_SAMPLES[added.length % DROP_SAMPLES.length] as string])
            }}
            className={cn('flex flex-col items-center gap-1.5 rounded-[14px] border border-dashed px-4 py-6 text-center transition-colors', over ? 'border-line-3 bg-hover' : 'border-line-3')}
          >
            <Upload className="size-5 text-fg-3" aria-hidden />
            <p className="text-[13.5px] font-medium text-fg">{t('team.pc.drop')}</p>
            <p className="max-w-[360px] text-[12.5px] leading-[1.45] text-fg-3">{t('team.pc.drop.hint')}</p>
            <Button size="sm" variant="outline" className="mt-1.5" data-testid="pc-drop-pick" onClick={() => addFiles([DROP_SAMPLES[added.length % DROP_SAMPLES.length] as string])}>
              {t('team.pc.drop.pick')}
            </Button>
          </div>
          {rows.length === 0 ? (
            <p className="py-8 text-center text-[12.5px] text-fg-3">{t('team.pc.files.empty')}</p>
          ) : (
            <ul className="mt-4 divide-y divide-line" data-testid="pc-file-list">
              {rows.map(({ file, isNew }) => (
                <li key={`${file.name}-${isNew}`} className="flex items-center gap-3 py-2.5">
                  <FileText className="size-4 shrink-0 text-fg-3" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 truncate text-[13px] font-medium text-fg">
                      {file.name}
                      {isNew && <NewTag />}
                    </p>
                    {file.note && <p className="truncate text-[12px] text-fg-3">{file.note}</p>}
                  </div>
                  <span className="num w-16 shrink-0 text-right text-[12px] text-fg-3">{sizeLabel(file.sizeMb)}</span>
                  <span className="hidden w-24 shrink-0 truncate text-[12px] text-fg-3 sm:block">{file.by}</span>
                  <span className="num hidden w-24 shrink-0 text-right text-[12px] text-fg-3 sm:block">{fmtAgo(file.minutesAgo)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Card>
  )
}

function MockScreen({ session, agentName }: { session: BrowserSession; agentName: string }) {
  return (
    <div data-testid="pc-browser-screen" className="overflow-hidden rounded-[12px] border border-line-2 bg-surface-2">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <span className="size-2.5 rounded-full bg-fg-4/70" aria-hidden />
        <span className="size-2.5 rounded-full bg-fg-4/70" aria-hidden />
        <span className="size-2.5 rounded-full bg-fg-4/70" aria-hidden />
        <span className="ml-2 flex min-w-0 flex-1 items-center gap-1.5 rounded-full bg-surface-1 px-3 py-1 text-[11.5px] text-fg-3">
          <Globe className="size-3 shrink-0" aria-hidden />
          <span className="truncate">{session.url}</span>
        </span>
      </div>
      <div className="px-5 py-4">
        <p className="text-[14px] font-semibold tracking-[-0.01em] text-fg">{session.pageTitle}</p>
        <ul className="mt-3 flex flex-col gap-2">
          {session.lines.map((l, i) => (
            <li key={l} className={cn('rounded-[8px] border border-line px-3 py-2 text-[12.5px] text-fg-2', i === 0 && 'border-line-3 bg-surface-1')}>
              {l}
            </li>
          ))}
        </ul>
        <p className="mt-4 text-[12px] text-fg-3">{t('team.pc.browsers.caption', { name: agentName })}</p>
      </div>
    </div>
  )
}

export function BrowsersCard({ agents }: { agents: readonly TeamAgent[] }) {
  const [watching, setWatching] = useState<string | null>(null)
  const live = useProto().mode === 'live'
  const sessions = BROWSER_SESSIONS.flatMap((s) => {
    const agent = agents.find((a) => a.id === s.agentId)
    return agent ? [{ s, agent }] : []
  })
  const current = sessions.find((x) => x.s.id === watching)
  return (
    <Card data-testid="pc-browsers" className="p-5">
      <BlockTitle title={t('team.pc.browsers')} hint={t('team.pc.browsers.hint')} action={live ? <DemoBadge /> : undefined} />
      <ul className="mt-4 flex flex-col divide-y divide-line">
        {sessions.map(({ s, agent }) => (
          <li key={s.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
            <AgentAvatar agent={agent} size={28} showStatus={false} />
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-x-2 text-[13px] font-medium text-fg">
                {agent.name}
                <span className="inline-flex items-center gap-1 rounded-full border border-line-2 px-2 py-px text-[11px] font-normal text-fg-3">
                  <Globe className="size-3" aria-hidden />
                  {s.site}
                </span>
              </p>
              <p className="mt-0.5 text-[12.5px] leading-[1.45] text-fg-2">{s.doing}</p>
            </div>
            <Button size="sm" variant="outline" data-testid={`pc-browser-view-${s.id}`} onClick={() => setWatching(s.id)}>
              {t('team.pc.browsers.view')}
            </Button>
          </li>
        ))}
      </ul>
      <Dialog open={current !== undefined} onOpenChange={(o) => !o && setWatching(null)}>
        <DialogContent className="w-[min(560px,94vw)]" closeLabel={t('common.close')}>
          <DialogHeader>
            <DialogTitle className="text-[18px] font-semibold tracking-[-0.018em]">{t('team.pc.browsers.screenOf', { name: current?.agent.name ?? '' })}</DialogTitle>
            <DialogDescription>{current?.s.doing}</DialogDescription>
          </DialogHeader>
          {current && <MockScreen session={current.s} agentName={current.agent.name} />}
        </DialogContent>
      </Dialog>
    </Card>
  )
}
