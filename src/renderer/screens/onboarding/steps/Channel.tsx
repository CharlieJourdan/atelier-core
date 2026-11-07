// Step 3: "Do you already have a channel?" Two big answers, then what each one needs: the link (and the Google connection
// that makes the dashboard show views and revenue), or a way to create one (niche, translation, idea). The first run has a
// third answer, « Plus tard »: the onboarding ends with no channel.
import { BarChart3, Check, Clock, Languages, Lightbulb, Link2, Search, Sparkles, Tv } from 'lucide-react'
import { useState } from 'react'
import { t } from '../../../../shared/fr'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input, Select, Textarea } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { EXISTING_TRANSLATIONS, NICHES, ONBOARDING_LANGS, type Competition, type OnboardingLang } from '@/proto/data-onboarding'
import type { Creation, StepProps } from '../model'
import { ChoiceCard, Question, Tag } from '../parts'
import { SimBadge } from '../live/SimBadge'

const CREATIONS: { id: Creation; icon: typeof Search }[] = [
  { id: 'niche', icon: Search },
  { id: 'translate', icon: Languages },
  { id: 'idea', icon: Lightbulb }
]

function CompetitionMeter({ level }: { level: Competition }) {
  const n = level === 'low' ? 1 : level === 'medium' ? 2 : 3
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] text-fg-3">
      <span aria-hidden className="inline-flex items-end gap-0.5">
        {[1, 2, 3].map((i) => (
          <span key={i} className={cn('w-[3px] rounded-full', i <= n ? 'bg-fg-2' : 'bg-surface-3')} style={{ height: 4 + i * 3 }} />
        ))}
      </span>
      {t(`onb.competition.${level}`)}
    </span>
  )
}

