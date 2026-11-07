// The message composer: a rounded pill with an attach button, an auto-growing field, @mention autocomplete over the
// people of the conversation, and a send button. Enter sends, Shift+Enter breaks the line.
import { ArrowUp, Paperclip, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { t } from '../../../shared/fr'
import { AgentAvatar } from '@/components/proto/kit'
import { cn } from '@/lib/utils'
import { plain } from './chat-model'
import type { Attachment } from './chat-engine'
import type { TeamAgent } from './model'

const FAKE_FILES: Attachment[] = [
  { name: 'rushes-templiers.zip', sizeMb: 212 },
  { name: 'brief-chaine.pdf', sizeMb: 2 },
  { name: 'clips-gameplay-lot3.zip', sizeMb: 540 },
  { name: 'voix-reference.wav', sizeMb: 38 }
]

const QUERY_RE = /(^|\s)@([\p{L}œŒ'’-]*)$/u

export function Composer({
  onSend,
  mentionPool,
  placeholder,
  disabled
}: {
  onSend: (text: string, attachment?: Attachment) => void
  mentionPool: readonly TeamAgent[]
  placeholder: string
  disabled?: boolean
}) {
  const [value, setValue] = useState('')
  const [caret, setCaret] = useState(0)
  const [attachment, setAttachment] = useState<Attachment | null>(null)
  const [sel, setSel] = useState({ q: '', i: 0 })
  const [dismissed, setDismissed] = useState(false)
  const ref = useRef<HTMLTextAreaElement>(null)
  const nextFile = useRef(0)

  const query = useMemo(() => {
    const before = value.slice(0, caret)
    const m = QUERY_RE.exec(before)
    return m ? { text: m[2] ?? '', start: before.length - (m[2]?.length ?? 0) - 1 } : null
  }, [value, caret])

  const matches = useMemo(() => {
    if (!query) return []
    const q = plain(query.text)
    return mentionPool.filter((a) => plain(a.name).startsWith(q)).slice(0, 6)
  }, [query, mentionPool])
  const showMentions = !dismissed && query !== null && matches.length > 0

  // The highlighted suggestion goes back to the first one whenever the typed name changes.
  const index = sel.q === (query?.text ?? '') ? sel.i : 0
  const setIndex = (next: number | ((i: number) => number)): void =>
    setSel({ q: query?.text ?? '', i: typeof next === 'function' ? next(index) : next })

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`
  }, [value])

  function pick(agent: TeamAgent) {
    if (!query) return
    const first = agent.name.split(' ')[0] ?? agent.name
    const next = `${value.slice(0, query.start)}@${first} ${value.slice(caret)}`
    const pos = query.start + first.length + 2
    setValue(next)
    setCaret(pos)
    requestAnimationFrame(() => {
      ref.current?.focus()
      ref.current?.setSelectionRange(pos, pos)
    })
  }

  function submit() {
    const text = value.trim()
    if ((!text && !attachment) || disabled) return
    onSend(text, attachment ?? undefined)
    setValue('')
    setCaret(0)
    setAttachment(null)
  }

  return (
    <div className="relative mx-auto w-full max-w-[800px] px-6 pb-4">
      {showMentions && (
        <ul role="listbox" aria-label={t('msg.composer.mentions')} data-testid="mention-list" className="absolute bottom-full left-6 z-10 mb-1 w-[300px] overflow-hidden rounded-[12px] border border-line-2 bg-surface-pop p-1 shadow-[var(--shadow-pop)]">
          {matches.map((a, i) => (
            <li key={a.id} role="option" aria-selected={i === index}>
              <button
                type="button"
                data-testid={`mention-${a.id}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(a)}
                onMouseEnter={() => setIndex(i)}
                className={cn('flex w-full items-center gap-2.5 rounded-[8px] px-2.5 py-1.5 text-left', i === index && 'bg-selected')}
              >
                <AgentAvatar agent={a} size={22} showStatus={false} />
                <span className="text-[13px] font-medium text-fg">{a.name}</span>
                <span className="truncate text-[11.5px] text-fg-3">{a.roleLabel}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {attachment && (
        <div className="mb-2 flex" data-testid="composer-attachment">
          <span className="inline-flex items-center gap-2 rounded-full border border-line-2 bg-surface-2 py-1 pr-1.5 pl-3 text-[12.5px] text-fg-2">
            <Paperclip className="size-3.5 text-fg-3" aria-hidden />
            {attachment.name}
            <span className="num text-fg-3">{t('msg.attachment.size', { size: attachment.sizeMb })}</span>
            <button type="button" aria-label={t('common.close')} onClick={() => setAttachment(null)} className="rounded-full p-0.5 text-fg-3 hover:bg-hover hover:text-fg">
              <X className="size-3.5" aria-hidden />
            </button>
          </span>
        </div>
      )}
      <form
        className="flex items-end gap-1.5 rounded-[24px] border border-line-2 bg-surface-1 py-1.5 pr-1.5 pl-1.5 transition-colors focus-within:border-line-3"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <button
          type="button"
          aria-label={t('msg.composer.attach')}
          title={t('msg.composer.attach')}
          data-testid="composer-attach"
          onClick={() => {
            setAttachment(FAKE_FILES[nextFile.current % FAKE_FILES.length] ?? null)
            nextFile.current += 1
          }}
          className="inline-flex size-9 shrink-0 items-center justify-center rounded-full text-fg-3 transition-colors hover:bg-hover hover:text-fg"
        >
          <Paperclip className="size-[18px]" aria-hidden />
        </button>
        <textarea
          ref={ref}
          data-testid="composer-input"
          rows={1}
          value={value}
          placeholder={placeholder}
          aria-label={placeholder}
          onChange={(e) => {
            setValue(e.target.value)
            setCaret(e.target.selectionStart)
            setDismissed(false)
          }}
          onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
          onKeyDown={(e) => {
            if (showMentions) {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setIndex((i) => (i + 1) % matches.length)
                return
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault()
                setIndex((i) => (i - 1 + matches.length) % matches.length)
                return
              }
              if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault()
                const hit = matches[index]
                if (hit) pick(hit)
                return
              }
              if (e.key === 'Escape') {
                e.preventDefault()
                setDismissed(true)
                return
              }
            }
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              submit()
            }
          }}
          className="max-h-[140px] min-h-9 flex-1 resize-none self-center bg-transparent py-[7px] text-[14px] leading-[22px] text-fg outline-none placeholder:text-fg-3"
        />
        <button
          type="submit"
          aria-label={t('msg.composer.send')}
          data-testid="composer-send"
          disabled={disabled || (!value.trim() && !attachment)}
          className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-brand text-brand-ink transition-[background-color,transform] duration-150 hover:bg-brand/90 active:scale-95 disabled:bg-surface-3 disabled:text-fg-3"
        >
          <ArrowUp className="size-[18px]" aria-hidden />
        </button>
      </form>
    </div>
  )
}

