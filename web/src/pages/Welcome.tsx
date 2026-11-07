import { useEffect, useState } from 'react'
import { Check, Download } from 'lucide-react'
import { getPendingPlan, setPendingPlan, signOut, updateUser, useUser } from '../auth'
import { CloudCallError, cloudEnabled, cloudMachines, cloudSignOut, cloudSubscribe, type CloudMachine } from '../cloud'
import { AuthShell } from '../components/AuthShell'
import { VerifyBanner, useEmailStatus } from '../components/VerifyBanner'
import { fmtEuro, fmtNum, useLang, type Lang, type TFn } from '../i18n'
import { PLANS, computerSpec, monthlyPrice, planById, type Plan } from '../plans'
import { useRouter } from '../router'
import { Button, LinkButton, Segmented, cx } from '../ui'

type Billing = 'monthly' | 'yearly'
type Step = 'plan' | 'pay' | 'prov' | 'ready'

const STEP_INDEX: Record<Step, number> = { plan: 0, pay: 1, prov: 2, ready: 2 }
const STEP_KEYS = ['welcome.step1', 'welcome.step2', 'welcome.step3']
const PROV_STAGES = ['welcome.prov.s1', 'welcome.prov.s2', 'welcome.prov.s3', 'welcome.prov.s4']
/** Real provisioning takes about 3 minutes; the demo plays the four stages in a few seconds. */
const STAGE_MS = 1500

function Stepper({ step, t }: { step: Step; t: TFn }) {
  const current = STEP_INDEX[step]
  return (
    <ol className="m-0 mb-10 flex list-none items-center gap-2 p-0" aria-label="Étapes">
      {STEP_KEYS.map((k, i) => (
        <li key={k} className="flex flex-1 flex-col gap-2" aria-current={i === current ? 'step' : undefined}>
          <span className={cx('h-[3px] rounded-full', i <= current ? 'bg-ink' : 'bg-surface-3')} />
          <span className={cx('text-[12px]', i === current ? 'font-medium text-fg' : 'text-fg-3')}>{t(k)}</span>
        </li>
      ))}
    </ol>
  )
}

function PlanStep({ plan, billing, onPlan, onBilling, onNext, t, lang }: { plan: Plan; billing: Billing; onPlan: (p: Plan) => void; onBilling: (b: Billing) => void; onNext: () => void; t: TFn; lang: Lang }) {
  return (
    <div>
      <h1 className="m-0 text-[28px] font-medium leading-[1.15] tracking-[-0.03em]">{t('welcome.step1')}</h1>
      <p className="m-0 mt-2 text-[14px] text-fg-3">{t('welcome.step1.sub')}</p>
      <Segmented<Billing>
        label={t('pr.title')}
        value={billing}
        onChange={onBilling}
        options={[
          { value: 'monthly', label: t('pr.monthly') },
          { value: 'yearly', label: `${t('pr.yearly')} −20 %` }
        ]}
        className="mt-6 w-[280px]"
      />
      <div role="radiogroup" aria-label={t('welcome.step1')} className="card mt-5 overflow-hidden" style={{ borderRadius: 16 }}>
        <div className="hairline-list">
          {PLANS.map((p) => {
            const selected = p.id === plan.id
            return (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => onPlan(p)}
                className={cx('grid w-full grid-cols-[auto_1fr_auto] items-center gap-4 px-5 py-4 text-left transition-colors', selected ? 'bg-selected' : 'hover:bg-hover')}
              >
                <span className={cx('grid size-5 place-items-center rounded-full border', selected ? 'border-ink bg-ink text-ink-fg' : 'border-line-3')}>
                  {selected && <Check size={12} strokeWidth={2.5} />}
                </span>
                <span className="min-w-0">
                  <span className="block text-[15px] font-medium tracking-[-0.01em]">
                    {p.name}
                    {p.featured && <span className="ml-2 text-[12px] font-normal text-fg-3">{t('pr.recommended')}</span>}
                  </span>
                  <span className="block truncate text-[13px] text-fg-3">
                    {t(p.channels === 1 ? 'tease.channels.one' : 'tease.channels.other', { n: p.channels })} · {t('tease.credits', { n: fmtNum(p.credits, lang) })} · {computerSpec(p, lang)}
                  </span>
                </span>
                <span className="num text-right text-[15px] font-medium">
                  {fmtEuro(monthlyPrice(p, billing), lang, { decimals: true })}
                  <span className="block text-[11px] font-normal text-fg-3">{t('common.perMonth')} {t('common.ht')}</span>
                </span>
              </button>
            )
          })}
        </div>
      </div>
      <Button size="lg" className="mt-8" onClick={onNext}>
        {t('common.continue')}
      </Button>
    </div>
  )
}

