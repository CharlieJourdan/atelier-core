// The review of one node's result, by output kind (script, voice, edit plan with prices, stills, captions, music,
// video, package). Media come through `production.file` as blob URLs, revoked when the panel goes away.
import { FolderOpen } from 'lucide-react'
import { useState } from 'react'
import { t } from '../../../../shared/fr'
import type { RunFileRef, RunOutput } from '../../../../shared/runs'
import { DemoBadge } from '@/components/atelier/demo'
import { DataTable, fmtCredits, fmtInt } from '@/components/atelier/kit'
import { Button } from '@/components/ui/button'
import { toast } from '@/lib/toast'
import { call, errText } from '@/state/client'
import { AudioPlayerButton, AudioPlayerDuration, AudioPlayerProgress, AudioPlayerProvider, AudioPlayerTime } from '@/vendor/elevenlabs-ui'
import { diffLines, fmtBytes, fmtClock, fmtDuration, useFileUrl } from '../shared'

type Out<K extends RunOutput['kind']> = Extract<RunOutput, { kind: K }>

const MAX_STILLS = 48

function MediaError({ message }: { message: string }) {
  return <p className="m-0 rounded-field border border-line bg-surface-2 px-3 py-2 text-[12.5px] text-fg-3">{message}</p>
}

export function AudioReview({ runId, file, label }: { runId: number; file: RunFileRef; label?: string }) {
  const f = useFileUrl(runId, file.ref)
  if (f.error) return <MediaError message={f.error} />
  return (
    <AudioPlayerProvider>
      <div className="flex items-center gap-3" data-testid="audio-player">
        {f.url ? <AudioPlayerButton item={{ id: file.ref, src: f.url }} variant="default" size="icon" aria-label={label ?? t('production.review.play')} /> : <span className="size-9 rounded-full bg-surface-2" aria-hidden />}
        <AudioPlayerTime className="text-xs text-fg-3" />
        <AudioPlayerProgress className="flex-1" />
        <AudioPlayerDuration className="text-xs text-fg-3" />
      </div>
    </AudioPlayerProvider>
  )
}

export function VideoPlayer({ runId, file, className }: { runId: number; file: RunFileRef; className?: string }) {
  const f = useFileUrl(runId, file.ref)
  if (f.error) return <MediaError message={f.error} />
  if (!f.url) return <div className="aspect-video w-full animate-pulse rounded-card bg-surface-2" aria-busy="true" />
  return <video src={f.url} controls preload="metadata" className={className ?? 'aspect-video w-full rounded-card bg-black'} data-testid="video-player" />
}

export function Still({ runId, file, alt }: { runId: number; file: RunFileRef; alt: string }) {
  const f = useFileUrl(runId, file.ref)
  if (f.error) return <div className="flex aspect-video items-center justify-center rounded-field bg-surface-2 px-2 text-center text-[11px] text-fg-3">{f.error}</div>
  if (!f.url) return <div className="aspect-video animate-pulse rounded-field bg-surface-2" aria-busy="true" />
  return <img src={f.url} alt={alt} className="aspect-video w-full rounded-field bg-surface-2 object-cover" loading="lazy" />
}

export function FileList({ files }: { files: RunFileRef[] }) {
  if (files.length === 0) return null
  return (
    <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[12.5px] text-fg-2" aria-label={t('production.review.files')}>
      {files.map((f) => (
        <li key={f.ref} className="flex justify-between gap-3">
          <span className="truncate">{f.name.replace(/^\d+-/, '')}</span>
          <span className="text-fg-3 tabular-nums">{fmtBytes(f.size)}</span>
        </li>
      ))}
    </ul>
  )
}

