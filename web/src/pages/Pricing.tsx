import { useState } from 'react'
import { Check, Minus } from 'lucide-react'
import { getPendingPlan, setPendingPlan, useUser } from '../auth'
import { SiteLayout } from '../components/SiteLayout'
import { fmtEuro, fmtNum, useLang, type Lang, type TFn } from '../i18n'
import {
  CREDIT_PACKS,
  ENTERPRISE,
  PLANS,
  VIDEO_COSTS,
  computerSpec,
  monthlyPrice,
  storageLabel,
  yearlyTotal,
  type Plan
} from '../plans'
import { Link } from '../router'
import { Container, Segmented, buttonClass, cx } from '../ui'
import { ClosingCta } from './Landing'

type Billing = 'monthly' | 'yearly'

const ALL_FEATURES = [
  'feat.team',
  'feat.eyes',
  'feat.presets',
  'feat.custom',
  'feat.translate',
  'feat.discord',
  'feat.brain',
  'feat.roles',
  'feat.clients',
  'feat.support',
  'feat.onboarding',
  'feat.sso',
  'feat.dedicated'
]

function hasFeature(plan: Plan | 'enterprise', key: string): boolean {
  if (plan === 'enterprise') return true
  // every plan starts from presets; custom pipelines replace them from Creator up
  return plan.features.includes(key) || (key === 'feat.presets' && plan.features.includes('feat.custom'))
}

function pluralKey(base: string, n: number): string {
  return `${base}.${n === 1 ? 'one' : 'other'}`
}

function chooseHandler(plan: string, billing: Billing): () => void {
  return () => setPendingPlan({ plan, billing })
}

/* ------------------------------------------------------------------ plan cards */

function PlanCard({ plan, billing, t, lang, signedIn }: { plan: Plan; billing: Billing; t: TFn; lang: Lang; signedIn: boolean }) {
  const inverted = plan.featured === true
  const price = monthlyPrice(plan, billing)
  const muted = inverted ? 'text-ink-fg/70' : 'text-fg-3'
  return (
    <article
      className={cx('flex flex-col p-6', inverted ? 'bg-ink text-ink-fg' : 'bg-surface-2 text-fg')}
      style={{ borderRadius: 16 }}
      aria-label={plan.name}
    >
      <div className="flex items-center justify-between gap-3">
        <h3 className="m-0 text-[18px] font-medium tracking-[-0.015em]">{plan.name}</h3>
        {inverted && <span className="text-[12px] font-medium text-ink-fg/80">{t('pr.recommended')}</span>}
      </div>
      <p className={cx('m-0 mt-1.5 min-h-[42px] text-[14px] leading-[1.5]', muted)}>{t(`plan.${plan.id}.tag`)}</p>
      <div className="mt-6 flex items-baseline gap-1.5">
        <span className="num text-[40px] font-light leading-none tracking-[-0.035em]">{fmtEuro(price, lang, { decimals: true })}</span>
        <span className={cx('text-[13px]', muted)}>
          {t('common.perMonth')} {t('common.ht')}
        </span>
      </div>
      <p className={cx('num m-0 mt-2 min-h-[20px] text-[12px]', muted)}>
        {billing === 'yearly' ? t('pr.billedYearly', { price: fmtEuro(yearlyTotal(plan), lang, { decimals: true }) }) : ''}
      </p>
      <Link
        to={signedIn ? '/bienvenue' : '/inscription'}
        onClick={chooseHandler(plan.id, billing)}
        className={buttonClass(inverted ? 'secondary' : 'primary', 'lg', cx('mt-5 w-full', inverted && 'border-transparent bg-ink-fg text-ink hover:bg-ink-fg/90'))}
      >
        {t('pr.cta', { plan: plan.name })}
      </Link>
      <ul className="m-0 mt-6 flex list-none flex-col gap-2.5 p-0 text-[14px] leading-[1.4]">
        {[
          t(pluralKey('pr.seats', plan.seats), { n: plan.seats }),
          t(pluralKey('pr.channels', plan.channels), { n: plan.channels }),
          t('pr.creditsMonth', { n: fmtNum(plan.credits, lang) }),
          computerSpec(plan, lang),
          t('pr.storage', { n: storageLabel(plan.storageGb, lang) })
        ].map((line) => (
          <li key={line} className="flex items-start gap-2.5 font-medium">
            <Check size={16} strokeWidth={1.5} className={cx('mt-px shrink-0', muted)} />
            {line}
          </li>
        ))}
        {plan.features.map((f) => (
          <li key={f} className={cx('flex items-start gap-2.5', inverted ? 'text-ink-fg/85' : 'text-fg-2')}>
            <Check size={16} strokeWidth={1.5} className={cx('mt-px shrink-0', muted)} />
            {t(f)}
          </li>
        ))}
      </ul>
      <p className={cx('m-0 mt-5 border-t pt-4 text-[12px] leading-[1.5]', inverted ? 'border-ink-fg/20 text-ink-fg/70' : 'border-line-2 text-fg-3')}>
        {t('pr.covers', { docs: plan.docs, shorts: plan.shorts })}
      </p>
    </article>
  )
}

