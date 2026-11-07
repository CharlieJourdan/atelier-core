// How the clone screens get their pictures and videos: artefacts keep paths relative to the clone folder, the app turns a
// path into something the strict CSP lets through (a data: picture, a blob: video). The assembler provides the resolver
// from its API; previews and tests provide their own. A missing file shows a plain « image absente », never a crash.
import { createContext, useContext, useEffect, useState } from 'react'
import { tc } from '../../../../shared/fr-clone'
import { cn } from '@/lib/utils'

export interface CloneFiles {
  /** URL of a picture (data:) or a video (blob:) under the clone folder, or null when the file is not there. */
  url(rel: string): Promise<string | null>
}

export const CloneFilesContext = createContext<CloneFiles>({ url: async () => null })

export function useCloneUrl(rel: string | null): { url: string | null; missing: boolean } {
  const files = useContext(CloneFilesContext)
  const [got, setGot] = useState<{ rel: string; url: string | null } | null>(null)
  useEffect(() => {
    if (!rel) return
    let live = true
    files.url(rel).then(
      (u) => { if (live) setGot({ rel, url: u }) },
      () => { if (live) setGot({ rel, url: null }) }
    )
    return () => { live = false }
  }, [files, rel])
  if (!rel) return { url: null, missing: true }
  if (got?.rel !== rel) return { url: null, missing: false }
  return { url: got.url, missing: got.url === null }
}

/** One picture; `time` prints its timecode in a corner (a contact-sheet frame). */
export function Frame({ rel, alt, time, labels, className }: { rel: string | null; alt: string; time?: string; labels?: [string, string]; className?: string }) {
  const { url, missing } = useCloneUrl(rel)
  return (
    <figure className={cn('relative m-0 overflow-hidden rounded-[8px] bg-surface-2 ring-1 ring-line-2', className)}>
      {url ? <img src={url} alt={alt} className="aspect-video w-full object-cover" /> : (
        <div className={cn('flex aspect-video w-full items-center justify-center px-2 text-center text-[11px] text-fg-3', !missing && 'animate-pulse')} role="img" aria-label={alt}>
          {missing ? tc('clone.frame.missing') : ''}
        </div>
      )}
      {labels && url && (
        <>
          <span className="absolute left-1 top-1 rounded-[4px] bg-black/65 px-1.5 py-0.5 text-[10px] font-medium leading-none text-white">{labels[0]}</span>
          <span className="absolute left-[calc(50%+4px)] top-1 rounded-[4px] bg-black/65 px-1.5 py-0.5 text-[10px] font-medium leading-none text-white">{labels[1]}</span>
        </>
      )}
      {time && <figcaption className="absolute bottom-1 left-1 rounded-[4px] bg-black/65 px-1.5 py-0.5 font-mono text-[10px] leading-none text-white tabular-nums">{time}</figcaption>}
    </figure>
  )
}

/** A video the user can play (blob: allowed by the CSP). */
export function ClipPlayer({ rel, className }: { rel: string; className?: string }) {
  const { url, missing } = useCloneUrl(rel)
  if (url) return <video src={url} controls preload="metadata" className={cn('aspect-video w-full rounded-[12px] bg-black', className)} data-testid="clone-example-video" />
  return <div className={cn('flex aspect-video w-full items-center justify-center rounded-[12px] bg-surface-2 text-[12px] text-fg-3', !missing && 'animate-pulse', className)}>{missing ? tc('clone.frame.missing') : ''}</div>
}
