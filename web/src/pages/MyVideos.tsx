// « Mes vidéos »: the team's publication kits stored on Atelier Cloud (signed-in people of the team only; the site must be
// built with VITE_ATELIER_CLOUD). Each kit lists its files with download buttons and copy buttons for the title and the
// description. A link is asked at the click (a short-lived link straight to the storage service), never kept on the page.
// Atelier never publishes to YouTube: this page only hands the files over.
import { useCallback, useEffect, useState } from 'react'
import { Check, Copy, Download } from 'lucide-react'
import { CloudCallError, cloudEnabled, cloudKit, cloudKits, type SiteKit } from '../cloud'
import { SiteLayout } from '../components/SiteLayout'
import { useLang, type Lang, type TFn } from '../i18n'
import { Button, LinkButton } from '../ui'

export type Phase = 'loading' | 'ready' | 'signedOut' | 'error' | 'demoSite'

const at = (s: number): string => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

/** The description as it goes on YouTube: the text, then the chapters (m:ss) and the tags (same as the app's kit). */
export function kitDescription(kit: Pick<SiteKit, 'description' | 'chapters' | 'tags'>): string {
  const chapters = kit.chapters.map((c) => `${at(c.at)} ${c.title}`).join('\n')
  const tags = kit.tags.map((x) => `#${x.replace(/\s+/g, '')}`).join(' ')
  return [kit.description, chapters, tags].filter((x) => x.trim().length > 0).join('\n\n')
}

/** `video.mp4`, then the thumbnail (the JPEG when the PNG was over YouTube's 2 MB), by file name. */
export const videoFileOf = (kit: Pick<SiteKit, 'files'>): string | undefined => kit.files.find((f) => /^video\./.test(f.name))?.name
export const thumbFileOf = (kit: Pick<SiteKit, 'files'>): string | undefined =>
  kit.files.find((f) => f.name === 'thumbnail.jpg')?.name ?? kit.files.find((f) => f.name === 'thumbnail.png')?.name

export function fmtSize(bytes: number, lang: Lang): string {
  const mb = bytes / (1024 * 1024)
  if (mb >= 1) return `${mb.toLocaleString(lang, { maximumFractionDigits: mb >= 100 ? 0 : 1 })} ${lang === 'fr' ? 'Mo' : 'MB'}`
  return `${Math.max(1, Math.round(bytes / 1024))} ${lang === 'fr' ? 'Ko' : 'KB'}`
}

export interface MyVideosViewProps {
  phase: Phase
  kits: SiteKit[]
  lang: Lang
  t: TFn
  notice: string | null
  onDownload: (kit: SiteKit, name: string | null) => void
  onCopy: (kit: SiteKit, what: 'title' | 'description') => void
  onRetry: () => void
}

