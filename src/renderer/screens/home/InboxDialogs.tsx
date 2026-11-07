// The dialogs behind the "À valider" actions: read a script, import a script, drop gameplay clips, pick ideas.
// The confirm button calls `onDone`, which resolves the inbox item. « Importer le script » sends the script itself (pasted,
// or read from a .txt / .docx file) as the answer: an agent's request gets the text (agents-production).
import { FileText, Upload, X } from 'lucide-react'
import { useRef, useState, type DragEvent } from 'react'
import { t, type MessageKey } from '../../../shared/fr'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { useProto } from '@/proto/store'
import type { InboxAnswer, InboxItem } from '@/proto/types'
import { ScriptField } from '../production/recettes/ScriptField'

export type DialogKind = 'script' | 'ideas' | 'import-script' | 'import-files'

const TITLE = 'font-sans text-[18px] leading-tight font-semibold tracking-[-0.018em]'

/* ---------- script ---------- */

function ScriptBody({ item, onDone, onClose }: { item: InboxItem; onDone: (m: string) => void; onClose: () => void }) {
  const state = useProto()
  const video = state.videos.find((v) => v.id === item.videoId)
  const [changing, setChanging] = useState(false)
  const [note, setNote] = useState('')
  const paragraphs: MessageKey[] =
    item.videoId === 'v-dyatlov'
      ? ['home.dash.script.dyatlov.1', 'home.dash.script.dyatlov.2', 'home.dash.script.dyatlov.3']
      : ['home.dash.script.generic.1', 'home.dash.script.generic.2']
  return (
    <>
      <DialogHeader>
        <DialogTitle className={TITLE}>{item.title}</DialogTitle>
        <DialogDescription>{item.detail}</DialogDescription>
      </DialogHeader>
      <div className="max-h-[300px] overflow-y-auto rounded-[12px] border border-line-2 bg-surface-1 px-4 py-3.5" data-testid="script-excerpt">
        <p className="mb-2 text-[11.5px] font-medium text-fg-3">{t('home.dash.script.excerpt')}</p>
        <div className="space-y-3 text-[13.5px] leading-[1.6] text-fg-2">
          {paragraphs.map((k) => (
            <p key={k}>{t(k, { title: video?.title ?? item.title })}</p>
          ))}
          <p className="text-fg-3">{t('home.dash.script.more')}</p>
        </div>
      </div>
      {changing && (
        <Textarea
          autoFocus
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t('home.dash.script.notePlaceholder')}
          aria-label={t('home.dash.script.notePlaceholder')}
          className="min-h-[72px]"
        />
      )}
      <DialogFooter className="justify-end">
        <Button variant="ghost" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        {changing ? (
          <Button variant="outline" disabled={!note.trim()} onClick={() => onDone(t('home.dash.done.changes'))}>
            {t('home.dash.script.sendChanges')}
          </Button>
        ) : (
          <Button variant="outline" onClick={() => setChanging(true)}>
            {t('home.dash.script.askChanges')}
          </Button>
        )}
        <Button onClick={() => onDone(t('home.dash.done.script'))} data-testid="dialog-confirm">
          {t('common.validate')}
        </Button>
      </DialogFooter>
    </>
  )
}

/* ---------- ideas ---------- */

const IDEAS: MessageKey[] = ['home.dash.ideas.1', 'home.dash.ideas.2', 'home.dash.ideas.3', 'home.dash.ideas.4', 'home.dash.ideas.5']

function IdeasBody({ item, onDone, onClose }: { item: InboxItem; onDone: (m: string) => void; onClose: () => void }) {
  const [picked, setPicked] = useState<string[]>([IDEAS[0] as string, IDEAS[2] as string])
  const toggle = (k: string) => setPicked((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]))
  return (
    <>
      <DialogHeader>
        <DialogTitle className={TITLE}>{item.title}</DialogTitle>
        <DialogDescription>{t('home.dash.ideas.hint')}</DialogDescription>
      </DialogHeader>
      <ul className="overflow-hidden rounded-[12px] border border-line-2 bg-surface-1" data-testid="ideas-list">
        {IDEAS.map((k, i) => {
          const on = picked.includes(k)
          return (
            <li key={k} className={cn(i > 0 && 'border-t border-line')}>
              <label className="flex cursor-pointer items-start gap-3 px-3.5 py-2.5 hover:bg-hover">
                <input type="checkbox" checked={on} onChange={() => toggle(k)} className="mt-0.5 size-4 shrink-0 accent-[var(--ink)]" />
                <span className="text-[13.5px] leading-[1.4] text-fg">{t(k)}</span>
              </label>
            </li>
          )
        })}
      </ul>
      <DialogFooter className="justify-end">
        <Button variant="ghost" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button disabled={picked.length === 0} onClick={() => onDone(t('home.dash.done.ideas', { n: picked.length }))} data-testid="dialog-confirm">
          {t('home.dash.ideas.confirm', { n: picked.length })}
        </Button>
      </DialogFooter>
    </>
  )
}

