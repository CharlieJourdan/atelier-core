import { useState, type ReactNode } from 'react'
import { ArrowRight, Check, Lock, Plus } from 'lucide-react'
import { SiteLayout } from '../components/SiteLayout'
import { fmtEuro, fmtNum, useLang, type TFn } from '../i18n'
import { ENTERPRISE, PLANS } from '../plans'
import { Link } from '../router'
import { Chip, Container, Dot, LinkButton, ShotFrame, buttonClass, cx } from '../ui'

/* ------------------------------------------------------------------ building blocks */

function Feature({
  id,
  title,
  body,
  visual,
  flip = false,
  children
}: {
  id: string
  title: string
  body: string
  visual: ReactNode
  flip?: boolean
  children?: ReactNode
}) {
  return (
    <section id={id} className="py-20 md:py-24">
      <Container className="grid items-center gap-10 lg:grid-cols-12 lg:gap-14">
        <div className={cx('lg:col-span-5', flip && 'lg:order-2')}>
          <h2 className="h2 m-0">{title}</h2>
          <p className="lead mb-0 mt-5">{body}</p>
          {children}
        </div>
        <div className={cx('min-w-0 lg:col-span-7', flip && 'lg:order-1')}>{visual}</div>
      </Container>
    </section>
  )
}

/** Text on top (title left, lead and rows right), the screenshot at full width below: for dense app screens. */
function WideFeature({ id, title, body, visual, children }: { id: string; title: string; body: string; visual: ReactNode; children?: ReactNode }) {
  return (
    <section id={id} className="py-20 md:py-24">
      <Container>
        <div className="grid gap-6 lg:grid-cols-12 lg:gap-14">
          <h2 className="h2 m-0 lg:col-span-5">{title}</h2>
          <div className="lg:col-span-7">
            <p className="lead m-0">{body}</p>
            {children}
          </div>
        </div>
        <div className="mt-12">{visual}</div>
      </Container>
    </section>
  )
}

function Rows({ items }: { items: { title?: string; text: string }[] }) {
  return (
    <ul className="hairline-list m-0 mt-8 list-none border-y border-line p-0">
      {items.map((it) => (
        <li key={it.text} className="py-3.5 text-[14px] leading-[1.5]">
          {it.title && <span className="font-medium text-fg">{it.title} </span>}
          <span className="text-fg-3">{it.text}</span>
        </li>
      ))}
    </ul>
  )
}

/* ------------------------------------------------------------------ hero */

function Hero() {
  const { t } = useLang()
  return (
    <section className="pb-6 pt-14 md:pt-24">
      <Container>
        <Chip className="mb-7">
          <Dot tone="ok" />
          {t('hero.badge')}
        </Chip>
        <h1 className="hero-title m-0 max-w-[920px]">{t('hero.title')}</h1>
        <p className="lead mb-0 mt-6 max-w-[620px] text-[19px]">{t('hero.sub')}</p>
        <div className="mt-9 flex flex-wrap items-center gap-3">
          <LinkButton to="/inscription" size="lg">
            {t('common.start')}
            <ArrowRight size={16} strokeWidth={1.75} />
          </LinkButton>
          <LinkButton to="/app/" variant="secondary" size="lg">
            {t('common.demo')}
          </LinkButton>
        </div>
        <p className="m-0 mt-5 max-w-[520px] text-[13px] text-fg-3">{t('hero.note')}</p>
        <div className="mt-14 md:mt-16">
          <ShotFrame name="accueil" alt={t('hero.shotAlt')} eager radius={20} />
        </div>
      </Container>
    </section>
  )
}

/* ------------------------------------------------------------------ team */

const ROLES = [1, 2, 3, 4, 5, 6, 7, 8]

