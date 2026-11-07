// The ways into « Créer une pipeline » (parcours-utilisateur, Charlie 02/11): seven paths, each with only the fields it needs — a
// channel link (clone, own, translate with its language, a little different), two channels and which axis comes from which (mix),
// a link per axis plus a style and instructions (create from scratch with inspirations), or one of my pipelines and what to change
// (rework). The form builds the `StudyInput` the agent receives; nothing is measured before « Analyser et proposer ».
import { Copy, GitMerge, Languages, Shuffle, Sparkles, Tv, Wrench } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { t, type MessageKey } from '../../../../shared/fr'
import { INSPIRATION_AXES, type InspirationAxisId, type StudyInput, type StudyPath, type StudyScope } from '../../../../shared/style-agent'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useApi } from '@/state/client'
import { Chip } from '../agent/parts'

const ICONS: Record<StudyPath, ReactNode> = {
  clone: <Copy className="size-4" />,
  own: <Tv className="size-4" />,
  translate: <Languages className="size-4" />,
  different: <Shuffle className="size-4" />,
  mix: <GitMerge className="size-4" />,
  inspire: <Sparkles className="size-4" />,
  rework: <Wrench className="size-4" />
}
export const PATH_ORDER: readonly StudyPath[] = ['clone', 'own', 'translate', 'different', 'mix', 'inspire', 'rework']

export function PathPicker({ path, onPath }: { path: StudyPath; onPath: (p: StudyPath) => void }) {
  return (
    <section className="mb-7 flex flex-col gap-3" data-testid="style-paths">
      <h2 className="text-[15px] font-semibold text-fg">{t('ppath.title')}</h2>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {PATH_ORDER.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onPath(p)}
            data-testid={`style-path-${p}`}
            aria-pressed={path === p}
            className={cn(
              'flex items-start gap-2.5 rounded-[12px] border p-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-ring',
              path === p ? 'border-brand-line bg-brand-soft' : 'border-line-2 bg-surface-1 hover:bg-surface-2'
            )}
          >
            <span aria-hidden className={cn('mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-[8px]', path === p ? 'bg-brand text-brand-ink' : 'bg-surface-3 text-fg-2')}>
              {ICONS[p]}
            </span>
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-[13px] font-semibold text-fg">{t(`ppath.${p}` as MessageKey)}</span>
              <span className="text-[11.5px] leading-[1.4] text-fg-3">{t(`ppath.${p}.hint` as MessageKey)}</span>
            </span>
          </button>
        ))}
      </div>
    </section>
  )
}

const field = 'w-full rounded-md bg-surface px-3 py-2 text-[13px] text-fg ring-1 ring-line placeholder:text-fg-3 focus-visible:outline-2 focus-visible:outline-ring'
const LANGS = ['fr', 'en', 'es', 'de', 'pt', 'it'] as const
/** A pasted video link (not a channel): the owner says whether they copy this video or its whole channel. */
const VIDEO_LINK = /youtube\.com\/watch\?|youtu\.be\/|youtube\.com\/shorts\//i

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[13px] font-semibold text-fg">{label}</span>
      {hint && <span className="text-[12px] text-fg-2">{hint}</span>}
      {children}
    </label>
  )
}

