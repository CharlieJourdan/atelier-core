// Step 1: the main agent introduces itself and asks for a name and a manner.
import { t } from '../../../../shared/fr'
import { Segmented } from '@/components/proto/kit'
import { Input } from '@/components/ui/input'
import { PERSONALITIES, type Personality } from '@/proto/data-onboarding'
import type { StepProps } from '../model'
import { HeroOrb } from '../parts'

export function WelcomeStep({ a, set }: StepProps) {
  return (
    <div className="flex flex-col items-center pt-2 text-center">
      <HeroOrb size={176} />
      <h1 className="mt-9 max-w-[520px] text-[32px] leading-[1.18] font-semibold tracking-[-0.03em] text-fg">{t('onb.welcome.title')}</h1>
      <p className="mt-3 max-w-[470px] text-[15px] leading-[1.55] text-fg-3">{t('onb.welcome.body')}</p>
      <div className="mt-8 w-full max-w-[360px] text-left">
        <label htmlFor="onboarding-name" className="mb-1.5 block text-[12.5px] font-medium text-fg-2">
          {t('onb.welcome.nameLabel')}
        </label>
        <Input
          id="onboarding-name"
          data-testid="onboarding-name"
          value={a.name}
          maxLength={24}
          onChange={(e) => set({ name: e.target.value })}
          placeholder="Atlas"
          className="h-12 rounded-[14px] px-4 text-[17px] font-medium"
        />
      </div>
      <div className="mt-6 flex flex-col items-center gap-2">
        <span className="text-[12.5px] font-medium text-fg-2">{t('onb.welcome.personality')}</span>
        <Segmented<Personality>
          value={a.personality}
          onChange={(personality) => set({ personality })}
          options={PERSONALITIES.map((p) => ({ value: p, label: t(`onb.personality.${p}`) }))}
        />
        <p className="max-w-[420px] text-[13px] text-fg-3" data-testid="onboarding-personality-sample">
          {t(`onb.personality.${a.personality}.sample`, { name: a.name.trim() || 'Atlas' })}
        </p>
      </div>
    </div>
  )
}