function TeamSection() {
  const { t } = useLang()
  return (
    <section id="equipe" className="py-20 md:py-24">
      <Container>
        <div className="grid items-end gap-6 lg:grid-cols-12 lg:gap-14">
          <h2 className="h2 m-0 lg:col-span-5">{t('team.title')}</h2>
          <p className="lead m-0 lg:col-span-7">{t('team.body')}</p>
        </div>
        <div className="mt-12">
          <ShotFrame name="agents" alt={t('team.title')} />
        </div>
        <ul className="m-0 mt-12 grid list-none grid-cols-1 gap-x-10 border-t border-line p-0 sm:grid-cols-2 lg:grid-cols-4">
          {ROLES.map((n) => (
            <li key={n} className="border-b border-line py-5">
              <p className="m-0 text-[15px] font-medium tracking-[-0.01em] text-fg">{t(`team.r${n}.t`)}</p>
              <p className="m-0 mt-1.5 text-[14px] leading-[1.5] text-fg-3">{t(`team.r${n}.d`)}</p>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  )
}

/* ------------------------------------------------------------------ eyes (video analysis panel) */

const TILE_TONES = ['var(--ch-1)', 'var(--ch-3)', 'var(--ch-2)', 'var(--ch-4)', 'var(--ch-5)', 'var(--ch-6)']
const TILE_TIMES = ['0:08', '1:42', '3:20', '4:15', '7:03', '10:50']

function FrameTile({ index }: { index: number }) {
  const tone = TILE_TONES[index % TILE_TONES.length] ?? 'var(--ch-1)'
  const kind = index % 3
  return (
    <div className="relative aspect-video overflow-hidden rounded-[8px]" style={{ background: `color-mix(in oklab, ${tone} 34%, var(--surface-3))` }}>
      <svg viewBox="0 0 160 90" className="absolute inset-0 size-full" preserveAspectRatio="none" aria-hidden="true">
        <rect y="58" width="160" height="32" fill="var(--bg)" opacity="0.5" />
        {kind === 0 && <circle cx="112" cy="30" r="12" fill="var(--fg)" opacity="0.55" />}
        {kind === 1 && <path d="M0 58 38 22l26 26 22-16 42 26z" fill="var(--bg)" opacity="0.5" />}
        {kind === 2 && <rect x="26" y="26" width="46" height="32" rx="3" fill="var(--fg)" opacity="0.4" />}
      </svg>
      <span className="num absolute bottom-1 left-1.5 rounded-[4px] bg-black/55 px-1 text-[10px] font-medium text-white">{TILE_TIMES[index]}</span>
    </div>
  )
}

const TRANSCRIPT = [
  { at: '0:08', tag: 'Accroche', text: 'Il y a vingt-quatre siècles, un homme décrit une île qui n’existe sur aucune carte.' },
  { at: '1:42', tag: 'Relance', text: 'Mais pourquoi cette histoire revient-elle sans cesse, siècle après siècle ?' },
  { at: '4:15', tag: 'Rupture', text: 'Les dates de Platon ne correspondent à rien de ce qu’on a retrouvé.' },
  { at: '10:50', tag: 'Conclusion', text: 'Neuf mille ans, une île, aucune preuve. Voilà ce qu’il faut retenir.' }
]

const WATCHED = [
  { name: 'Mystères & Cie', subs: '612 k', score: '3,1', hot: true },
  { name: 'Les Veilleurs', subs: '143 k', score: '3,4', hot: true },
  { name: 'Dossier Zéro', subs: '274 k', score: '2,7', hot: false },
  { name: 'Histoires Oubliées', subs: '1,2 M', score: '2,4', hot: false }
]

function EyesPanel() {
  const { t } = useLang()
  return (
    <div className="card overflow-hidden" style={{ borderRadius: 20 }}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3.5">
        <div className="min-w-0">
          <p className="m-0 truncate text-[14px] font-medium">{t('eyes.panel.title')} · Atlantide : ce que Platon n’a jamais dit</p>
          <p className="m-0 text-[12px] text-fg-3">Histoires Oubliées · 11:42</p>
        </div>
        <Chip>
          <Dot tone="ok" />
          {t('eyes.panel.score')} <span className="num">2,4</span>
        </Chip>
      </div>
      <div className="grid gap-6 p-5 md:grid-cols-[1.1fr_1fr]">
        <div className="min-w-0">
          <p className="m-0 mb-2.5 text-[12px] font-medium text-fg-3">{t('eyes.panel.frames')}</p>
          <div className="grid grid-cols-3 gap-2">
            {TILE_TONES.map((_, i) => (
              <FrameTile key={i} index={i} />
            ))}
          </div>
          <p className="m-0 mb-2 mt-6 text-[12px] font-medium text-fg-3">{t('eyes.panel.findings')}</p>
          <ul className="m-0 flex list-none flex-col gap-2 p-0 text-[13px] text-fg-2">
            {['f1', 'f2', 'f3'].map((k) => (
              <li key={k} className="flex items-start gap-2">
                <Check size={14} strokeWidth={1.75} className="mt-[3px] shrink-0 text-fg-3" />
                {t(`eyes.panel.${k}`)}
              </li>
            ))}
          </ul>
        </div>
        <div className="min-w-0">
          <p className="m-0 mb-2.5 text-[12px] font-medium text-fg-3">{t('eyes.panel.transcript')}</p>
          <ul className="hairline-list m-0 list-none p-0">
            {TRANSCRIPT.map((l) => (
              <li key={l.at} className="py-2.5 first:pt-0">
                <div className="flex items-center gap-2">
                  <span className="num text-[12px] text-fg-3">{l.at}</span>
                  <Chip className="h-5 px-2 text-[11px]">{l.tag}</Chip>
                </div>
                <p className="m-0 mt-1 text-[13px] leading-[1.45] text-fg">{l.text}</p>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className="border-t border-line bg-surface-2 px-5 py-4">
        <p className="m-0 mb-2 text-[12px] font-medium text-fg-3">{t('eyes.panel.watching')}</p>
        <ul className="m-0 grid list-none gap-x-8 gap-y-1.5 p-0 sm:grid-cols-2">
          {WATCHED.map((c) => (
            <li key={c.name} className="flex items-center justify-between gap-3 text-[13px]">
              <span className="truncate text-fg">{c.name}</span>
              <span className="flex shrink-0 items-center gap-2 text-fg-3">
                <span className="num">{c.subs}</span>
                <span className={cx('num rounded-full px-2 py-0.5 text-[12px] font-medium', c.hot ? 'bg-ok-soft text-ok' : 'bg-surface-3 text-fg-2')}>
                  {c.score}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ automation matrix */

type Level = 'auto' | 'review' | 'mine'
const LEVELS: Level[] = ['auto', 'review', 'mine']
const MATRIX: { key: string; initial: Level; locked?: boolean }[] = [
  { key: 'control.s1', initial: 'auto' },
  { key: 'control.s2', initial: 'review' },
  { key: 'control.s3', initial: 'auto' },
  { key: 'control.s4', initial: 'auto' },
  { key: 'control.s5', initial: 'review' },
  { key: 'control.s6', initial: 'review', locked: true }
]

function AutomationMatrix({ t }: { t: TFn }) {
  const [levels, setLevels] = useState<Record<string, Level>>(() => Object.fromEntries(MATRIX.map((r) => [r.key, r.initial])))
  return (
    <div className="card p-2 sm:p-3" style={{ borderRadius: 20 }}>
      <div role="radiogroup" aria-label={t('control.title')} className="min-w-0">
        <div className="grid grid-cols-3 items-end gap-x-1 px-3 pb-2 pt-2 sm:grid-cols-[minmax(0,1fr)_repeat(3,108px)]">
          <span className="hidden sm:block" />
          {LEVELS.map((l) => (
            <span key={l} className="text-center text-[12px] font-medium text-fg-3">
              {t(`control.${l}`)}
            </span>
          ))}
        </div>
        <div className="hairline-list">
          {MATRIX.map((row) => (
            <div
              key={row.key}
              className="grid grid-cols-3 items-center gap-x-1 gap-y-2.5 rounded-[10px] px-3 py-3 hover:bg-hover sm:grid-cols-[minmax(0,1fr)_repeat(3,108px)] sm:gap-y-0"
            >
              <div className="col-span-3 min-w-0 pr-2 sm:col-span-1">
                <p className="m-0 text-[14px] font-medium">{t(row.key)}</p>
                {row.locked && (
                  <p className="m-0 mt-0.5 flex items-center gap-1 text-[12px] text-fg-3">
                    <Lock size={11} strokeWidth={1.75} />
                    {t('control.locked')}
                  </p>
                )}
              </div>
              {LEVELS.map((l) => {
                const disabled = row.locked === true && l === 'auto'
                const selected = levels[row.key] === l
                return (
                  <div key={l} className="flex justify-center">
                    <button
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      aria-label={`${t(row.key)}: ${t(`control.${l}`)}`}
                      disabled={disabled}
                      onClick={() => setLevels((s) => ({ ...s, [row.key]: l }))}
                      className={cx(
                        'grid size-6 place-items-center rounded-full border transition-colors disabled:cursor-not-allowed',
                        selected ? 'border-ink bg-ink text-ink-fg' : 'border-line-3 text-transparent hover:border-fg-3',
                        disabled && 'border-dashed opacity-40'
                      )}
                    >
                      {selected ? <Check size={13} strokeWidth={2.25} /> : disabled ? <Lock size={11} strokeWidth={1.75} className="text-fg-3" /> : null}
                    </button>
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </div>
      <p className="m-0 px-3 pb-2 pt-3 text-[12px] text-fg-3">{t('control.try')}</p>
    </div>
  )
}

/* ------------------------------------------------------------------ more: brain, scan, discord */

const NICHE_NODES = [
  { x: 128, y: 92, r: 30, label: 'Histoire', c: 1 },
  { x: 232, y: 58, r: 22, label: 'Mystères', c: 3 },
  { x: 236, y: 140, r: 26, label: 'Faits rares', c: 2 },
  { x: 62, y: 156, r: 18, label: 'Animaux', c: 5 },
  { x: 150, y: 176, r: 14, label: 'Cartes', c: 6 },
  { x: 52, y: 62, r: 14, label: 'Reddit', c: 4 }
]
const NICHE_LINKS: [number, number][] = [
  [0, 1],
  [0, 2],
  [0, 3],
  [0, 4],
  [0, 5],
  [1, 2],
  [3, 4]
]

function NicheMap() {
  return (
    <svg viewBox="0 0 290 210" role="img" aria-label="Carte de niches" className="block h-auto w-full">
      {NICHE_LINKS.map(([a, b]) => {
        const p = NICHE_NODES[a]
        const q = NICHE_NODES[b]
        if (!p || !q) return null
        return <line key={`${a}-${b}`} x1={p.x} y1={p.y} x2={q.x} y2={q.y} stroke="var(--line-3)" strokeWidth="1" />
      })}
      {NICHE_NODES.map((n) => (
        <g key={n.label}>
          <circle cx={n.x} cy={n.y} r={n.r} fill={`color-mix(in oklab, var(--ch-${n.c}) 38%, var(--surface-3))`} stroke="var(--line-2)" />
          <text x={n.x} y={n.y + n.r + 13} textAnchor="middle" fontSize="10.5" fill="var(--fg-2)">
            {n.label}
          </text>
        </g>
      ))}
    </svg>
  )
}

function ScanMock() {
  return (
    <div className="flex h-full flex-col justify-center gap-3 text-[13px]">
      <div className="flex h-10 items-center rounded-[12px] border border-line-2 bg-surface-1 px-3.5 text-fg">youtube.com/@grandesenigmes</div>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {[
          ['42 vidéos analysées', true],
          ['Style : documentaire narré, voix posée', true],
          ['10 concurrents trouvés', true],
          ['Miniatures : visage absent, texte court', false]
        ].map(([label, done]) => (
          <li key={String(label)} className="flex items-center gap-2 text-fg-2">
            {done ? <Check size={14} strokeWidth={1.75} className="shrink-0 text-ok" /> : <span className="skeleton-pulse inline-block size-3 shrink-0 rounded-full border border-line-3" />}
            {label}
          </li>
        ))}
      </ul>
    </div>
  )
}

function DiscordMock({ t }: { t: TFn }) {
  return (
    <div className="flex h-full flex-col justify-center">
      <div className="rounded-[16px] border border-line-2 bg-surface-1 p-3.5 text-[13px]">
        <p className="m-0 mb-2.5 text-[12px] text-fg-3"># {t('more.discord.channel')}</p>
        <div className="flex gap-2.5">
          <span aria-hidden="true" className="size-7 shrink-0 rounded-full" style={{ background: 'radial-gradient(120% 120% at 30% 25%, var(--ch-6), var(--ch-1))' }} />
          <div className="min-w-0">
            <p className="m-0 font-medium">
              Atlas <span className="ml-1 text-[11px] font-normal text-fg-3">18:42</span>
            </p>
            <p className="m-0 mt-0.5 leading-[1.45] text-fg-2">{t('more.discord.msg')}</p>
            <div className="mt-2.5 flex gap-2">
              <span className="inline-flex h-7 items-center rounded-full bg-ink px-3 text-[12px] font-medium text-ink-fg">{t('more.discord.ok')}</span>
              <span className="inline-flex h-7 items-center rounded-full border border-line-2 px-3 text-[12px] text-fg-2">{t('more.discord.later')}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function MoreSection() {
  const { t } = useLang()
  const cards: { key: string; visual: ReactNode }[] = [
    { key: 'brain', visual: <NicheMap /> },
    { key: 'scan', visual: <ScanMock /> },
    { key: 'discord', visual: <DiscordMock t={t} /> }
  ]
  return (
    <section id="plus" className="py-20 md:py-24">
      <Container>
        <h2 className="h2 m-0 max-w-[640px]">{t('more.title')}</h2>
        <div className="mt-12 grid gap-4 md:grid-cols-3">
          {cards.map((c) => (
            <article key={c.key} className="fill-card flex flex-col p-6" style={{ borderRadius: 20 }}>
              <div className="flex h-[220px] items-center">
                <div className="w-full">{c.visual}</div>
              </div>
              <h3 className="m-0 mt-6 text-[17px] font-medium tracking-[-0.015em]">{t(`more.${c.key}.t`)}</h3>
              <p className="m-0 mt-2 text-[14px] leading-[1.55] text-fg-3">{t(`more.${c.key}.d`)}</p>
            </article>
          ))}
        </div>
      </Container>
    </section>
  )
}

/* ------------------------------------------------------------------ subscription */

function SubscriptionSection() {
  const { t } = useLang()
  return (
    <section id="abonnement" className="py-20 md:py-24">
      <Container>
        <div className="grid items-end gap-6 lg:grid-cols-12 lg:gap-14">
          <h2 className="h2 m-0 lg:col-span-6">{t('sub.title')}</h2>
          <p className="lead m-0 lg:col-span-6">{t('sub.body')}</p>
        </div>
        <div className="mt-12 grid gap-10 lg:grid-cols-12 lg:gap-14">
          <div className="min-w-0 lg:col-span-7">
            <ShotFrame name="ordinateurs" alt={t('sub.shotAlt')} aspect={1.33} crop={{ x: 0.169, y: 0, w: 0.831 }} />
          </div>
          <ol className="hairline-list m-0 list-none border-y border-line p-0 lg:col-span-5">
            {[1, 2, 3].map((n) => (
              <li key={n} className="flex gap-4 py-5">
                <span className="num mt-0.5 w-5 shrink-0 text-[13px] text-fg-3">{n}</span>
                <div>
                  <h3 className="m-0 text-[16px] font-medium tracking-[-0.015em]">{t(`sub.c${n}.t`)}</h3>
                  <p className="m-0 mt-1.5 text-[14px] leading-[1.55] text-fg-3">{t(`sub.c${n}.d`)}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
        <p className="m-0 mt-8 max-w-[760px] text-[13px] text-fg-3">{t('sub.legal')}</p>
      </Container>
    </section>
  )
}

/* ------------------------------------------------------------------ pricing teaser and FAQ */

function PricingTeaser() {
  const { t, lang } = useLang()
  return (
    <section id="tarifs" className="py-20 md:py-24">
      <Container>
        <div className="grid items-end gap-6 lg:grid-cols-12 lg:gap-14">
          <h2 className="h2 m-0 lg:col-span-5">{t('tease.title')}</h2>
          <p className="lead m-0 lg:col-span-7">{t('tease.body')}</p>
        </div>
        <div className="card mt-12 overflow-hidden" style={{ borderRadius: 20 }}>
          <ul className="hairline-list m-0 list-none p-0">
            {PLANS.map((p) => (
              <li key={p.id}>
                <Link to="/tarifs" className="grid grid-cols-[1fr_auto] items-center gap-x-6 gap-y-0.5 px-5 py-4 transition-colors hover:bg-hover sm:grid-cols-[220px_150px_1fr_auto] sm:px-6">
                  <span className="flex items-center gap-2 text-[16px] font-medium tracking-[-0.015em]">
                    {p.name}
                    {p.featured && (
                      <span className="inline-flex items-center gap-1.5 text-[12px] font-normal text-fg-3">
                        <Dot tone="ok" />
                        {t('pr.recommended')}
                      </span>
                    )}
                  </span>
                  <span className="col-start-1 text-[13px] text-fg-3 sm:col-start-auto">
                    {t(p.channels === 1 ? 'tease.channels.one' : 'tease.channels.other', { n: p.channels })}
                  </span>
                  <span className="num hidden text-[13px] text-fg-3 sm:block">{t('tease.credits', { n: fmtNum(p.credits, lang) })}</span>
                  <span className="num row-span-2 row-start-1 text-right text-[16px] font-medium sm:row-span-1 sm:row-start-auto">
                    {fmtEuro(p.price, lang)}
                    <span className="ml-1 text-[12px] font-normal text-fg-3">{t('common.perMonth')}</span>
                  </span>
                </Link>
              </li>
            ))}
            <li>
              <Link to="/tarifs" className="grid grid-cols-[1fr_auto] items-center gap-x-6 px-5 py-4 transition-colors hover:bg-hover sm:grid-cols-[220px_150px_1fr_auto] sm:px-6">
                <span className="text-[16px] font-medium tracking-[-0.015em]">{ENTERPRISE.name}</span>
                <span className="hidden text-[13px] text-fg-3 sm:block">{t('plan.enterprise.tag')}</span>
                <span className="hidden sm:block" />
                <span className="text-right text-[14px] text-fg-2">{t('pr.onQuote')}</span>
              </Link>
            </li>
          </ul>
        </div>
        <div className="mt-6">
          <LinkButton to="/tarifs" variant="secondary">
            {t('tease.all')}
            <ArrowRight size={15} strokeWidth={1.75} />
          </LinkButton>
        </div>
      </Container>
    </section>
  )
}

function Faq() {
  const { t } = useLang()
  return (
    <section id="faq" className="py-20 md:py-24">
      <Container className="grid gap-10 lg:grid-cols-12 lg:gap-14">
        <h2 className="h2 m-0 lg:col-span-4">{t('faq.title')}</h2>
        <div className="hairline-list border-y border-line lg:col-span-8">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
            <details key={n} className="group py-1">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 text-[17px] font-medium tracking-[-0.015em] marker:hidden [&::-webkit-details-marker]:hidden">
                {t(`faq.q${n}`)}
                <Plus size={18} strokeWidth={1.5} className="shrink-0 text-fg-3 transition-transform duration-200 group-open:rotate-45" />
              </summary>
              <p className="m-0 max-w-[640px] pb-5 text-[15px] leading-[1.6] text-fg-3">{t(`faq.a${n}`)}</p>
            </details>
          ))}
        </div>
      </Container>
    </section>
  )
}

export function ClosingCta() {
  const { t } = useLang()
  return (
    <section className="py-12">
      <Container>
        <div className="fill-card px-6 py-14 sm:px-14 sm:py-20" style={{ borderRadius: 28 }}>
          <h2 className="h2 m-0 max-w-[620px]">{t('cta.title')}</h2>
          <p className="lead mb-0 mt-4 max-w-[520px]">{t('cta.body')}</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <LinkButton to="/inscription" size="lg">
              {t('common.start')}
              <ArrowRight size={16} strokeWidth={1.75} />
            </LinkButton>
            <Link to="/tarifs" className={buttonClass('secondary', 'lg')}>
              {t('nav.pricing')}
            </Link>
          </div>
        </div>
      </Container>
    </section>
  )
}

/* ------------------------------------------------------------------ page */

export function Landing() {
  const { t } = useLang()
  return (
    <SiteLayout>
      <Hero />
      <div id="produit">
        <TeamSection />

        <WideFeature id="planning" title={t('planning.title')} body={t('planning.body')} visual={<ShotFrame name="planning" alt={t('planning.title')} />}>
          <Rows items={[1, 2, 3].map((n) => ({ text: t(`planning.r${n}`) }))} />
        </WideFeature>

        <WideFeature id="pipelines" title={t('pipe.title')} body={t('pipe.body')} visual={<ShotFrame name="production-editor" alt={t('pipe.title')} aspect={2.1} crop={{ x: 0.19, y: 0.38, w: 0.78 }} />}>
          <Rows items={[1, 2, 3].map((n) => ({ title: t(`pipe.r${n}.t`), text: t(`pipe.r${n}.d`) }))} />
        </WideFeature>

        <Feature id="yeux" title={t('eyes.title')} body={t('eyes.body')} visual={<EyesPanel />}>
          <p className="m-0 mt-6 text-[13px] text-fg-3">{t('eyes.cap')}</p>
        </Feature>

        <Feature
          id="traduction"
          title={t('translate.title')}
          body={t('translate.body')}
          flip
          visual={<ShotFrame name="onboarding-3-translate" alt={t('translate.title')} aspect={0.9} crop={{ x: 0.22, y: 0, w: 0.56 }} />}
        >
          <Rows items={[1, 2, 3].map((n) => ({ text: t(`translate.r${n}`) }))} />
        </Feature>

        <Feature id="validation" title={t('control.title')} body={t('control.body')} visual={<AutomationMatrix t={t} />}>
          <p className="m-0 mt-6 flex items-start gap-2 text-[14px] text-fg-2">
            <Lock size={15} strokeWidth={1.5} className="mt-[3px] shrink-0 text-fg-3" />
            {t('control.note')}
          </p>
        </Feature>
      </div>

      <SubscriptionSection />
      <MoreSection />
      <PricingTeaser />
      <Faq />
      <ClosingCta />
    </SiteLayout>
  )
}
