// « Idées »: a three-column board (proposées, validées, en production). Validate moves a card on, Lancer creates the
// video in the channel's pipeline. « Demander 5 idées » asks the research agent for five more, with a short shimmer.
import { Binoculars, Check, MessageSquareText, Pencil, PenLine, Rocket, Sparkles, Trash2, TrendingUp } from 'lucide-react'
import { t, type MessageKey } from '../../../shared/fr'
import { ChannelTag, fmtCompact, ProgressRing } from '@/components/proto/kit'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import type { Idea, IdeaColumn, IdeaSource } from '@/proto/data-brain'
import { channelOf, useProto } from '@/proto/store'

const COLUMNS: IdeaColumn[] = ['proposed', 'validated', 'production']

const SOURCE_ICON = { competitor: Binoculars, trend: TrendingUp, comment: MessageSquareText, atlas: Sparkles, manual: PenLine } as const satisfies Record<IdeaSource, unknown>

function SourceLine({ source, agentName }: { source: IdeaSource; agentName: string }) {
  const Icon = SOURCE_ICON[source]
  return (
    <p className="flex items-center gap-1.5 text-[12px] text-fg-3" data-source={source}>
      <Icon className="size-3.5 shrink-0" aria-hidden />
      <span className="truncate">{source === 'atlas' ? t('brain.source.atlas', { name: agentName }) : t(`brain.source.${source}` as MessageKey)}</span>
    </p>
  )
}

/** Real mode: an idea can be edited and deleted (the demo board has neither). */
export interface IdeaEdits {
  onEdit: (idea: Idea) => void
  onDelete: (id: string) => void
}

function IdeaCard({ idea, onMove, edits }: { idea: Idea; onMove: (id: string, column: IdeaColumn) => void; edits?: IdeaEdits | undefined }) {
  const state = useProto()
  const channel = channelOf(state, idea.channelId)
  return (
    <article data-testid="idea-card" data-idea={idea.id} data-column={idea.column} className="rounded-[14px] border border-line-2 bg-surface-1 p-3.5">
      <div className="flex items-start gap-3">
        <h3 className="min-w-0 flex-1 text-[14px] leading-[1.35] font-medium tracking-[-0.006em] text-fg">{idea.title}</h3>
        <ProgressRing value={idea.potential} size={34} stroke={3} className="mt-0.5">
          <span className="num text-[11px] font-medium text-fg" title={idea.unscored ? t('brain.idea.unscored') : t('brain.idea.potential')}>
            {idea.unscored ? '—' : idea.potential}
          </span>
        </ProgressRing>
      </div>
      <p className="mt-1.5 text-[12.5px] leading-[1.5] text-fg-3">{idea.angle}</p>
      <div className="mt-3 space-y-1">
        <ChannelTag channel={channel} />
        <SourceLine source={idea.source} agentName={state.principalName} />
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1">
          {idea.estViews > 0 && <p className="num min-w-0 truncate text-[12px] text-fg-3">{t('brain.idea.views', { n: fmtCompact(idea.estViews) })}</p>}
          {edits && (
            <>
              <button
                type="button"
                aria-label={t('brain.idea.edit')}
                title={t('brain.idea.edit')}
                onClick={() => edits.onEdit(idea)}
                data-testid="idea-edit"
                className="flex size-7 items-center justify-center rounded-full text-fg-3 hover:bg-hover hover:text-fg"
              >
                <Pencil className="size-3.5" aria-hidden />
              </button>
              <button
                type="button"
                aria-label={t('brain.idea.delete')}
                title={t('brain.idea.delete')}
                onClick={() => edits.onDelete(idea.id)}
                data-testid="idea-delete"
                className="flex size-7 items-center justify-center rounded-full text-fg-3 hover:bg-hover hover:text-err"
              >
                <Trash2 className="size-3.5" aria-hidden />
              </button>
            </>
          )}
        </div>
        {idea.column === 'proposed' && (
          <Button size="sm" variant="outline" onClick={() => onMove(idea.id, 'validated')} data-testid="idea-validate">
            <Check aria-hidden />
            {t('brain.idea.validate')}
          </Button>
        )}
        {idea.column === 'validated' && (
          <Button size="sm" onClick={() => onMove(idea.id, 'production')} data-testid="idea-launch">
            <Rocket aria-hidden />
            {t('brain.idea.launch')}
          </Button>
        )}
        {idea.column === 'production' && <span className="shrink-0 text-[12px] font-medium text-fg-2">{t('brain.idea.launched')}</span>}
      </div>
    </article>
  )
}

function SkeletonCard() {
  return (
    <div className="rounded-[14px] border border-line-2 bg-surface-1 p-3.5" aria-hidden data-testid="idea-skeleton">
      <Skeleton className="h-4 w-[85%]" />
      <Skeleton className="mt-2 h-3 w-full" />
      <Skeleton className="mt-1.5 h-3 w-[70%]" />
      <Skeleton className="mt-4 h-3 w-[40%]" />
    </div>
  )
}

export function IdeasBoard({ ideas, generating, onMove, edits }: { ideas: Idea[]; generating: boolean; onMove: (id: string, column: IdeaColumn) => void; edits?: IdeaEdits }) {
  return (
    <div className="grid gap-4 @[760px]:grid-cols-3" data-testid="ideas-board">
      {COLUMNS.map((col) => {
        const items = ideas.filter((i) => i.column === col).sort((a, b) => b.potential - a.potential)
        return (
          <section
            key={col}
            aria-label={t(`brain.col.${col}` as MessageKey)}
            data-testid={`ideas-col-${col}`}
            className="min-w-0 rounded-[16px] bg-surface-2 p-2.5"
          >
            <h2 className="flex items-center gap-2 px-1.5 pt-1 pb-2.5 text-[13.5px] font-semibold tracking-[-0.01em] text-fg">
              {t(`brain.col.${col}` as MessageKey)}
              <span className="num rounded-full bg-surface-3 px-1.5 py-px text-[11px] font-medium text-fg-3">
                {items.length + (col === 'proposed' && generating ? 5 : 0)}
              </span>
            </h2>
            <div className={cn('space-y-2.5')}>
              {col === 'proposed' && generating && Array.from({ length: 5 }, (_, i) => <SkeletonCard key={i} />)}
              {items.map((idea) => (
                <IdeaCard key={idea.id} idea={idea} onMove={onMove} edits={edits} />
              ))}
              {items.length === 0 && !(col === 'proposed' && generating) && (
                <p className="px-2 py-6 text-center text-[12.5px] text-fg-3">{t(`brain.col.${col}.empty` as MessageKey)}</p>
              )}
            </div>
          </section>
        )
      })}
    </div>
  )
}