function EnterpriseCard({ t, lang }: { t: TFn; lang: Lang }) {
  return (
    <article className="flex flex-col bg-surface-2 p-6" style={{ borderRadius: 16 }} aria-label={ENTERPRISE.name}>
      <h3 className="m-0 text-[18px] font-medium tracking-[-0.015em]">{ENTERPRISE.name}</h3>
      <p className="m-0 mt-1.5 min-h-[42px] text-[14px] leading-[1.5] text-fg-3">{t('plan.enterprise.tag')}</p>
      <div className="mt-6 flex items-baseline gap-1.5">
        <span className="text-[13px] text-fg-3">{t('pr.from')}</span>
        <span className="num text-[40px] font-light leading-none tracking-[-0.035em]">{fmtEuro(ENTERPRISE.from, lang, { decimals: false })}</span>
        <span className="text-[13px] text-fg-3">
          {t('common.perMonth')} {t('common.ht')}
        </span>
      </div>
      <p className="m-0 mt-2 min-h-[20px] text-[12px] text-fg-3">{t('pr.onQuote')}</p>
      <a href="mailto:bonjour@atelier.test?subject=Atelier%20Entreprise" className={buttonClass('secondary', 'lg', 'mt-5 w-full')}>
        {t('pr.ctaEnterprise')}
      </a>
      <ul className="m-0 mt-6 flex list-none flex-col gap-2.5 p-0 text-[14px] leading-[1.4]">
        {['pr.unlimited', 'pr.custom'].map((k, i) => (
          <li key={k} className="flex items-start gap-2.5 font-medium">
            <Check size={16} strokeWidth={1.5} className="mt-px shrink-0 text-fg-3" />
            {i === 0 ? `${t('pr.row.seats')} : ${t(k).toLowerCase()}` : `${t('pr.row.channels')} : ${t(k).toLowerCase()}`}
          </li>
        ))}
        <li className="flex items-start gap-2.5 font-medium">
          <Check size={16} strokeWidth={1.5} className="mt-px shrink-0 text-fg-3" />
          {t('pr.enterprise.computer')}
        </li>
        {ENTERPRISE.features.map((f) => (
          <li key={f} className="flex items-start gap-2.5 text-fg-2">
            <Check size={16} strokeWidth={1.5} className="mt-px shrink-0 text-fg-3" />
            {t(f)}
          </li>
        ))}
      </ul>
    </article>
  )
}

/* ------------------------------------------------------------------ comparison table */