function ScriptReview({ out }: { out: Out<'text'> }) {
  const [compare, setCompare] = useState(false)
  const parts = compare && out.previous !== null ? diffLines(out.previous, out.text) : null
  return (
    <div className="flex flex-col gap-3" data-testid="review-text">
      <div className="flex items-center gap-3 text-[12px] text-fg-3">
        <span>{t('production.review.words', { n: fmtInt(out.words) })}</span>
        {out.demo && <DemoBadge />}
        {out.previous !== null && (
          <Button type="button" variant="ghost" size="sm" className="ml-auto" onClick={() => setCompare((c) => !c)} aria-pressed={compare}>
            {compare ? t('production.review.hideDiff') : t('production.review.showDiff')}
          </Button>
        )}
      </div>
      {out.outline && (
        <div className="text-[12.5px] text-fg-2">
          <p className="m-0 font-medium text-fg">{out.outline.title}</p>
          <ol className="m-0 mt-1 list-decimal pl-5">
            {out.outline.sections.map((s, i) => (
              <li key={`${i}-${s}`}>{s}</li>
            ))}
          </ol>
        </div>
      )}
      <div className="max-h-[360px] overflow-auto rounded-field border border-line bg-surface-2 p-3 text-[13px] leading-[1.55] text-fg-2" tabIndex={0}>
        {parts ? (
          parts.map((p, i) => (
            <p
              key={i}
              data-diff={p.kind}
              className={p.kind === 'add' ? 'm-0 bg-ok/10 text-fg' : p.kind === 'del' ? 'm-0 bg-err/10 text-fg-3 line-through' : 'm-0'}
            >
              {p.text || ' '}
            </p>
          ))
        ) : (
          <p className="m-0 whitespace-pre-wrap">{out.text}</p>
        )}
      </div>
    </div>
  )
}

function EditPlanReview({ out }: { out: Out<'editplan'> }) {
  return (
    <div className="flex flex-col gap-3" data-testid="review-editplan">
      <dl className="m-0 grid grid-cols-4 gap-3 text-[12px]">
        {[
          [t('production.review.plan.duration'), fmtDuration(out.durationS)],
          [t('production.review.plan.shots'), fmtInt(out.totals.shots)],
          [t('production.review.plan.items'), fmtInt(out.totals.items)],
          [t('production.review.plan.price'), fmtCredits(out.totals.credits)]
        ].map(([k, v]) => (
          <div key={k}>
            <dt className="micro-label">{k}</dt>
            <dd className="m-0 font-serif text-[22px] leading-tight">{v}</dd>
          </div>
        ))}
      </dl>
      {out.chapters.length > 0 && (
        <p className="m-0 text-[12px] text-fg-3">{out.chapters.map((c) => `${fmtClock(c.start)} ${c.title}`).join(' · ')}</p>
      )}
      <DataTable
        testId="plan-items"
        rows={out.items}
        rowKey={(r) => r.id}
        empty={t('production.review.plan.none')}
        columns={[
          { key: 'kind', header: t('production.review.plan.kind'), cell: (r) => r.kind },
          { key: 'prompt', header: t('production.review.plan.prompt'), cell: (r) => <span className="line-clamp-2 max-w-[38ch]">{r.prompt}</span> },
          { key: 'units', header: t('production.review.plan.units'), align: 'right', cell: (r) => fmtInt(r.units) },
          { key: 'shots', header: t('production.review.plan.usedBy'), align: 'right', cell: (r) => fmtInt(r.shotIds.length) },
          { key: 'credits', header: t('production.review.plan.price'), align: 'right', cell: (r) => (r.credits === 0 ? t('production.new.free') : fmtCredits(r.credits)) }
        ]}
      />
      <p className="m-0 text-[11.5px] text-fg-3">{t('production.review.plan.note')}</p>
    </div>
  )
}

function StillsReview({ runId, out }: { runId: number; out: Out<'images'> }) {
  const shown = out.images.slice(0, MAX_STILLS)
  return (
    <div className="flex flex-col gap-3" data-testid="review-images">
      {out.demo && (
        <div className="flex items-center gap-2 text-[12px] text-fg-3">
          <DemoBadge />
          {t('production.review.stills.demo')}
        </div>
      )}
      {shown.length === 0 ? (
        <MediaError message={t('production.review.stills.none')} />
      ) : (
        <ul className="m-0 grid list-none grid-cols-2 gap-3 p-0 md:grid-cols-3">
          {shown.map((im) => (
            <li key={im.file.ref} className="flex flex-col gap-1">
              <Still runId={runId} file={im.file} alt={im.prompt || im.itemId} />
              <span className="line-clamp-2 text-[11.5px] text-fg-3">{im.beat !== null ? `${t('production.review.stills.beat', { n: im.beat + 1 })} · ` : ''}{im.prompt}</span>
            </li>
          ))}
        </ul>
      )}
      {out.images.length > MAX_STILLS && <p className="m-0 text-[12px] text-fg-3">{t('production.review.stills.more', { n: out.images.length - MAX_STILLS })}</p>}
    </div>
  )
}

