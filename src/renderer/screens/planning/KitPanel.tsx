// The publication kit block of the video sheet, as a pure view (props in, markup out) so every state can be rendered in
// plain Node. Demo videos: downloads only confirm. Real videos: the kit on the platform (Atelier Cloud) when there is one
// (download from anywhere), « Envoyer sur la plateforme » when it has none yet, and the package folder of this computer
// as the fallback. Atelier never publishes anything: the person does, by hand.
import { Check, Cloud, Copy, Download, FolderOpen } from 'lucide-react'
import type { CloudKitState } from '../../../shared/api'
import { t } from '../../../shared/fr'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { kitFileFor } from './cloudKit'

export interface KitPanelProps {
  /** A real run (not the demo store). */
  live: boolean
  /** Real: the package node is done. */
  packageReady: boolean
  /** Real: the package folder holds `thumbnail.png`. */
  localThumb: boolean
  /** Demo: the video is rendered / packaged. */
  rendered: boolean
  packaged: boolean
  kit: CloudKitState | null
  sending: boolean
  /** The line under the buttons: what the last action did (or failed to do). */
  notice: { text: string; error: boolean } | null
  onVideo: () => void
  onThumb: () => void
  onAll: () => void
  onFolder: () => void
  onSend: () => void
  onCopyTitle: () => void
  onCopyDescription: () => void
}

const fmtKitDate = (iso: string): string => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })

export function KitPanel(p: KitPanelProps) {
  const onPlatform = p.live && p.kit?.status === 'ok' ? p.kit.kit : null
  const cloudThumb = onPlatform ? kitFileFor(onPlatform, 'thumb') : undefined
  return (
    <div className="mt-3 border-t border-line pt-3" data-testid="publication-kit">
      <p className="mb-2 text-[12.5px] font-medium text-fg">{t('planning.kit.title')}</p>
      <div className="grid grid-cols-1 gap-2">
        {onPlatform && (
          <>
            <p className="flex items-start gap-1.5 text-[12.5px] leading-[1.45] text-fg-2" data-testid="kit-cloud-badge">
              <Cloud className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              {t('planning.kit.cloud.badge', { date: fmtKitDate(onPlatform.expiresAt) })}
            </p>
            <Button size="sm" variant="secondary" className="justify-start" onClick={p.onVideo} data-testid="kit-cloud-video">
              <Download aria-hidden />
              {t('planning.kit.video')}
            </Button>
            <Button size="sm" variant="secondary" className="justify-start" disabled={!cloudThumb} onClick={p.onThumb} title={cloudThumb ? undefined : t('planning.kit.thumb.none')} data-testid="kit-cloud-thumb">
              <Download aria-hidden />
              {t('planning.kit.thumb')}
            </Button>
            <Button size="sm" variant="secondary" className="justify-start" onClick={p.onAll} data-testid="kit-cloud-all">
              <Download aria-hidden />
              {t('planning.kit.cloud.all')}
            </Button>
          </>
        )}
        {p.live && p.packageReady && p.kit?.status === 'none' && (
          <>
            <p className="text-[12.5px] leading-[1.45] text-fg-3" data-testid="kit-cloud-hint">
              {t('planning.kit.cloud.hint')}
            </p>
            <Button size="sm" variant="secondary" className="justify-start" disabled={p.sending} onClick={p.onSend} data-testid="kit-cloud-send">
              <Cloud aria-hidden />
              {p.sending ? t('planning.kit.cloud.sending') : t('planning.kit.cloud.send')}
            </Button>
          </>
        )}
        {p.live && p.kit?.status === 'unreachable' && (
          <p className="text-[12.5px] leading-[1.45] text-fg-3" data-testid="kit-cloud-unreachable">
            {t('planning.kit.cloud.unreachable')}
          </p>
        )}
        {p.live ? (
          <Button size="sm" variant="secondary" className="justify-start" disabled={!p.packageReady} onClick={p.onFolder} title={p.packageReady ? undefined : t('planning.kit.notReady')} data-testid="kit-folder">
            <FolderOpen aria-hidden />
            {t('planning.kit.folder')}
          </Button>
        ) : (
          <Button size="sm" variant="secondary" className="justify-start" disabled={!p.rendered} onClick={p.onVideo} title={p.rendered ? undefined : t('planning.kit.notReady')}>
            <Download aria-hidden />
            {t('planning.kit.video')}
          </Button>
        )}
        {!onPlatform && (
          <Button
            size="sm"
            variant="secondary"
            className="justify-start"
            disabled={p.live ? !p.localThumb : !p.packaged}
            onClick={p.onThumb}
            title={p.live ? (p.localThumb ? undefined : p.packageReady ? t('planning.kit.thumb.none') : t('planning.kit.notReady')) : p.packaged ? undefined : t('planning.kit.notReady')}
            data-testid="kit-thumb"
          >
            <Download aria-hidden />
            {t('planning.kit.thumb')}
          </Button>
        )}
        <Button size="sm" variant="secondary" className="justify-start" onClick={p.onCopyTitle}>
          <Copy aria-hidden />
          {t('planning.kit.title.copy')}
        </Button>
        <Button size="sm" variant="secondary" className="justify-start" onClick={p.onCopyDescription}>
          <Copy aria-hidden />
          {t('planning.kit.description')}
        </Button>
      </div>
      <p aria-live="polite" className="mt-2.5 min-h-[18px] text-[12.5px] text-fg-2" data-testid="kit-confirm">
        {p.notice && (
          <span className={cn('inline-flex items-center gap-1.5', p.notice.error && 'text-err')} data-testid="kit-notice">
            {!p.notice.error && <Check className="size-3.5 text-ok" aria-hidden />}
            {p.notice.text}
          </span>
        )}
      </p>
    </div>
  )
}