function KitCard({ kit, lang, t, onDownload, onCopy }: Pick<MyVideosViewProps, 'lang' | 't' | 'onDownload' | 'onCopy'> & { kit: SiteKit }) {
  const video = videoFileOf(kit)
  const thumb = thumbFileOf(kit)
  const date = new Date(kit.expiresAt).toLocaleDateString(lang, { day: 'numeric', month: 'long', year: 'numeric' })
  return (
    <li className="card p-5" data-testid="kit-card" data-video={kit.videoId} style={{ borderRadius: 16 }}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="m-0 text-[17px] font-medium leading-[1.3] tracking-[-0.012em]">{kit.title}</h2>
        <span className="text-[12.5px] text-fg-3">{t('mv.expires', { date })}</span>
      </div>
      {kit.demo && (
        <p className="m-0 mt-1 text-[12.5px] font-medium text-warn" data-testid="kit-demo">
          {t('mv.demoBadge')}
        </p>
      )}
      <ul className="m-0 mt-3 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-[12.5px] text-fg-3" aria-label={t('mv.files')}>
        {kit.files.map((f) => (
          <li key={f.name} className="num">
            {f.name} · {fmtSize(f.size, lang)}
          </li>
        ))}
      </ul>
      {kit.tags.length > 0 && (
        <p className="m-0 mt-3 text-[12.5px] leading-[1.5] text-fg-3">
          <span className="font-medium text-fg-2">{t('mv.tags')} : </span>
          {kit.tags.join(', ')}
        </p>
      )}
      {kit.alternatives.length > 0 && (
        <p className="m-0 mt-1.5 text-[12.5px] leading-[1.5] text-fg-3">
          <span className="font-medium text-fg-2">{t('mv.alternatives')} : </span>
          {kit.alternatives.join(' · ')}
        </p>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        {video && (
          <Button size="sm" onClick={() => onDownload(kit, video)} data-testid="kit-download-video">
            <Download size={14} aria-hidden="true" />
            {t('mv.video')}
          </Button>
        )}
        {thumb && (
          <Button size="sm" variant="secondary" onClick={() => onDownload(kit, thumb)} data-testid="kit-download-thumb">
            <Download size={14} aria-hidden="true" />
            {t('mv.thumb')}
          </Button>
        )}
        <Button size="sm" variant="secondary" onClick={() => onDownload(kit, null)} data-testid="kit-download-all">
          <Download size={14} aria-hidden="true" />
          {t('mv.all')}
        </Button>
        <Button size="sm" variant="secondary" onClick={() => onCopy(kit, 'title')} data-testid="kit-copy-title">
          <Copy size={14} aria-hidden="true" />
          {t('mv.copyTitle')}
        </Button>
        <Button size="sm" variant="secondary" onClick={() => onCopy(kit, 'description')} data-testid="kit-copy-description">
          <Copy size={14} aria-hidden="true" />
          {t('mv.copyDescription')}
        </Button>
      </div>
    </li>
  )
}

/** The page as a pure view (props in, markup out), so each state renders in plain Node. */
export function MyVideosView(p: MyVideosViewProps) {
  return (
    <SiteLayout>
      <section className="mx-auto max-w-[860px] px-5 py-16 sm:px-8 sm:py-20">
        <h1 className="m-0 text-[32px] font-medium leading-[1.1] tracking-[-0.03em]">{p.t('mv.title')}</h1>
        <p className="m-0 mt-3 max-w-[620px] text-[15px] leading-[1.6] text-fg-3">{p.t('mv.sub')}</p>
        <div aria-live="polite" className="mt-4 min-h-[20px] text-[13px] text-fg-2" data-testid="kit-notice">
          {p.notice && (
            <span className="inline-flex items-center gap-1.5">
              <Check size={14} aria-hidden="true" />
              {p.notice}
            </span>
          )}
        </div>
        {p.phase === 'loading' && <p className="m-0 mt-6 text-[14px] text-fg-3">{p.t('mv.loading')}</p>}
        {p.phase === 'demoSite' && (
          <p className="m-0 mt-6 rounded-[12px] bg-surface-2 px-4 py-3 text-[14px] text-fg-2" data-testid="mv-demo">
            {p.t('mv.demoSite')}
          </p>
        )}
        {p.phase === 'signedOut' && (
          <div className="mt-6" data-testid="mv-signed-out">
            <p className="m-0 text-[14px] text-fg-2">{p.t('mv.signedOut')}</p>
            <LinkButton to="/connexion" className="mt-4">
              {p.t('mv.signIn')}
            </LinkButton>
          </div>
        )}
        {p.phase === 'error' && (
          <div className="mt-6" role="alert" data-testid="mv-error">
            <p className="m-0 text-[14px] text-fg-2">{p.t('mv.error')}</p>
            <Button variant="secondary" className="mt-4" onClick={p.onRetry}>
              {p.t('mv.retry')}
            </Button>
          </div>
        )}
        {p.phase === 'ready' && p.kits.length === 0 && (
          <p className="m-0 mt-6 text-[14px] text-fg-3" data-testid="mv-empty">
            {p.t('mv.empty')}
          </p>
        )}
        {p.phase === 'ready' && p.kits.length > 0 && (
          <ul className="m-0 mt-6 flex list-none flex-col gap-4 p-0" data-testid="mv-list">
            {p.kits.map((k) => (
              <KitCard key={k.id} kit={k} lang={p.lang} t={p.t} onDownload={p.onDownload} onCopy={p.onCopy} />
            ))}
          </ul>
        )}
        <p className="m-0 mt-10 text-[12.5px] text-fg-3">{p.t('mv.neverPublish')}</p>
      </section>
    </SiteLayout>
  )
}

export function MyVideos() {
  const { lang, t } = useLang()
  const [phase, setPhase] = useState<Phase>(cloudEnabled() ? 'loading' : 'demoSite')
  const [kits, setKits] = useState<SiteKit[]>([])
  const [notice, setNotice] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!cloudEnabled()) return
    let stop = false
    cloudKits().then(
      (r) => {
        if (stop) return
        setKits(r.kits)
        setPhase('ready')
      },
      (e: unknown) => {
        if (!stop) setPhase(e instanceof CloudCallError && (e.status === 401 || e.code === 'unauthorized') ? 'signedOut' : 'error')
      }
    )
    return () => {
      stop = true
    }
  }, [tick])
  useEffect(() => {
    if (!notice) return
    const id = window.setTimeout(() => setNotice(null), 2600)
    return () => window.clearTimeout(id)
  }, [notice])

  const download = useCallback(
    (kit: SiteKit, name: string | null): void => {
      void cloudKit(kit.videoId).then(
        async (fresh) => {
          const files = name === null ? fresh.files : fresh.files.filter((f) => f.name === name)
          for (const f of files) {
            if (!f.url) continue
            const a = document.createElement('a')
            a.href = f.url
            a.download = f.name
            a.rel = 'noopener'
            document.body.appendChild(a)
            a.click()
            a.remove()
            await new Promise((resolve) => setTimeout(resolve, 250)) // browsers drop downloads fired in the same tick
          }
          setNotice(t('mv.downloading'))
        },
        (e: unknown) => {
          if (e instanceof CloudCallError && e.status === 404) {
            setNotice(t('mv.gone'))
            setTick((n) => n + 1)
          } else setNotice(t('mv.error'))
        }
      )
    },
    [t]
  )
  const copy = useCallback(
    (kit: SiteKit, what: 'title' | 'description'): void => {
      const text = what === 'title' ? kit.title : kitDescription(kit)
      void navigator.clipboard?.writeText(text).then(
        () => setNotice(t('mv.copied')),
        () => setNotice(t('mv.error'))
      )
    },
    [t]
  )
  return <MyVideosView phase={phase} kits={kits} lang={lang} t={t} notice={notice} onDownload={download} onCopy={copy} onRetry={() => setTick((n) => n + 1)} />
}
