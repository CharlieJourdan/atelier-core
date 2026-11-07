// The saved previews of a pipeline (production-15): what its pictures, clips and presenter look like, made once and shown
// free, one per kind in plain words (pipeline-ui: never named by engine or model).
import { useEffect, useState } from 'react'
import { t, type MessageKey } from '../../../../shared/fr'
import type { PreviewFile, PreviewItem } from '../../../../shared/previews'
import type { RecipeDocument } from '../../../../shared/recipes'
import { call, errText } from '@/state/client'

function base64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

function usePreviewUrl(key: string, file: PreviewFile): { url: string | null; error: string | null } {
  const id = `${key}|${file.ref}`
  const [res, setRes] = useState<{ id: string; url: string | null; error: string | null } | null>(null)
  useEffect(() => {
    let live = true
    let made: string | null = null
    call('previews.file', key, file.ref).then(
      (f) => {
        if (!live) return
        // the renderer's CSP takes pictures as data: only (they are small); videos as blob:
        if (f.mime.startsWith('image/')) setRes({ id, url: `data:${f.mime};base64,${base64(f.bytes)}`, error: null })
        else {
          made = URL.createObjectURL(new Blob([f.bytes as BlobPart], { type: f.mime }))
          setRes({ id, url: made, error: null })
        }
      },
      (e: unknown) => live && setRes({ id, url: null, error: errText(e) })
    )
    return () => {
      live = false
      if (made) URL.revokeObjectURL(made)
    }
  }, [id, key, file.ref])
  return res?.id === id ? res : { url: null, error: null }
}

/** One saved preview file: a still, a muted loop, or (`sound`) a loop with its sound, played on demand. */
export function PreviewMedia({ item, file, sound = false }: { item: PreviewItem; file: PreviewFile; sound?: boolean }) {
  const { url, error } = usePreviewUrl(item.key, file)
  if (error) return <div className="flex aspect-video items-center justify-center rounded-field bg-surface-2 px-2 text-center text-[11px] text-fg-3">{error}</div>
  if (!url) return <div className="aspect-video animate-pulse rounded-field bg-surface-2" aria-busy="true" />
  if (file.type === 'video' && sound) return <video src={url} loop controls playsInline className="aspect-video w-full rounded-field bg-black object-cover" />
  return file.type === 'video' ? (
    <video src={url} muted loop autoPlay playsInline className="aspect-video w-full rounded-field bg-black object-cover" />
  ) : (
    <img src={url} alt="" className="aspect-video w-full rounded-field bg-surface-2 object-cover" loading="lazy" />
  )
}

function usePreviews(doc: RecipeDocument): PreviewItem[] | null {
  const key = JSON.stringify(doc.bricks.map((b) => [b.tech, b.engine, b.style]).concat([doc.base ?? '']))
  const [res, setRes] = useState<{ key: string; items: PreviewItem[] } | null>(null)
  useEffect(() => {
    let live = true
    call('previews.forDoc', doc).then(
      (items) => live && setRes({ key, items }),
      () => live && setRes({ key, items: [] })
    )
    return () => {
      live = false
    }
    // the document's choices are its key
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return res?.key === key ? res.items : null
}

const FAMILY_WORD: Record<string, MessageKey> = { image: 'pstyle.preview.image', clip: 'pstyle.preview.clip', presenter: 'pstyle.preview.presenter' }

/** One preview per kind (pictures, clips, presenter), the pipeline's own choice first. */
export function PreviewStrip({ doc, testId }: { doc: RecipeDocument; testId?: string }) {
  const items = usePreviews(doc)
  if (!items || items.length === 0) return null
  const picks = (['image', 'clip', 'presenter'] as const).flatMap((f) => items.filter((i) => i.family === f).slice(0, 1))
  return (
    <div className="flex flex-col gap-1.5" data-testid={testId}>
      <span className="text-[11.5px] text-fg-3">{t('pstyle.preview.title')}</span>
      <div className="grid grid-cols-3 gap-1.5">
        {picks.map((p) => (
          <figure key={p.key} className="flex flex-col gap-1">
            {p.files[0] && <PreviewMedia item={p} file={p.files[0]} />}
            <figcaption className="text-[11px] text-fg-3">{t(FAMILY_WORD[p.family] as MessageKey)}</figcaption>
          </figure>
        ))}
      </div>
    </div>
  )
}