function PayStep({ plan, billing, blocked, onConfirm, onBack, t, lang }: { plan: Plan; billing: Billing; blocked: boolean; onConfirm: () => void; onBack: () => void; t: TFn; lang: Lang }) {
  const price = fmtEuro(monthlyPrice(plan, billing), lang, { decimals: true })
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<'welcome.pay.failed' | 'welcome.pay.unverified' | null>(null)
  const confirm = (): void => {
    if (!cloudEnabled()) return onConfirm()
    setBusy(true)
    setFailure(null)
    cloudSubscribe(plan.id, billing)
      .then((r) => {
        if (r === 'paid') onConfirm()
      })
      .catch((err: unknown) => {
        setBusy(false)
        // 403: the address is not confirmed yet (the Cloud refuses to charge)
        setFailure(err instanceof CloudCallError && err.status === 403 ? 'welcome.pay.unverified' : 'welcome.pay.failed')
      })
  }
  return (
    <div>
      <h1 className="m-0 text-[28px] font-medium leading-[1.15] tracking-[-0.03em]">{t('welcome.step2')}</h1>
      <p className="num m-0 mt-2 text-[14px] text-fg-3">
        {t('welcome.summary', { plan: plan.name, price, ht: t('common.ht'), period: t(`welcome.period.${billing}`) })}
      </p>
      <section className="fill-card mt-8 p-6" aria-labelledby="sim-title">
        <h2 id="sim-title" className="m-0 flex items-center gap-2 text-[15px] font-semibold tracking-[-0.014em]">
          <span className="size-1.5 rounded-full bg-warn" aria-hidden="true" />
          {t('welcome.sim.title')}
        </h2>
        <p className="m-0 mt-2.5 text-[14px] leading-[1.6] text-fg-3">{t(cloudEnabled() ? 'welcome.sim.cloud' : 'welcome.sim.body')}</p>
      </section>
      {(failure || blocked) && (
        <p role="alert" data-testid="welcome-pay-note" className="m-0 mt-4 rounded-[12px] bg-surface-2 px-4 py-3 text-[13px] text-fg-2">
          {t(blocked ? 'welcome.pay.unverified' : (failure as string))}
        </p>
      )}
      <div className="mt-8 flex flex-wrap items-center gap-3">
        <Button size="lg" onClick={confirm} disabled={busy || blocked} data-testid="welcome-pay">
          {t('welcome.sim.confirm')}
        </Button>
        <Button variant="ghost" size="lg" onClick={onBack}>
          {t('welcome.sim.change')}
        </Button>
      </div>
    </div>
  )
}

/** With Atelier Cloud: the real team computers of the team, polled until they all run. */
function useMachines(on: boolean): CloudMachine[] | null {
  const [machines, setMachines] = useState<CloudMachine[] | null>(null)
  useEffect(() => {
    if (!on) return
    let stop = false
    const read = (): void => {
      cloudMachines()
        .then((r) => {
          if (!stop) setMachines(r.machines)
        })
        .catch(() => undefined)
    }
    read()
    const id = window.setInterval(read, 1500)
    return () => {
      stop = true
      window.clearInterval(id)
    }
  }, [on])
  return machines
}

