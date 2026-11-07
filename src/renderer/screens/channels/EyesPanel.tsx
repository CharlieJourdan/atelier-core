// Chaînes › fiche › Styles, real mode: « Les yeux ». The competitors the channel follows, a read of their public numbers (through
// Atelier Cloud, YouTube Data API, read-only), the videos that did far better than the rest of their channel, the analysis of the
// best of them (billed in credits, only when asked) and the channel's style profile built from it, editable and versioned.
import { Eye, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { t } from '../../../shared/fr'
import type { EyesDetail, OutlierRow } from '../../../shared/api'
import type { StyleProfile } from '../../../shared/style-profile'
import { ErrorLine, Field, LoadingBlock } from '@/components/atelier/kit'
import { LiveDemoBadge } from '@/components/proto/LiveDemoBadge'
import { Button } from '@/components/ui/button'
import { Input, Switch } from '@/components/ui/input'
import { toast } from '@/lib/toast'
import { call, errText, useLoader } from '@/state/client'
import { Inset, Tag } from '../onboarding/parts'
import { ProfileForm } from './ProfileForm'

const fmt = (n: number): string => n.toLocaleString()

export function EyesPanel({ channelId }: { channelId: number }) {
  const detail = useLoader(() => call('eyes.get', channelId), `eyes-${channelId}`, ['channels', 'cloud'])
  const outliers = useLoader(() => call('eyes.outliers', channelId), `eyes-out-${channelId}`, ['channels'])
  const [busy, setBusy] = useState<string | null>(null)
  const run = async (what: string, job: () => Promise<string>): Promise<void> => {
    setBusy(what)
    try {
      toast.success(await job())
    } catch (err) {
      toast.error(errText(err))
    } finally {
      setBusy(null)
      detail.reload()
      outliers.reload()
    }
  }
  if (detail.error) return <ErrorLine message={detail.error} onRetry={detail.reload} />
  if (!detail.data) return <LoadingBlock rows={3} />
  const d = detail.data
  const locked = !d.cloudConnected || busy !== null
  return (
    <section data-testid="eyes-panel" className="mt-10 border-t border-line pt-8">
      <div className="mb-1 flex flex-wrap items-center gap-2.5">
        <Eye className="size-5 text-fg-2" aria-hidden />
        <h2 className="text-[19px] font-semibold tracking-[-0.01em] text-fg">{t('eyes.title')}</h2>
        {d.analysed.demo && <LiveDemoBadge block="eyes" />}
      </div>
      <p className="mb-5 max-w-[620px] text-[13.5px] leading-[1.55] text-fg-3">{t('eyes.hint')}</p>
      {!d.cloudConnected && <p className="mb-4 rounded-field border border-dashed border-line-2 px-3 py-2 text-[13px] text-fg-3" data-testid="eyes-offline">{t('eyes.offline')}</p>}

      <Competitors detail={d} busy={busy !== null} onChange={() => detail.reload()} />

      <div className="mt-4 flex flex-wrap items-center gap-2.5">
        <Button
          variant="secondary"
          data-testid="eyes-read"
          disabled={locked}
          onClick={() =>
            void run('read', async () => {
              const r = await call('eyes.read', channelId)
              return t('eyes.read.done', { n: r.channelsRead, o: r.outliers, q: r.quotaUnits })
            })
          }
        >
          {busy === 'read' ? t('eyes.reading') : t('eyes.read')}
        </Button>
        <Button
          variant="secondary"
          data-testid="eyes-analyse"
          disabled={locked}
          onClick={() =>
            void run('analyse', async () => {
              const r = await call('eyes.analyse', channelId, 5)
              const partial = r.coverage.filter((c) => /seulement/.test(c)).length
              return `${t('eyes.analyse.done', { n: r.analysed })}${r.coverage.length ? ` ${t('eyes.analyse.coverage', { whole: r.coverage.length - partial, partial })}` : ''}`
            })
          }
        >
          {busy === 'analyse' ? t('eyes.analysing') : t('eyes.analyse', { n: 5 })}
        </Button>
        <Button
          variant="brand"
          data-testid="eyes-build"
          disabled={busy !== null || d.analysed.own + d.analysed.competitors === 0}
          onClick={() =>
            void run('build', async () => {
              const r = await call('eyes.build', channelId)
              return t('eyes.build.done', { n: r.currentVersion ?? 0 })
            })
          }
        >
          {t('eyes.build')}
        </Button>
        <span className="text-[12px] text-fg-3" data-testid="eyes-analysed">
          {t('eyes.analysed', { own: d.analysed.own, comp: d.analysed.competitors })}
        </span>
      </div>
      <p className="mt-2 max-w-[620px] text-[12px] text-fg-3">{t('eyes.cost')}</p>

      {outliers.data && outliers.data.length > 0 && <Outliers rows={outliers.data} />}
      <ProfileEditor detail={d} onSaved={() => detail.reload()} />
    </section>
  )
}

function Competitors({ detail, busy, onChange }: { detail: EyesDetail; busy: boolean; onChange: () => void }) {
  const [url, setUrl] = useState('')
  const act = async (job: () => Promise<unknown>): Promise<void> => {
    try {
      await job()
      onChange()
    } catch (err) {
      toast.error(errText(err))
    }
  }
  return (
    <div data-testid="eyes-competitors">
      <p className="micro-label mb-2">{t('eyes.competitors')}</p>
      {detail.competitors.length > 0 && (
        <Inset className="mb-3">
          {detail.competitors.map((c) => (
            <div key={c.id} data-testid="eyes-competitor" className="flex flex-wrap items-center gap-3 px-4 py-2.5">
              <div className="min-w-0 flex-1 basis-[200px]">
                <p className="truncate text-[14px] font-medium text-fg">{c.name || c.url}</p>
                <p className="num text-[12px] text-fg-3">
                  {c.lastReadAt === null ? t('eyes.neverRead') : t('eyes.competitor.stats', { subs: c.subscribers === null ? '–' : fmt(c.subscribers), videos: c.videos, out: c.outliers })}
                </p>
              </div>
              {c.demo && <LiveDemoBadge block="eyes-competitor" />}
              <label className="flex items-center gap-2 text-[12.5px] text-fg-2">
                {c.watched ? t('chan.comp.watched') : t('chan.comp.unwatched')}
                <Switch aria-label={t('chan.comp.watch', { name: c.name || c.url })} checked={c.watched} disabled={busy} onCheckedChange={(on) => void act(() => call('eyes.setWatched', c.id, on))} />
              </label>
              <Button variant="ghost" size="icon-sm" aria-label={t('eyes.remove', { name: c.name || c.url })} disabled={busy} onClick={() => void act(() => call('eyes.removeCompetitor', c.id))}>
                <Trash2 aria-hidden />
              </Button>
            </div>
          ))}
        </Inset>
      )}
      <form
        className="flex flex-wrap items-end gap-2.5"
        onSubmit={(e) => {
          e.preventDefault()
          if (!url.trim()) return
          void act(async () => {
            await call('eyes.addCompetitor', detail.channelId, url.trim())
            setUrl('')
          })
        }}
      >
        <Field label={t('eyes.add.label')} htmlFor="eyes-add-url" className="min-w-64 flex-1" hint={t('eyes.add.hint')}>
          <Input id="eyes-add-url" data-testid="eyes-add-url" value={url} placeholder="https://www.youtube.com/@…" onChange={(e) => setUrl(e.target.value)} />
        </Field>
        <Button type="submit" variant="outline" data-testid="eyes-add" disabled={busy || !url.trim()}>
          <Plus aria-hidden />
          {t('eyes.add')}
        </Button>
      </form>
    </div>
  )
}

function Outliers({ rows }: { rows: OutlierRow[] }) {
  return (
    <div className="mt-6" data-testid="eyes-outliers">
      <p className="micro-label mb-2">{t('eyes.outliers')}</p>
      <Inset>
        {rows.slice(0, 8).map((o) => (
          <div key={`${o.sourceKey}-${o.videoId}`} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
            <div className="min-w-0 flex-1 basis-[240px]">
              <p className="truncate text-[14px] font-medium text-fg">{o.title}</p>
              <p className="text-[12px] text-fg-3">
                {o.channelName} · {t('eyes.outlier.views', { n: fmt(o.views) })}
              </p>
              {o.why && <p className="mt-0.5 text-[12px] leading-[1.45] text-fg-3">{o.why}</p>}
            </div>
            <Tag tone={o.score >= 3 ? 'ok' : 'neutral'}>{t('eyes.outlier.score', { n: o.score.toLocaleString('fr-FR', { minimumFractionDigits: 1 }) })}</Tag>
            {o.analysed && <Tag>{t('eyes.outlier.analysed')}</Tag>}
          </div>
        ))}
      </Inset>
    </div>
  )
}

function ProfileEditor({ detail, onSaved }: { detail: EyesDetail; onSaved: () => void }) {
  const current = detail.current
  const [draft, setDraft] = useState<StyleProfile | null>(current)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  // the profile was rebuilt (a new version): the form starts again from it
  const [seen, setSeen] = useState(detail.currentVersion)
  if (seen !== detail.currentVersion) {
    setSeen(detail.currentVersion)
    setDraft(current)
  }
  if (!current || !draft) {
    return (
      <p className="mt-6 rounded-field border border-dashed border-line-2 px-3 py-2 text-[13px] text-fg-3" data-testid="profile-empty">
        {t('eyes.profile.none')}
      </p>
    )
  }
  const dirty = JSON.stringify(draft) !== JSON.stringify(current)
  const save = async (): Promise<void> => {
    if (!note.trim()) {
      toast.error(t('eyes.err.noteNeeded'))
      return
    }
    setBusy(true)
    try {
      const r = await call('eyes.save', detail.channelId, draft, note.trim())
      toast.success(t('eyes.save.done', { n: r.currentVersion ?? 0 }))
      setNote('')
      onSaved()
    } catch (err) {
      toast.error(errText(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="mt-8" data-testid="profile-editor">
      <div className="mb-3 flex flex-wrap items-center gap-2.5">
        <p className="micro-label">{t('eyes.profile.title')}</p>
        {detail.currentVersion !== null && <Tag>{t('analysis.common.version', { n: detail.currentVersion })}</Tag>}
        {current.source.demo && <LiveDemoBadge block="eyes-profile" />}
        <span className="text-[12px] text-fg-3">{t('eyes.profile.source', { own: current.source.ownVideos, comp: current.source.competitorVideos })}</span>
      </div>
      <p className="mb-4 max-w-[620px] text-[12.5px] text-fg-3">{t('eyes.profile.hint')}</p>
      <ProfileForm profile={draft} onChange={setDraft} disabled={busy} />
      <div className="mt-5 flex flex-wrap items-end gap-3 rounded-card border border-line bg-surface-1 p-3">
        <Field label={t('styles.save.note')} htmlFor="profile-note" className="min-w-64 flex-1">
          <Input id="profile-note" value={note} placeholder={t('styles.save.notePlaceholder')} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <Button variant="ghost" disabled={busy || !dirty} onClick={() => setDraft(current)}>
          {t('styles.save.reset')}
        </Button>
        <Button variant="brand" data-testid="profile-save" disabled={busy || !dirty} onClick={() => void save()}>
          {t('styles.save.button')}
        </Button>
      </div>
      {detail.versions.length > 0 && (
        <ol className="mt-4 flex flex-col gap-1.5" data-testid="profile-versions">
          {detail.versions.map((v) => (
            <li key={v.version} className="flex items-center gap-3 text-[12.5px] text-fg-3">
              <span className="w-10 font-mono text-fg-2">{t('analysis.common.version', { n: v.version })}</span>
              <span className="min-w-0 flex-1 truncate">{v.note}</span>
              <span>{t(v.origin === 'built' ? 'eyes.origin.built' : 'eyes.origin.edited')}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
