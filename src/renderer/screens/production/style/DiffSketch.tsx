// A proposal's « avant / après » drawn from the pipeline itself when no saved preview shows it (parcours-utilisateur): 30 seconds of
// shots coloured by where their pictures come from, the shot length, the voice's pace and the captions as they would read. Only the
// lines that change are drawn, so the eye goes to the difference.
import { t } from '../../../../shared/fr'
import type { SketchView } from '../../../../shared/style-agent'

const WINDOW_S = 30
const KIND_COLOR: Record<string, string> = {
  archive: 'var(--color-warn)',
  motion: 'var(--color-brand)',
  imageAi: 'var(--color-fg-3)',
  clipAi: 'var(--color-err)',
  stock: 'var(--color-ok)',
  userFootage: 'var(--color-ok)',
  presenter: 'var(--color-fg)'
}
const KIND_FR: Record<string, string> = { archive: 'archives', motion: 'cartes animées', imageAi: 'images IA', clipAi: 'clips IA', stock: 'clips trouvés', userFootage: 'clips trouvés', presenter: 'présentateur' }

/** The shots of 30 seconds, each given a kind in the mix's proportions (a fixed, even spread: the same pipeline draws the same strip). */
function shots(s: SketchView): { kind: string; w: number }[] {
  const shot = Math.max(0.8, s.shotS ?? 5)
  const n = Math.max(1, Math.round(WINDOW_S / shot))
  const mix = Object.entries({ ...s.kinds, ...(s.presenter > 0 ? { presenter: s.presenter } : {}) }).filter(([, v]) => v > 0.01)
  const total = mix.reduce((a, [, v]) => a + v, 0) || 1
  const out: { kind: string; w: number }[] = []
  const given: Record<string, number> = {}
  for (let i = 0; i < n; i++) {
    // the kind furthest behind its share so far
    const next = mix.map(([k, v]) => ({ k, behind: (v / total) * (i + 1) - (given[k] ?? 0) })).sort((a, b) => b.behind - a.behind)[0]?.k ?? 'imageAi'
    given[next] = (given[next] ?? 0) + 1
    out.push({ kind: next, w: 100 / n })
  }
  return out
}

function Strip({ s, label }: { s: SketchView; label: string }) {
  return (
    <span className="flex flex-col gap-1">
      <span className="flex justify-between text-[10.5px] uppercase tracking-[0.05em] text-fg-3">
        <span>{label}</span>
        {s.shotS !== null && <span className="normal-case tracking-normal">{t('psketch.shot', { s: s.shotS.toFixed(1).replace('.', ',') })}</span>}
      </span>
      <span className="flex h-4 w-full overflow-hidden rounded-[4px] ring-1 ring-line" aria-hidden>
        {shots(s).map((x, i) => (
          <span key={i} style={{ width: `${x.w}%`, background: KIND_COLOR[x.kind] ?? 'var(--color-fg-3)' }} className="h-full border-r border-surface last:border-r-0" />
        ))}
      </span>
    </span>
  )
}

function Caption({ preset }: { preset: string | null }) {
  if (preset === null) return <span className="text-[11px] italic text-fg-4">{t('psketch.noCaptions')}</span>
  if (preset === 'word' || preset === 'word-by-word' || preset === 'shorts') return <span className="rounded-[3px] bg-black px-1.5 py-0.5 text-[12px] font-extrabold uppercase text-white">{t('psketch.word')}</span>
  if (preset === 'highlight') {
    return (
      <span className="rounded-[3px] bg-black px-1.5 py-0.5 text-[11.5px] font-semibold text-white">
        {t('psketch.line.a')} <span className="rounded-[2px] bg-brand px-0.5 text-brand-ink">{t('psketch.word.lower')}</span> {t('psketch.line.b')}
      </span>
    )
  }
  return <span className="rounded-[3px] bg-black/80 px-1.5 py-0.5 text-[11px] text-white">{t('psketch.line.a')} {t('psketch.word.lower')} {t('psketch.line.b')}</span>
}

export function DiffSketch({ before, after }: { before: SketchView; after: SketchView }) {
  const kindsChange = JSON.stringify(before.kinds) !== JSON.stringify(after.kinds) || before.shotS !== after.shotS || before.presenter !== after.presenter
  const paceChange = before.wordsPerMinute !== after.wordsPerMinute && before.wordsPerMinute !== null && after.wordsPerMinute !== null
  const captionsChange = before.captions !== after.captions
  if (!kindsChange && !paceChange && !captionsChange) return null
  const used = [...new Set([...Object.keys(before.kinds), ...Object.keys(after.kinds)].filter((k) => (before.kinds[k] ?? 0) > 0.01 || (after.kinds[k] ?? 0) > 0.01))]
  return (
    <span className="flex flex-col gap-2 rounded-field bg-surface-2 p-2.5 ring-1 ring-line" data-testid="diff-sketch">
      {kindsChange && (
        <>
          <Strip s={before} label={t('pdiff.before')} />
          <Strip s={after} label={t('pdiff.after')} />
          <span className="flex flex-wrap gap-x-2.5 gap-y-0.5 text-[10.5px] text-fg-3">
            {used.map((k) => (
              <span key={k} className="flex items-center gap-1">
                <span className="inline-block size-2 rounded-[2px]" style={{ background: KIND_COLOR[k] ?? 'var(--color-fg-3)' }} />
                {KIND_FR[k] ?? k}
              </span>
            ))}
            <span>· {t('psketch.window')}</span>
          </span>
        </>
      )}
      {paceChange && (
        <span className="flex items-center gap-2 text-[12px] text-fg-2">
          {t('psketch.pace', { before: Math.round(before.wordsPerMinute as number), after: Math.round(after.wordsPerMinute as number) })}
        </span>
      )}
      {captionsChange && (
        <span className="grid grid-cols-2 gap-2">
          <span className="flex flex-col items-start gap-1">
            <span className="text-[10.5px] uppercase tracking-[0.05em] text-fg-3">{t('pdiff.before')}</span>
            <Caption preset={before.captions} />
          </span>
          <span className="flex flex-col items-start gap-1">
            <span className="text-[10.5px] uppercase tracking-[0.05em] text-fg-3">{t('pdiff.after')}</span>
            <Caption preset={after.captions} />
          </span>
        </span>
      )}
    </span>
  )
}
