// A small, safe markdown renderer for chat replies: headings, lists, quotes, code, bold / italic / inline code,
// links (shown, never followed) and @mentions. It builds React nodes (no innerHTML) and tolerates half-streamed
// text: an unclosed fence or emphasis is drawn as it is so far.
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

const INLINE = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\*[^*\s][^*\n]*\*)|(\[[^\]\n]+\]\([^)\s]+\))|((?:^|(?<=\s))@[\p{L}\p{N}_-]+)/gu

export function Inline({ text }: { text: string }) {
  const out: ReactNode[] = []
  let last = 0
  let key = 0
  for (const m of text.matchAll(INLINE)) {
    const at = m.index
    if (at > last) out.push(text.slice(last, at))
    const tok = m[0]
    if (m[1]) {
      out.push(
        <code key={key++} className="rounded bg-surface-pop px-1 py-0.5 font-mono text-[12.5px]">
          {tok.slice(1, -1)}
        </code>
      )
    } else if (m[2]) {
      out.push(<strong key={key++}>{tok.slice(2, -2)}</strong>)
    } else if (m[3]) {
      out.push(<em key={key++}>{tok.slice(1, -1)}</em>)
    } else if (m[4]) {
      const [, label] = /^\[([^\]]+)\]/.exec(tok) ?? []
      out.push(
        <span key={key++} className="text-brand-fg underline underline-offset-2" title={/\(([^)]+)\)$/.exec(tok)?.[1] ?? ''}>
          {label}
        </span>
      )
    } else {
      out.push(
        <span key={key++} data-testid="mention" className="rounded bg-brand-soft px-1 font-medium text-brand-fg">
          {tok}
        </span>
      )
    }
    last = at + tok.length
  }
  if (last < text.length) out.push(text.slice(last))
  return <>{out}</>
}

type Block =
  | { t: 'p'; text: string }
  | { t: 'h'; level: number; text: string }
  | { t: 'ul' | 'ol'; items: string[] }
  | { t: 'quote'; text: string }
  | { t: 'code'; lang: string; text: string }
  | { t: 'hr' }

export function parseBlocks(src: string): Block[] {
  const lines = src.replace(/\r\n/g, '\n').split('\n')
  const out: Block[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i] ?? ''
    const fence = /^```\s*(\S*)/.exec(line)
    if (fence) {
      const body: string[] = []
      i++
      while (i < lines.length && !/^```\s*$/.test(lines[i] ?? '')) body.push(lines[i++] ?? '')
      i++ // closing fence (absent while streaming)
      out.push({ t: 'code', lang: fence[1] ?? '', text: body.join('\n') })
      continue
    }
    if (line.trim() === '') {
      i++
      continue
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line)
    if (h) {
      out.push({ t: 'h', level: (h[1] ?? '#').length, text: h[2] ?? '' })
      i++
      continue
    }
    if (/^(-{3,}|\*{3,})\s*$/.test(line)) {
      out.push({ t: 'hr' })
      i++
      continue
    }
    if (/^>\s?/.test(line)) {
      const q: string[] = []
      while (i < lines.length && /^>\s?/.test(lines[i] ?? '')) q.push((lines[i++] ?? '').replace(/^>\s?/, ''))
      out.push({ t: 'quote', text: q.join('\n') })
      continue
    }
    const li = /^\s*([-*]|\d+[.)])\s+/
    if (li.test(line)) {
      const ordered = /^\s*\d/.test(line)
      const items: string[] = []
      while (i < lines.length && li.test(lines[i] ?? '')) items.push((lines[i++] ?? '').replace(li, ''))
      out.push({ t: ordered ? 'ol' : 'ul', items })
      continue
    }
    const p: string[] = []
    while (
      i < lines.length &&
      (lines[i] ?? '').trim() !== '' &&
      !/^(```|#{1,4}\s|>\s?|\s*([-*]|\d+[.)])\s+)/.test(lines[i] ?? '')
    )
      p.push(lines[i++] ?? '')
    if (p.length === 0) p.push(lines[i++] ?? '') // always advance
    out.push({ t: 'p', text: p.join('\n') })
  }
  return out
}

const HEADING = ['', 'text-[17px]', 'text-[15.5px]', 'text-[14.5px]', 'text-[14px]']

export function Markdown({ text, className }: { text: string; className?: string }) {
  return (
    <div data-testid="markdown" className={cn('space-y-2.5 break-words', className)}>
      {parseBlocks(text).map((b, i) => {
        switch (b.t) {
          case 'p':
            return (
              <p key={i} className="whitespace-pre-wrap">
                <Inline text={b.text} />
              </p>
            )
          case 'h':
            return (
              <p key={i} role="heading" aria-level={b.level} className={cn('font-semibold text-fg', HEADING[b.level])}>
                <Inline text={b.text} />
              </p>
            )
          case 'ul':
          case 'ol': {
            const L = b.t
            return (
              <L key={i} className={cn('space-y-1 pl-5', L === 'ul' ? 'list-disc' : 'list-decimal')}>
                {b.items.map((it, j) => (
                  <li key={j}>
                    <Inline text={it} />
                  </li>
                ))}
              </L>
            )
          }
          case 'quote':
            return (
              <blockquote key={i} className="border-l-2 border-line-2 pl-3 text-fg-2">
                <Inline text={b.text} />
              </blockquote>
            )
          case 'code':
            return (
              <pre key={i} className="overflow-x-auto rounded-field border border-line bg-bg p-3 font-mono text-[12.5px] leading-snug">
                <code>{b.text}</code>
              </pre>
            )
          case 'hr':
            return <hr key={i} className="border-line" />
        }
      })}
    </div>
  )
}