function GoogleSheet({ open, onOpenChange, onAllow }: { open: boolean; onOpenChange: (o: boolean) => void; onAllow: () => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="google-sheet" closeLabel={t('common.close')}>
        <DialogHeader>
          <DialogTitle className="text-[19px] font-semibold tracking-[-0.02em]">{t('onb.google.title')}</DialogTitle>
          <DialogDescription>{t('onb.google.body')}</DialogDescription>
        </DialogHeader>
        <ul className="space-y-2.5 rounded-[14px] bg-surface-2 p-3.5 text-[13px] text-fg-2">
          {(['onb.google.scope1', 'onb.google.scope2', 'onb.google.scope3'] as const).map((k) => (
            <li key={k} className="flex items-start gap-2.5">
              <Check className="mt-0.5 size-4 shrink-0 text-ok" aria-hidden />
              {t(k)}
            </li>
          ))}
        </ul>
        <p className="text-[12px] text-fg-3">{t('onb.google.demo')}</p>
        <DialogFooter className="justify-end">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button data-testid="google-allow" onClick={onAllow}>
            {t('onb.google.allow')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ExistingChannel({ a, set }: Pick<StepProps, 'a' | 'set'>) {
  const [open, setOpen] = useState(false)
  return (
    <div className="fade-in mt-4 rounded-[16px] border border-line-2 bg-surface-1 p-4" data-testid="onboarding-has-channel">
      <label htmlFor="onboarding-channel-link" className="mb-1.5 block text-[12.5px] font-medium text-fg-2">
        {t('onb.channel.link')}
      </label>
      <div className="relative">
        <Link2 className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-fg-3" aria-hidden />
        <Input
          id="onboarding-channel-link"
          data-testid="onboarding-channel-link"
          value={a.link}
          onChange={(e) => set({ link: e.target.value })}
          placeholder="youtube.com/@ta-chaine"
          className="h-11 rounded-[12px] pl-10 text-[14px]"
        />
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-4">
        {a.googleConnected ? (
          <span className="flex items-center gap-2 text-[13px] font-medium text-fg" data-testid="google-connected">
            <span className="flex size-5 items-center justify-center rounded-full bg-ok text-bg">
              <Check className="size-3" strokeWidth={3} aria-hidden />
            </span>
            {t('onb.google.connected')}
          </span>
        ) : (
          <Button variant="secondary" data-testid="onboarding-google" onClick={() => setOpen(true)}>
            <BarChart3 aria-hidden />
            {t('onb.google.connect')}
          </Button>
        )}
        <SimBadge />
        <p className="min-w-[220px] flex-1 text-[12.5px] leading-[1.5] text-fg-3">{a.googleConnected ? t('onb.google.connected.hint') : t('onb.google.hint')}</p>
      </div>
      <GoogleSheet
        open={open}
        onOpenChange={setOpen}
        onAllow={() => {
          set({ googleConnected: true })
          setOpen(false)
        }}
      />
    </div>
  )
}

function LanguageField({ a, set }: Pick<StepProps, 'a' | 'set'>) {
  return (
    <div className="mt-5 flex items-center gap-3">
      <label htmlFor="onboarding-language" className="text-[13px] font-medium text-fg-2">
        {t('onb.channel.language')}
      </label>
      <Select id="onboarding-language" data-testid="onboarding-language" value={a.language} onChange={(e) => set({ language: e.target.value as OnboardingLang })} className="h-9 w-[170px] rounded-full">
        {ONBOARDING_LANGS.map((l) => (
          <option key={l} value={l}>
            {t(`onb.lang.${l}`)}
          </option>
        ))}
      </Select>
    </div>
  )
}

function TranslateBlock({ a, set }: Pick<StepProps, 'a' | 'set'>) {
  // every language is a target, French included (clonage-traduction: Markets of the Past translated into French)
  const targets = ONBOARDING_LANGS
  const n = EXISTING_TRANSLATIONS[a.targetLang]
  const lang = t(`onb.lang.${a.targetLang}`)
  return (
    <div className="fade-in mt-3 rounded-[16px] border border-line-2 bg-surface-1 p-4" data-testid="onboarding-translate">
      <label htmlFor="onboarding-translate-link" className="mb-1.5 block text-[12.5px] font-medium text-fg-2">
        {t('onb.channel.translate.link')}
      </label>
      <Input
        id="onboarding-translate-link"
        data-testid="onboarding-translate-link"
        value={a.translateLink}
        onChange={(e) => set({ translateLink: e.target.value })}
        placeholder="youtube.com/@chaine-a-traduire"
        className="h-11 rounded-[12px] text-[14px]"
      />
      <p className="mt-4 mb-2 text-[12.5px] font-medium text-fg-2">{t('onb.channel.translate.target')}</p>
      <div role="radiogroup" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {targets.map((l) => {
          const count = EXISTING_TRANSLATIONS[l]
          const on = a.targetLang === l
          return (
            <button
              key={l}
              type="button"
              role="radio"
              aria-checked={on}
              data-testid={`translate-lang-${l}`}
              onClick={() => set({ targetLang: l })}
              className={cn(
                'rounded-[12px] border px-3 py-2.5 text-left outline-none transition-colors focus-visible:outline-2 focus-visible:outline-ring',
                on ? 'border-ink ring-1 ring-ink' : 'border-line-2 hover:border-line-3'
              )}
            >
              <span className="block text-[13.5px] font-medium text-fg">{t(`onb.lang.${l}`)}</span>
              <span className="mt-0.5 flex items-center gap-1.5 text-[12px] text-fg-3">
                <span aria-hidden className={cn('size-1.5 rounded-full', count === 0 ? 'bg-ok' : 'bg-warn')} />
                {t(count === 0 ? 'onb.channel.translate.none' : count === 1 ? 'onb.channel.translate.one' : 'onb.channel.translate.other', { n: count })}
              </span>
            </button>
          )
        })}
      </div>
      {a.translateLink.trim() && (
        <p className="fade-in mt-4 flex items-start gap-2 rounded-[12px] bg-surface-2 px-3.5 py-3 text-[13px] leading-[1.5] text-fg-2" data-testid="translate-verdict">
          <Check className="mt-0.5 size-4 shrink-0 text-ok" aria-hidden />
          <span>{t(n === 0 ? 'onb.channel.translate.free' : n === 1 ? 'onb.channel.translate.taken.one' : 'onb.channel.translate.taken.other', { n, lang: lang.toLowerCase() })}</span>
          <SimBadge className="ml-auto shrink-0" />
        </p>
      )}
    </div>
  )
}

function NewChannel({ a, set }: Pick<StepProps, 'a' | 'set'>) {
  return (
    <div className="fade-in mt-4" data-testid="onboarding-new-channel">
      <p className="mb-2.5 px-1 text-[13px] font-medium text-fg-2">{t('onb.channel.how')}</p>
      <div role="radiogroup" className="space-y-2.5">
        {CREATIONS.map(({ id, icon: Icon }) => (
          <ChoiceCard
            key={id}
            testId={`creation-${id}`}
            selected={a.creation === id}
            onSelect={() => set({ creation: id })}
            icon={<Icon className="size-[18px]" aria-hidden />}
            title={t(`onb.channel.${id}`)}
            description={t(`onb.channel.${id}.desc`)}
          />
        ))}
      </div>
      {a.creation === 'niche' && (
        <div className="fade-in mt-5" data-testid="onboarding-niches">
          <p className="mb-2.5 flex items-center gap-1.5 px-1 text-[13px] font-medium text-fg-2">
            <Sparkles className="size-3.5" aria-hidden />
            {t('onb.channel.niche.pick')}
            <SimBadge className="ml-1" />
          </p>
          <div role="radiogroup" className="space-y-2.5">
            {NICHES.map((n) => (
              <ChoiceCard
                key={n.id}
                testId={`niche-${n.id}`}
                selected={a.nicheId === n.id}
                onSelect={() => set({ nicheId: n.id })}
                title={t(n.nameKey)}
                badge={<Tag>{t('onb.niche.rpm', { n: n.rpm })}</Tag>}
                description={
                  <>
                    {t(n.whyKey)}
                    <span className="mt-2 block">
                      <CompetitionMeter level={n.competition} />
                    </span>
                  </>
                }
              />
            ))}
          </div>
        </div>
      )}
      {a.creation === 'translate' && <TranslateBlock a={a} set={set} />}
      {a.creation === 'idea' && (
        <div className="fade-in mt-3" data-testid="onboarding-idea-block">
          <label htmlFor="onboarding-idea" className="mb-1.5 block px-1 text-[12.5px] font-medium text-fg-2">
            {t('onb.channel.idea.label')}
          </label>
          <Textarea id="onboarding-idea" data-testid="onboarding-idea" value={a.idea} onChange={(e) => set({ idea: e.target.value })} placeholder={t('onb.channel.idea.placeholder')} className="min-h-24 rounded-[14px] text-[14px]" />
        </div>
      )}
      {(a.creation === 'niche' || a.creation === 'idea') && <LanguageField a={a} set={set} />}
    </div>
  )
}

export function ChannelStep({ a, set, mode }: StepProps) {
  // « Plus tard » only in the first run: adding a channel later has its own « Annuler »
  const canWait = mode === 'first-run'
  return (
    <div>
      <Question title={t('onb.channel.title')} hint={t('onb.channel.hint')} />
      <div role="radiogroup" aria-label={t('onb.channel.title')} className={cn('grid gap-3', canWait ? 'grid-cols-1 sm:grid-cols-3' : 'grid-cols-2')}>
        <ChoiceCard
          testId="channel-yes"
          selected={a.hasChannel === 'yes'}
          onSelect={() => set({ hasChannel: 'yes' })}
          icon={<Tv className="size-[18px]" aria-hidden />}
          title={t('onb.channel.yes')}
          description={t('onb.channel.yes.desc')}
        />
        <ChoiceCard
          testId="channel-no"
          selected={a.hasChannel === 'no'}
          onSelect={() => set({ hasChannel: 'no' })}
          icon={<Sparkles className="size-[18px]" aria-hidden />}
          title={t('onb.channel.no')}
          description={t('onb.channel.no.desc')}
        />
        {canWait && (
          <ChoiceCard
            testId="channel-later"
            selected={a.hasChannel === 'later'}
            onSelect={() => set({ hasChannel: 'later' })}
            icon={<Clock className="size-[18px]" aria-hidden />}
            title={t('onb.channel.later')}
            description={t('onb.channel.later.desc')}
          />
        )}
      </div>
      {a.hasChannel === 'yes' && <ExistingChannel a={a} set={set} />}
      {a.hasChannel === 'no' && <NewChannel a={a} set={set} />}
      {a.hasChannel === 'later' && canWait && (
        <p className="fade-in mt-4 rounded-[14px] bg-surface-2 px-4 py-3.5 text-[13px] leading-[1.55] text-fg-2" data-testid="onboarding-later-note">
          {t('onb.channel.later.note')}
        </p>
      )}
    </div>
  )
}