function ProvisionStep({ onDone, t }: { onDone: () => void; t: TFn }) {
  const real = cloudEnabled()
  const machines = useMachines(real)
  const allRunning = machines !== null && machines.length > 0 && machines.every((m) => m.status === 'running')
  const [done, setDone] = useState(0)
  useEffect(() => {
    if (done >= PROV_STAGES.length) {
      onDone()
      return
    }
    // with the Cloud, the last stage waits for the machines to run
    if (real && done === PROV_STAGES.length - 1 && !allRunning) return
    const id = window.setTimeout(() => setDone((n) => n + 1), STAGE_MS)
    return () => window.clearTimeout(id)
  }, [done, onDone, real, allRunning])
  const pct = Math.round((done / PROV_STAGES.length) * 100)
  return (
    <div>
      <h1 className="m-0 text-[28px] font-medium leading-[1.15] tracking-[-0.03em]">{t('welcome.prov.title')}</h1>
      <p className="m-0 mt-2 text-[14px] text-fg-3">{t(real ? 'welcome.prov.subCloud' : 'welcome.prov.sub')}</p>
      {real && machines && machines.length > 0 && (
        <p className="num m-0 mt-3 text-[13px] text-fg-2" data-testid="welcome-machines">
          {machines.map((m) => `${m.serverType.toUpperCase()} · ${m.location} · ${t(`welcome.machine.${m.status === 'running' ? 'running' : 'creating'}`)}${m.demo ? ` (${t('welcome.machine.demo')})` : ''}`).join(' — ')}
        </p>
      )}
      <div className="mt-8 h-1 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full rounded-full bg-ink transition-[width] duration-[380ms] ease-out" style={{ width: `${pct}%` }} />
      </div>
      <ol className="hairline-list m-0 mt-6 list-none p-0">
        {PROV_STAGES.map((k, i) => {
          const state = i < done ? 'done' : i === done ? 'current' : 'todo'
          return (
            <li key={k} className="flex items-start gap-3.5 py-4">
              <span
                className={cx(
                  'mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border',
                  state === 'done' && 'border-ink bg-ink text-ink-fg',
                  state === 'current' && 'border-ink',
                  state === 'todo' && 'border-line-3'
                )}
              >
                {state === 'done' && <Check size={12} strokeWidth={2.5} />}
                {state === 'current' && <span className="skeleton-pulse size-2 rounded-full bg-ink" />}
              </span>
              <div className={state === 'todo' ? 'opacity-55' : ''}>
                <p className="m-0 text-[15px] font-medium tracking-[-0.01em]">{t(k)}</p>
                <p className="m-0 text-[13px] text-fg-3">{t(`${k}d`)}</p>
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

function ReadyStep({ t }: { t: TFn }) {
  const [note, setNote] = useState(false)
  return (
    <div>
      <p className="m-0 mb-4 flex items-center gap-2 text-[13px] text-fg-3">
        <span className="size-1.5 rounded-full bg-ok" aria-hidden="true" />
        {t('welcome.prov.s4')}
      </p>
      <h1 className="m-0 text-[28px] font-medium leading-[1.15] tracking-[-0.03em]">{t('welcome.ready.title')}</h1>
      <p className="m-0 mt-2 text-[14px] leading-[1.6] text-fg-3">{t('welcome.ready.sub')}</p>
      <div className="mt-8 grid gap-3 sm:grid-cols-2">
        <Button variant="secondary" size="lg" onClick={() => setNote(true)}>
          <Download size={16} strokeWidth={1.5} />
          {t('welcome.dl.mac')}
        </Button>
        <Button variant="secondary" size="lg" onClick={() => setNote(true)}>
          <Download size={16} strokeWidth={1.5} />
          {t('welcome.dl.win')}
        </Button>
      </div>
      <LinkButton to="/app/" size="lg" className="mt-3 w-full">
        {t('welcome.dl.web')}
      </LinkButton>
      {note && (
        <p role="status" className="m-0 mt-4 rounded-[12px] bg-surface-2 px-4 py-3 text-[13px] text-fg-2">
          {t('welcome.dl.note')}
        </p>
      )}
    </div>
  )
}

export function Welcome() {
  const { t, lang } = useLang()
  const { navigate } = useRouter()
  const user = useUser()
  const [plan, setPlan] = useState<Plan>(() => planById(user?.plan ?? getPendingPlan()?.plan) ?? PLANS[2] ?? PLANS[0]!)
  const [billing, setBilling] = useState<Billing>(() => user?.billing ?? getPendingPlan()?.billing ?? 'monthly')
  const [step, setStep] = useState<Step>(() => (user?.provisioned ? 'ready' : user?.subscribedAt ? 'prov' : 'plan'))
  const status = useEmailStatus()

  // back from Stripe's page: the payment is done, the computers are being created
  useEffect(() => {
    if (!cloudEnabled() || !user || user.subscribedAt) return
    if (new URLSearchParams(window.location.search).get('paid') === '1') {
      updateUser({ plan: plan.id, billing, subscribedAt: Date.now() })
      setStep('prov')
    }
  }, [user, plan.id, billing])

  useEffect(() => {
    if (!user) navigate('/inscription', { replace: true })
  }, [user, navigate])

  if (!user) return <AuthShell>{null}</AuthShell>

  return (
    <AuthShell width={step === 'plan' ? 760 : 520}>
      <div className="mb-8 flex items-center justify-between gap-4">
        <p className="m-0 text-[14px] text-fg-3">{t('welcome.hello', { name: user.name })}</p>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            if (cloudEnabled()) cloudSignOut()
            signOut()
            navigate('/')
          }}
        >
          {t('welcome.signout')}
        </Button>
      </div>
      {status.me && !status.me.emailVerified && <VerifyBanner email={status.me.email} onChange={status.refresh} />}
      <Stepper step={step} t={t} />
      {step === 'plan' && (
        <PlanStep
          plan={plan}
          billing={billing}
          onPlan={setPlan}
          onBilling={setBilling}
          onNext={() => {
            setPendingPlan({ plan: plan.id, billing })
            setStep('pay')
          }}
          t={t}
          lang={lang}
        />
      )}
      {step === 'pay' && (
        <PayStep
          plan={plan}
          billing={billing}
          blocked={status.me !== null && !status.me.emailVerified}
          t={t}
          lang={lang}
          onBack={() => setStep('plan')}
          onConfirm={() => {
            updateUser({ plan: plan.id, billing, subscribedAt: Date.now() })
            setStep('prov')
          }}
        />
      )}
      {step === 'prov' && (
        <ProvisionStep
          t={t}
          onDone={() => {
            updateUser({ provisioned: true })
            setStep('ready')
          }}
        />
      )}
      {step === 'ready' && <ReadyStep t={t} />}
    </AuthShell>
  )
}