function Compare({ billing, t, lang }: { billing: Billing; t: TFn; lang: Lang }) {
  const head = 'px-4 py-3 text-left text-[13px] font-medium text-fg'
  const cell = 'px-4 py-3 text-[13px] text-fg-2'
  const rows: { label: string; cells: string[] }[] = [
    { label: t('pr.row.price'), cells: [...PLANS.map((p) => fmtEuro(monthlyPrice(p, billing), lang, { decimals: true })), `${t('pr.from')} ${fmtEuro(ENTERPRISE.from, lang, { decimals: false })}`] },
    { label: t('pr.row.seats'), cells: [...PLANS.map((p) => String(p.seats)), t('pr.unlimited')] },
    { label: t('pr.row.channels'), cells: [...PLANS.map((p) => String(p.channels)), t('pr.custom')] },
    { label: t('pr.row.credits'), cells: [...PLANS.map((p) => fmtNum(p.credits, lang)), t('pr.enterprise.credits')] },
    { label: t('pr.row.computer'), cells: [...PLANS.map((p) => computerSpec(p, lang)), t('pr.enterprise.computer')] },
    { label: t('pr.row.storage'), cells: [...PLANS.map((p) => storageLabel(p.storageGb, lang)), t('pr.custom')] },
    { label: t('pr.row.concurrency'), cells: [...PLANS.map((p) => `${p.jobs[0]} / ${p.jobs[1]}`), t('pr.custom')] },
    { label: t('pr.row.docs'), cells: [...PLANS.map((p) => `≈ ${p.docs}`), '–'] },
    { label: t('pr.row.shorts'), cells: [...PLANS.map((p) => `≈ ${p.shorts}`), '–'] }
  ]
  return (
    <section className="py-16 md:py-20" aria-labelledby="compare-title">
      <Container>
        <h2 id="compare-title" className="m-0 mb-8 text-[28px] font-normal leading-[1.15] tracking-[-0.03em]">
          {t('pr.compare')}
        </h2>
        <div className="card overflow-x-auto" style={{ borderRadius: 16 }}>
          <table className="w-full min-w-[860px] border-collapse">
            <thead>
              <tr className="border-b border-line-2">
                <th className={cx(head, 'w-[22%]')} scope="col" />
                {PLANS.map((p) => (
                  <th key={p.id} className={cx(head, p.featured && 'bg-surface-2')} scope="col">
                    {p.name}
                  </th>
                ))}
                <th className={head} scope="col">
                  {ENTERPRISE.name}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.label} className="border-b border-line">
                  <th scope="row" className={cx(cell, 'text-left font-medium text-fg')}>
                    {r.label}
                  </th>
                  {r.cells.map((c, i) => (
                    <td key={i} className={cx(cell, 'num', PLANS[i]?.featured && 'bg-surface-2')}>
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
              <tr className="border-b border-line">
                <th scope="row" colSpan={8} className={cx(cell, 'bg-surface-2 text-left font-medium text-fg')}>
                  {t('pr.row.features')}
                </th>
              </tr>
              {ALL_FEATURES.map((f) => (
                <tr key={f} className="border-b border-line last:border-b-0">
                  <th scope="row" className={cx(cell, 'text-left font-normal')}>
                    {t(f)}
                  </th>
                  {[...PLANS, 'enterprise' as const].map((p) => {
                    const on = hasFeature(p, f)
                    const featured = p !== 'enterprise' && p.featured
                    return (
                      <td key={p === 'enterprise' ? 'e' : p.id} className={cx(cell, featured && 'bg-surface-2')}>
                        {on ? <Check size={16} strokeWidth={1.75} className="text-fg" aria-label="Inclus" /> : <Minus size={16} strokeWidth={1.5} className="text-fg-4" aria-label="Non inclus" />}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Container>
    </section>
  )
}

/* ------------------------------------------------------------------ credits */

function Credits({ t, lang }: { t: TFn; lang: Lang }) {
  return (
    <section className="py-16 md:py-20" aria-labelledby="credits-title">
      <Container className="grid gap-12 lg:grid-cols-12 lg:gap-14">
        <div className="lg:col-span-5">
          <h2 id="credits-title" className="m-0 text-[28px] font-normal leading-[1.15] tracking-[-0.03em]">
            {t('pr.credits.title')}
          </h2>
          <p className="lead mb-0 mt-4">{t('pr.credits.body')}</p>
          <ul className="hairline-list m-0 mt-8 list-none border-y border-line p-0">
            {CREDIT_PACKS.map((p) => (
              <li key={p.credits} className="flex items-center justify-between gap-4 py-3.5 text-[14px]">
                <span className="font-medium">{t('pr.pack', { n: fmtNum(p.credits, lang) })}</span>
                <span className="flex items-center gap-3">
                  {p.off > 0 && <span className="num text-[12px] text-fg-3">{t('pr.packOff', { p: p.off })}</span>}
                  <span className="num font-medium">{fmtEuro(p.price, lang, { decimals: !Number.isInteger(p.price) })}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div className="grid content-start gap-6 lg:col-span-7">
          <div className="fill-card p-6">
            <h3 className="m-0 text-[16px] font-medium tracking-[-0.015em]">{t('pr.credits.topup.t')}</h3>
            <p className="m-0 mt-2 max-w-[600px] text-[14px] leading-[1.6] text-fg-3">{t('pr.credits.topup.d')}</p>
          </div>
          <div className="fill-card p-6">
            <h3 className="m-0 text-[16px] font-medium tracking-[-0.015em]">{t('pr.credits.expiry.t')}</h3>
            <p className="m-0 mt-2 max-w-[600px] text-[14px] leading-[1.6] text-fg-3">{t('pr.credits.expiry.d')}</p>
          </div>
        </div>
      </Container>
    </section>
  )
}

function VideoCosts({ t, lang }: { t: TFn; lang: Lang }) {
  return (
    <section className="py-16 md:py-20" aria-labelledby="cost-title">
      <Container className="grid gap-12 lg:grid-cols-12 lg:gap-14">
        <div className="lg:col-span-5">
          <h2 id="cost-title" className="m-0 text-[28px] font-normal leading-[1.15] tracking-[-0.03em]">
            {t('pr.cost.title')}
          </h2>
          <p className="lead mb-0 mt-4">{t('pr.cost.body')}</p>
        </div>
        <div className="lg:col-span-7">
          <div className="card overflow-hidden" style={{ borderRadius: 16 }}>
            <ul className="hairline-list m-0 list-none p-0">
              {VIDEO_COSTS.map((c) => {
                const [lo, hi] = c.credits
                const credits = hi ? `${fmtNum(lo, lang)} – ${fmtNum(hi, lang)}` : `${c.approx ? '≈ ' : ''}${fmtNum(lo, lang)}`
                const eur = hi ? `${fmtEuro(lo / 100, lang, { decimals: false })} – ${fmtEuro(hi / 100, lang, { decimals: false })}` : fmtEuro(lo / 100, lang, { decimals: !Number.isInteger(lo / 100) })
                return (
                  <li key={c.key} className="grid grid-cols-[1fr_auto] items-baseline gap-x-6 px-5 py-4 sm:grid-cols-[1fr_190px_150px]">
                    <span className="text-[14px] font-medium">{t(c.key)}</span>
                    <span className="num text-right text-[14px] text-fg-2 sm:text-left">
                      {credits} <span className="text-fg-3">{t('pr.cost.unit')}</span>
                    </span>
                    <span className="num col-span-2 text-[13px] text-fg-3 sm:col-span-1 sm:text-right">{eur}</span>
                  </li>
                )
              })}
            </ul>
          </div>
          <p className="m-0 mt-4 max-w-[600px] text-[13px] leading-[1.6] text-fg-3">{t('pr.cost.note')}</p>
        </div>
      </Container>
    </section>
  )
}

/* ------------------------------------------------------------------ page */

export function Pricing() {
  const { t, lang } = useLang()
  const user = useUser()
  const [billing, setBilling] = useState<Billing>(() => getPendingPlan()?.billing ?? 'monthly')
  return (
    <SiteLayout>
      <section className="pb-8 pt-14 md:pt-20">
        <Container>
          <h1 className="m-0 max-w-[820px] text-[clamp(36px,5vw,56px)] font-normal leading-[1.06] tracking-[-0.035em]">{t('pr.title')}</h1>
          <p className="lead mb-0 mt-5 max-w-[640px]">{t('pr.sub')}</p>
          <div className="mt-8 flex flex-wrap items-center gap-4">
            <Segmented<Billing>
              label={t('pr.title')}
              value={billing}
              onChange={setBilling}
              options={[
                { value: 'monthly', label: t('pr.monthly') },
                { value: 'yearly', label: t('pr.yearly') }
              ]}
              className="w-[220px]"
            />
            <span className="text-[13px] text-fg-3">{t('pr.save')}</span>
          </div>
        </Container>
      </section>

      <section aria-label={t('pr.title')} className="pb-8">
        <Container className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {PLANS.map((p) => (
            <PlanCard key={p.id} plan={p} billing={billing} t={t} lang={lang} signedIn={user !== null} />
          ))}
          <EnterpriseCard t={t} lang={lang} />
        </Container>
        <Container>
          <p className="m-0 mt-6 text-[13px] text-fg-3">{t('pr.vat')}</p>
        </Container>
      </section>

      <Compare billing={billing} t={t} lang={lang} />
      <Credits t={t} lang={lang} />
      <VideoCosts t={t} lang={lang} />
      <ClosingCta />
    </SiteLayout>
  )
}