function PackageReview({ runId, out }: { runId: number; out: Out<'package'> }) {
  const open = async (): Promise<void> => {
    try {
      await call('production.revealPackage', runId)
    } catch (err) {
      toast.error(errText(err))
    }
  }
  return (
    <div className="flex flex-col gap-3 text-[13px] text-fg-2" data-testid="review-package">
      <div className="flex items-start gap-3">
        <div className="flex-1">
          <p className="m-0 font-serif text-[22px] leading-tight text-fg">{out.title}</p>
          {out.alternatives.length > 0 && <p className="m-0 mt-1 text-[12px] text-fg-3">{t('production.review.pkg.alts', { list: out.alternatives.join(' · ') })}</p>}
        </div>
        {out.demo && <DemoBadge />}
      </div>
      <p className="m-0 max-h-40 overflow-auto whitespace-pre-wrap rounded-field border border-line bg-surface-2 p-3" tabIndex={0}>{out.description}</p>
      {out.chapters.length > 0 && (
        <ul className="m-0 list-none p-0 text-[12.5px]">
          {out.chapters.map((c) => (
            <li key={`${c.at}-${c.title}`}>
              <span className="tabular-nums text-fg-3">{fmtClock(c.at)}</span> {c.title}
            </li>
          ))}
        </ul>
      )}
      {out.tags.length > 0 && <p className="m-0 text-[12px] text-fg-3">{out.tags.join(', ')}</p>}
      <FileList files={out.files} />
      {out.folder && (
        <Button type="button" variant="secondary" size="sm" className="self-start" onClick={() => void open()}>
          <FolderOpen aria-hidden />
          {t('production.review.pkg.open')}
        </Button>
      )}
    </div>
  )
}

/** Renders the node's output for review. */
export function OutputView({ runId, out }: { runId: number; out: RunOutput }) {
  switch (out.kind) {
    case 'unavailable':
      return <MediaError message={out.message} />
    case 'text':
      return <ScriptReview out={out} />
    case 'audio':
      return (
        <div className="flex flex-col gap-2" data-testid="review-audio">
          <AudioReview runId={runId} file={out.file} />
          <p className="m-0 text-[12px] text-fg-3">
            {[out.voiceUsed ? t('production.review.voice', { name: out.voiceUsed }) : null, out.durationS !== null ? fmtDuration(out.durationS) : null, t('production.review.words', { n: fmtInt(out.words.length) })]
              .filter(Boolean)
              .join(' · ')}
          </p>
          {out.demo && <div><DemoBadge /></div>}
        </div>
      )
    case 'editplan':
      return <EditPlanReview out={out} />
    case 'images':
      return <StillsReview runId={runId} out={out} />
    case 'captions':
      return (
        <div className="flex flex-col gap-2" data-testid="review-captions">
          <p className="m-0 text-[12px] text-fg-3">
            {[out.preset, out.burn ? t('production.review.captions.burn') : t('production.review.captions.srt'), t('production.review.captions.cues', { n: out.cues })].filter(Boolean).join(' · ')}
          </p>
          <pre className="m-0 max-h-60 overflow-auto rounded-field border border-line bg-surface-2 p-3 font-mono text-[12px] text-fg-2" tabIndex={0}>{out.srt}</pre>
        </div>
      )
    case 'music':
      return (
        <div className="flex flex-col gap-2" data-testid="review-music">
          <AudioReview runId={runId} file={out.file} />
          {out.demo && <div><DemoBadge /></div>}
        </div>
      )
    case 'video':
      return (
        <div className="flex flex-col gap-2" data-testid="review-video">
          <VideoPlayer runId={runId} file={out.file} />
          <p className="m-0 text-[12px] text-fg-3">
            {[out.width && out.height ? `${out.width}×${out.height}` : null, fmtDuration(out.durationS), fmtBytes(out.file.size)].filter(Boolean).join(' · ')}
          </p>
        </div>
      )
    case 'package':
      return <PackageReview runId={runId} out={out} />
    case 'json':
      return (
        <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[12.5px] text-fg-2" data-testid="review-json">
          {Object.entries(out.outputs).map(([name, o]) => (
            <li key={name} className="flex justify-between gap-3">
              <span>{name}</span>
              <span className="text-fg-3">{o.files.length > 0 ? t('production.review.json.files', { n: o.files.length }) : o.type}</span>
            </li>
          ))}
        </ul>
      )
  }
}
