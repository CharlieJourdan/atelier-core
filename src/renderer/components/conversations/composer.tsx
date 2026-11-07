// The pill composer (PLAN-V2 §2.2): auto-growing text, attachments (picker, drag-and-drop, paste), and an @mention list
// (at most 7 names). Files are read in the renderer and sent as base64 (the sandboxed renderer has no file paths).
import { ArrowUp, Paperclip, Square, X } from 'lucide-react'
import { useId, useLayoutEffect, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from 'react'
import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS, type AttachmentUpload } from '../../../shared/chat'
import { filterMentions, insertMention, mentionQuery, type MentionTarget } from '../../../shared/chat-rich'
import { t } from '../../../shared/fr'
import { AgentDot } from '@/components/atelier/primitives'
import { cn } from '@/lib/utils'

export interface ComposerProps {
  disabled?: boolean
  /** Agents that can be mentioned with @. */
  mentions?: readonly MentionTarget[]
  onSend: (body: string, attachments: AttachmentUpload[]) => Promise<void>
  /** True while agents are answering: a Stop button cuts the whole conversation (lot 13). */
  busy?: boolean
  onStop?: () => Promise<void> | void
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

async function readFile(file: File): Promise<AttachmentUpload> {
  return { name: file.name, mime: file.type || 'application/octet-stream', dataBase64: toBase64(await file.arrayBuffer()) }
}

export function Composer({ disabled = false, mentions = [], onSend, busy = false, onStop }: ComposerProps) {
  const [text, setText] = useState('')
  const [caret, setCaret] = useState(0)
  const [files, setFiles] = useState<File[]>([])
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [active, setActive] = useState(0)
  const [dismissed, setDismissed] = useState<number | null>(null)
  const listId = useId()
  const picker = useRef<HTMLInputElement>(null)
  const area = useRef<HTMLTextAreaElement>(null)
  const pendingCaret = useRef<number | null>(null)

  const query = mentionQuery(text, caret)
  const suggestions = query && query.start !== dismissed ? filterMentions(mentions, query.query) : []
  const listOpen = suggestions.length > 0
  const current = Math.min(active, Math.max(0, suggestions.length - 1))

  const addFiles = (incoming: File[]): void => {
    if (incoming.length === 0) return
    const next = [...files, ...incoming]
    if (next.length > MAX_ATTACHMENTS) return setError(t('composer.tooMany', { n: MAX_ATTACHMENTS }))
    const big = incoming.find((f) => f.size > MAX_ATTACHMENT_BYTES)
    if (big) return setError(t('composer.tooBig', { name: big.name, mb: MAX_ATTACHMENT_BYTES / 1024 / 1024 }))
    setError(null)
    setFiles(next)
  }

  const canSend = !disabled && !sending && (text.trim() !== '' || files.length > 0)

  const send = async (): Promise<void> => {
    if (!canSend) return
    const sentText = text
    setSending(true)
    setError(null)
    try {
      await onSend(sentText, await Promise.all(files.map(readFile)))
      // Text typed while the message was leaving is kept.
      setText((cur) => (cur === sentText ? '' : cur))
      setCaret((c) => (text === sentText ? 0 : c))
      setFiles([])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSending(false)
    }
  }

  const pick = (target: MentionTarget): void => {
    if (!query) return
    const next = insertMention(text, query.start, caret, target)
    setText(next.text)
    setCaret(next.caret)
    setActive(0)
    pendingCaret.current = next.caret
  }

  // The caret goes after the inserted mention as soon as the new text is drawn, before the next key is handled (a
  // later frame would move it back over what was typed meanwhile).
  useLayoutEffect(() => {
    const at = pendingCaret.current
    if (at === null || !area.current) return
    pendingCaret.current = null
    area.current.focus()
    area.current.setSelectionRange(at, at)
  }, [text])

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (listOpen) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const n = suggestions.length
        setActive((current + (e.key === 'ArrowDown' ? 1 : n - 1)) % n)
        return
      }
      if ((e.key === 'Enter' || e.key === 'Tab') && !e.nativeEvent.isComposing) {
        e.preventDefault()
        const target = suggestions[current]
        if (target) pick(target)
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setDismissed(query?.start ?? null)
        return
      }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void send()
    }
  }

  const onDrop = (e: DragEvent): void => {
    e.preventDefault()
    setDragging(false)
    addFiles(Array.from(e.dataTransfer.files))
  }

  const onPaste = (e: ClipboardEvent): void => {
    const pasted = Array.from(e.clipboardData.files)
    if (pasted.length > 0) {
      e.preventDefault()
      addFiles(pasted)
    }
  }

  return (
    <div className="relative mx-auto w-full max-w-[860px] px-6 pb-5">
      {listOpen && (
        <ul
          id={listId}
          role="listbox"
          aria-label={t('composer.mentions')}
          data-testid="mention-list"
          className="absolute bottom-full left-6 z-20 mb-2 w-72 overflow-hidden rounded-card border border-line-2 bg-surface-pop p-1 shadow-lg"
        >
          {suggestions.map((s, i) => (
            <li
              key={s.id}
              id={`${listId}-${s.id}`}
              role="option"
              aria-selected={i === current}
              data-testid={`mention-${s.id}`}
              // mousedown (not click) so the textarea keeps its focus and caret
              onMouseDown={(e) => {
                e.preventDefault()
                pick(s)
              }}
              onMouseEnter={() => setActive(i)}
              className={cn('flex cursor-pointer items-center gap-2.5 rounded-field px-2.5 py-1.5 text-[13px]', i === current && 'bg-surface-2')}
            >
              <AgentDot index={s.index} size={20} />
              <span className="font-medium">{s.name}</span>
              {s.hint && <span className="truncate text-[11.5px] text-fg-3">{s.hint}</span>}
            </li>
          ))}
        </ul>
      )}
      <div
        data-testid="composer"
        data-dragging={dragging ? 'true' : undefined}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          'rounded-[26px] border bg-surface-1 px-2 py-2 shadow-sm transition-colors focus-within:border-brand/60',
          dragging ? 'border-brand bg-brand-soft' : 'border-line-2'
        )}
      >
        {files.length > 0 && (
          <ul data-testid="composer-files" className="flex flex-wrap gap-1.5 px-2 pb-2">
            {files.map((f, i) => (
              <li key={`${f.name}-${i}`} className="flex items-center gap-1 rounded-chip border border-line-2 bg-surface-2 py-0.5 pr-1 pl-2 text-[12px]">
                <Paperclip className="size-3" aria-hidden />
                {f.name}
                <button
                  type="button"
                  aria-label={t('composer.remove', { name: f.name })}
                  onClick={() => setFiles(files.filter((_, j) => j !== i))}
                  className="rounded-full p-0.5 text-fg-3 hover:bg-surface-pop hover:text-fg"
                >
                  <X className="size-3" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
        {error && (
          <p role="alert" className="px-3 pb-1 text-[12px] text-err">
            {error}
          </p>
        )}
        <div className="flex items-end gap-1.5">
          <button
            type="button"
            aria-label={t('composer.attach')}
            title={t('composer.attach')}
            onClick={() => picker.current?.click()}
            className="flex size-9 shrink-0 items-center justify-center rounded-full text-fg-3 outline-none hover:bg-surface-2 hover:text-fg focus-visible:ring-2 focus-visible:ring-brand/60"
          >
            <Paperclip className="size-[18px]" aria-hidden />
          </button>
          <input
            ref={picker}
            type="file"
            multiple
            hidden
            data-testid="composer-file-input"
            onChange={(e) => {
              addFiles(Array.from(e.target.files ?? []))
              e.target.value = ''
            }}
          />
          <textarea
            ref={area}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={listOpen}
            aria-controls={listOpen ? listId : undefined}
            aria-activedescendant={listOpen && suggestions[current] ? `${listId}-${suggestions[current].id}` : undefined}
            rows={1}
            aria-label={t('composer.message')}
            placeholder={dragging ? t('composer.drop') : t('composer.placeholder')}
            value={text}
            disabled={disabled}
            onChange={(e) => {
              setText(e.target.value)
              setCaret(e.target.selectionStart)
              setActive(0)
              setDismissed(null)
            }}
            onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            className="max-h-40 min-h-9 flex-1 resize-none bg-transparent py-2 text-[14px] leading-5 outline-none placeholder:text-fg-3 [field-sizing:content]"
          />
          {busy && onStop && (
            <button
              type="button"
              data-testid="composer-stop"
              aria-label={t('chat.stop')}
              title={t('chat.stop.hint')}
              onClick={() => {
                Promise.resolve(onStop()).catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
              }}
              className="flex size-9 shrink-0 items-center justify-center rounded-full border border-line-2 text-fg-2 outline-none hover:bg-surface-2 hover:text-fg focus-visible:ring-2 focus-visible:ring-brand/60"
            >
              <Square className="size-3.5 fill-current" aria-hidden />
            </button>
          )}
          <button
            type="button"
            aria-label={t('composer.send')}
            disabled={!canSend}
            onClick={() => void send()}
            className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand text-brand-ink outline-none transition-opacity focus-visible:ring-2 focus-visible:ring-brand/60 disabled:opacity-40"
          >
            <ArrowUp className="size-[18px]" aria-hidden />
          </button>
        </div>
      </div>
    </div>
  )
}
