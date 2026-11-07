// Production › Idées: one idea card. Real actions only: keep, drop, create the video, delete.
import { Check, Clapperboard, Sparkles, Trash2, X } from 'lucide-react'
import { t } from '../../../shared/fr'
import type { IdeaRow } from '../../../shared/api/ideas'
import { ExampleBadge, fmtDate } from '@/components/atelier/kit'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { ideaStatusLabel } from './common'

const STATUS_TONE = { new: 'brand', kept: 'ok', rejected: 'outline', used: 'default' } as const

export interface IdeaActions {
  onKeep: (i: IdeaRow) => void
  onReject: (i: IdeaRow) => void
  onCreate: (i: IdeaRow) => void
  onDelete: (i: IdeaRow) => void
}

export function IdeaCard({ idea, busy, ...actions }: { idea: IdeaRow; busy?: boolean } & IdeaActions) {
  const used = idea.status === 'used'
  return (
    <li
      data-testid="idea-card"
      data-status={idea.status}
      className={cn('flex flex-col gap-3 rounded-card border border-line bg-surface-1 p-4 transition-colors hover:border-line-3', idea.status === 'rejected' && 'opacity-70')}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={STATUS_TONE[idea.status]}>{ideaStatusLabel(idea.status)}</Badge>
        <span className="text-[12px] text-fg-3">{idea.channelName}</span>
        {idea.example && <ExampleBadge />}
        {idea.source === 'agent' ? (
          <span className="inline-flex items-center gap-1 text-[11.5px] text-fg-3">
            <Sparkles className="size-3" aria-hidden /> {t('ideas.source.agent')}
          </span>
        ) : (
          <span className="text-[11.5px] text-fg-3">{t('ideas.source.manual')}</span>
        )}
        {idea.score !== null && (
          <span className="ml-auto font-mono text-[11.5px] text-fg-2 tabular-nums" title={t('ideas.score.hint')}>
            {t('ideas.score', { n: idea.score })}
          </span>
        )}
      </div>
      <div>
        <h3 className="text-[15px] leading-snug font-medium text-fg">{idea.title}</h3>
        {idea.angle && <p className="mt-1 text-[13px] text-fg-2">{idea.angle}</p>}
      </div>
      <div className="mt-auto flex flex-wrap items-center gap-2">
        {!used && idea.status !== 'kept' && (
          <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => actions.onKeep(idea)}>
            <Check /> {t('ideas.keep')}
          </Button>
        )}
        {!used && idea.status !== 'rejected' && (
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => actions.onReject(idea)}>
            <X /> {t('ideas.reject')}
          </Button>
        )}
        {idea.videoId === null && idea.status !== 'rejected' && (
          <Button type="button" size="sm" disabled={busy} onClick={() => actions.onCreate(idea)}>
            <Clapperboard /> {t('ideas.createVideo')}
          </Button>
        )}
        {idea.videoId !== null && <span className="text-[12px] text-fg-3">{t('ideas.videoCreated')}</span>}
        <span className="ml-auto text-[11.5px] text-fg-3">{fmtDate(idea.createdAt)}</span>
        <Button type="button" variant="ghost" size="icon-sm" disabled={busy} aria-label={t('ideas.delete')} onClick={() => actions.onDelete(idea)}>
          <Trash2 />
        </Button>
      </div>
    </li>
  )
}