/* ---------- import (script or files) ---------- */

function DropZone({ files, onFiles, label, hint }: { files: string[]; onFiles: (names: string[]) => void; label: string; hint: string }) {
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const take = (list: FileList | null) => {
    if (!list || list.length === 0) return
    onFiles(Array.from(list).map((f) => f.name))
  }
  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setOver(false)
    take(e.dataTransfer.files)
  }
  return (
    <div>
      <button
        type="button"
        data-testid="dropzone"
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        className={cn(
          'flex w-full flex-col items-center gap-1.5 rounded-[16px] border border-dashed px-4 py-7 text-center outline-none transition-colors focus-visible:outline-2 focus-visible:outline-ring',
          over ? 'border-ink bg-selected' : 'border-line-3 bg-surface-1 hover:bg-hover'
        )}
      >
        <Upload className="size-5 text-fg-2" aria-hidden />
        <span className="text-[13.5px] font-medium text-fg">{label}</span>
        <span className="text-[12px] text-fg-3">{hint}</span>
      </button>
      <input ref={input} type="file" multiple className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => take(e.target.files)} />
      {files.length > 0 && (
        <ul className="mt-2.5 space-y-1" data-testid="dropped-files">
          {files.map((f) => (
            <li key={f} className="flex items-center gap-2 rounded-[8px] bg-surface-2 px-2.5 py-1.5 text-[12.5px] text-fg-2">
              <FileText className="size-3.5 shrink-0 text-fg-3" aria-hidden />
              <span className="min-w-0 flex-1 truncate">{f}</span>
              <button type="button" aria-label={t('common.close')} onClick={() => onFiles(files.filter((x) => x !== f))} className="text-fg-3 hover:text-fg">
                <X className="size-3.5" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

const SAMPLE_CLIPS = ['parkour-nuit-01.mp4', 'parkour-nuit-02.mp4', 'voiture-pluie-03.mp4', 'voiture-pluie-04.mp4', 'cuisine-asmr-05.mp4']

function ImportBody({ item, script, onDone, onClose }: { item: InboxItem; script: boolean; onDone: (m: string, answer?: InboxAnswer) => void; onClose: () => void }) {
  const [files, setFiles] = useState<string[]>([])
  const [text, setText] = useState('')
  const ready = script ? text.trim().length > 0 : files.length > 0
  return (
    <>
      <DialogHeader>
        <DialogTitle className={TITLE}>{script ? t('home.dash.import.scriptTitle') : t('home.dash.import.filesTitle')}</DialogTitle>
        <DialogDescription>{item.detail}</DialogDescription>
      </DialogHeader>
      {script ? (
        <ScriptField id="inbox-script" value={text} onChange={setText} autoFocus />
      ) : (
        <DropZone files={files} onFiles={setFiles} label={t('home.dash.import.dropClips')} hint={t('home.dash.import.clipsHint')} />
      )}
      {!script && files.length === 0 && (
        <button type="button" onClick={() => setFiles(SAMPLE_CLIPS)} className="-mt-1 self-start text-left text-[12.5px] text-fg-3 underline-offset-4 hover:text-fg hover:underline">
          {t('home.dash.import.useSamples')}
        </button>
      )}
      <DialogFooter className="justify-end">
        <Button variant="ghost" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button
          disabled={!ready}
          onClick={() => (script ? onDone(t('home.dash.done.importScript'), { text }) : onDone(t('home.dash.done.importFiles', { n: files.length }), { files }))}
          data-testid="dialog-confirm"
        >
          {script ? t('home.dash.import.confirmScript') : t('home.dash.import.confirmClips', { n: files.length })}
        </Button>
      </DialogFooter>
    </>
  )
}

export function InboxDialog({ item, kind, onClose, onDone }: { item: InboxItem; kind: DialogKind; onClose: () => void; onDone: (message: string, answer?: InboxAnswer) => void }) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[min(560px,92vw)]" closeLabel={t('common.close')} data-testid={`inbox-dialog-${kind}`}>
        {kind === 'script' && <ScriptBody item={item} onDone={onDone} onClose={onClose} />}
        {kind === 'ideas' && <IdeasBody item={item} onDone={onDone} onClose={onClose} />}
        {kind === 'import-script' && <ImportBody item={item} script onDone={onDone} onClose={onClose} />}
        {kind === 'import-files' && <ImportBody item={item} script={false} onDone={onDone} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  )
}