/** The fields of one path; `onGo` gets the agent's input. */
export function PathForm({ path, busy, onGo }: { path: StudyPath; busy: boolean; onGo: (input: StudyInput) => void }) {
  const [link, setLink] = useState('')
  const [words, setWords] = useState('')
  const [language, setLanguage] = useState('')
  const [instructions, setInstructions] = useState('')
  const [links, setLinks] = useState<Record<InspirationAxisId, string>>({ content: '', editing: '', motion: '', script: '' })
  const [a, setA] = useState('')
  const [b, setB] = useState('')
  const [from, setFrom] = useState<Record<InspirationAxisId, 'A' | 'B' | ''>>({ content: 'A', editing: 'B', motion: 'B', script: 'A' })
  const [recipeId, setRecipeId] = useState<number | null>(null)
  const [scope, setScope] = useState<StudyScope>('video')
  const oneVideo = link.trim().split(/\s+/).filter(Boolean).length === 1 && VIDEO_LINK.test(link)
  const recipes = useApi('recipes.list', ['production'])
  const mine = (recipes.data ?? []).filter((r) => !r.archived)

  const input = (): StudyInput | null => {
    const common = { path, ...(words.trim() ? { text: words.trim() } : {}), ...(instructions.trim() ? { instructions: instructions.trim() } : {}) }
    switch (path) {
      case 'clone':
      case 'own':
      case 'different':
        return link.trim() ? { ...common, links: link.split(/\s+/).filter(Boolean), ...(path === 'own' ? { own: true } : {}), ...(oneVideo && scope === 'channel' ? { scope } : {}) } : null
      case 'translate':
        return link.trim() && language ? { ...common, links: link.split(/\s+/).filter(Boolean), language, ...(oneVideo && scope === 'channel' ? { scope } : {}) } : null
      case 'mix': {
        if (!a.trim() || !b.trim()) return null
        const axes = INSPIRATION_AXES.filter((x) => from[x]).map((x) => ({ axis: x, link: (from[x] === 'A' ? a : b).trim() }))
        return { ...common, inspirations: axes }
      }
      case 'inspire': {
        const axes = INSPIRATION_AXES.filter((x) => links[x].trim()).map((x) => ({ axis: x, link: links[x].trim() }))
        return axes.length > 0 || words.trim().length >= 3 ? { ...common, inspirations: axes } : null
      }
      case 'rework':
        return recipeId !== null ? { ...common, recipeId } : null
    }
  }
  const ready = input()

  return (
    <section className="mb-9 flex max-w-[760px] flex-col gap-4" data-testid={`style-form-${path}`}>
      {(path === 'clone' || path === 'own' || path === 'translate' || path === 'different') && (
        <Field label={t(path === 'own' ? 'ppath.link.own' : 'ppath.link')} hint={t('pstyle.links.help')}>
          <textarea data-testid="style-links-text" rows={2} value={link} placeholder={t('ppath.link.placeholder')} onChange={(e) => setLink(e.target.value)} className={cn(field, 'resize-none font-mono text-[12px]')} />
        </Field>
      )}
      {path !== 'own' && oneVideo && (
        <div className="flex flex-col gap-1.5" data-testid="style-scope">
          <span className="text-[13px] font-semibold text-fg">{t('ppath.scope')}</span>
          <div className="flex flex-wrap gap-1.5">
            {(['video', 'channel'] as const).map((v) => (
              <Chip key={v} on={scope === v} onClick={() => setScope(v)} testId={`style-scope-${v}`}>
                {t(`ppath.scope.${v}` as MessageKey)}
              </Chip>
            ))}
          </div>
          <span className="text-[11.5px] text-fg-3">{t(`ppath.scope.${scope}.hint` as MessageKey)}</span>
        </div>
      )}
      {path === 'translate' && (
        <div className="flex flex-col gap-1.5" data-testid="style-language">
          <span className="text-[13px] font-semibold text-fg">{t('pstyle.language')}</span>
          <div className="flex flex-wrap gap-1.5">
            {LANGS.map((l) => (
              <Chip key={l} on={language === l} onClick={() => setLanguage(l)}>
                {t(`pstyle.language.${l}` as MessageKey)}
              </Chip>
            ))}
          </div>
        </div>
      )}
      {path === 'mix' && (
        <>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Field label={t('ppath.linkA')}>
              <input data-testid="style-link-a" value={a} placeholder={t('ppath.link.placeholder')} onChange={(e) => setA(e.target.value)} className={cn(field, 'font-mono text-[12px]')} />
            </Field>
            <Field label={t('ppath.linkB')}>
              <input data-testid="style-link-b" value={b} placeholder={t('ppath.link.placeholder')} onChange={(e) => setB(e.target.value)} className={cn(field, 'font-mono text-[12px]')} />
            </Field>
          </div>
          <div className="flex flex-col gap-2" data-testid="style-mix-axes">
            <span className="text-[13px] font-semibold text-fg">{t('ppath.mix.axes')}</span>
            {INSPIRATION_AXES.map((x) => (
              <div key={x} className="flex flex-wrap items-center gap-2">
                <span className="w-[140px] text-[12.5px] text-fg-2">{t(`ppath.axis.${x}` as MessageKey)}</span>
                {(['A', 'B', ''] as const).map((v) => (
                  <Chip key={v || 'none'} on={from[x] === v} onClick={() => setFrom({ ...from, [x]: v })}>
                    {v ? t(v === 'A' ? 'ppath.linkA' : 'ppath.linkB') : t('ppath.axis.none')}
                  </Chip>
                ))}
              </div>
            ))}
          </div>
        </>
      )}
      {path === 'inspire' && (
        <div className="flex flex-col gap-3" data-testid="style-axes">
          <span className="text-[12px] text-fg-3">{t('ppath.inspire.optional')}</span>
          {INSPIRATION_AXES.map((x) => (
            <Field key={x} label={t(`ppath.axis.${x}` as MessageKey)} hint={t(`ppath.axis.${x}.hint` as MessageKey)}>
              <input data-testid={`style-axis-${x}`} value={links[x]} placeholder={t('ppath.link.placeholder')} onChange={(e) => setLinks({ ...links, [x]: e.target.value })} className={cn(field, 'font-mono text-[12px]')} />
            </Field>
          ))}
        </div>
      )}
      {path === 'rework' && (
        <div className="flex flex-col gap-1.5" data-testid="style-rework">
          <span className="text-[13px] font-semibold text-fg">{t('ppath.rework.pick')}</span>
          {mine.length === 0 ? (
            <span className="text-[12.5px] text-fg-3">{t('ppath.rework.none')}</span>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {mine.map((r) => (
                <Chip key={r.id} on={recipeId === r.id} onClick={() => setRecipeId(r.id)}>
                  {r.name}
                </Chip>
              ))}
            </div>
          )}
        </div>
      )}
      {path !== 'rework' && (
        <Field label={path === 'inspire' || path === 'mix' ? t('ppath.style') : t('pstyle.words')}>
          <textarea data-testid="create-text" rows={2} value={words} placeholder={t(path === 'inspire' ? 'ppath.style.placeholder' : 'pstyle.words.placeholder')} onChange={(e) => setWords(e.target.value)} className={cn(field, 'resize-none')} />
        </Field>
      )}
      <Field label={path === 'rework' ? t('ppath.rework.what') : t('ppath.instructions')}>
        <textarea data-testid="style-instructions" rows={2} value={instructions} placeholder={t(path === 'rework' ? 'ppath.rework.placeholder' : 'ppath.instructions.placeholder')} onChange={(e) => setInstructions(e.target.value)} className={cn(field, 'resize-none')} />
      </Field>
      <div className="flex flex-col gap-1.5">
        <Button className="self-start" disabled={busy || !ready} onClick={() => ready && onGo(ready)} data-testid="style-analyse">
          {t('ppath.go')}
        </Button>
        {path !== 'rework' && <span className="text-[11.5px] text-fg-3">{t('ppath.cost')}</span>}
      </div>
    </section>
  )
}
