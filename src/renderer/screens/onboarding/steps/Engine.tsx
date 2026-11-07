// Step 2: the engine. The team thinks with the user's own Claude Code or Codex subscription; credits only pay for generated
// media (and for everything if the user takes Atelier's plan).
import { Bot, Check, Loader2, Terminal, Users, Sparkles } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { t } from '../../../../shared/fr'
import { ENGINE_CHOICES, type EngineChoice } from '@/proto/data-onboarding'
import type { StepProps } from '../model'
import { ChoiceCard, Question, Tag } from '../parts'
import { SimBadge } from '../live/SimBadge'

const ICONS: Record<EngineChoice, typeof Terminal> = { 'claude-code': Terminal, codex: Bot, multi: Users, atelier: Sparkles }

export function EngineStep({ a, set }: StepProps) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), [])
  const login = (): void => {
    set({ engineCheck: 'checking' })
    timer.current = setTimeout(() => set({ engineCheck: 'connected' }), 1300)
  }
  return (
    <div>
      <Question title={t('onb.engine.title')} hint={t('onb.engine.hint')} />
      <div role="radiogroup" aria-label={t('onb.engine.title')} className="space-y-3" data-testid="onboarding-engines">
        {ENGINE_CHOICES.map((id) => {
          const Icon = ICONS[id]
          const selected = a.engine === id
          return (
            <ChoiceCard
              key={id}
              testId={`engine-${id}`}
              selected={selected}
              onSelect={() => set({ engine: id })}
              icon={<Icon className="size-[18px]" aria-hidden />}
              title={t(`onb.engine.${id}`)}
              description={t(`onb.engine.${id}.desc`)}
              badge={
                id === 'claude-code' ? <Tag tone="ok">{t('onb.engine.recommended')}</Tag> : id === 'atelier' ? <Tag tone="warn">{t('onb.engine.pricier')}</Tag> : undefined
              }
            >
              {id === 'claude-code' && selected && (
                <div className="flex items-center justify-between gap-3 border-t border-line mx-4 py-3" data-testid="engine-claude-status" data-state={a.engineCheck}>
                  <span className="flex min-w-0 items-center gap-2 text-[13px] text-fg-2">
                    {a.engineCheck === 'connected' ? (
                      <Check className="size-4 shrink-0 text-ok" aria-hidden />
                    ) : a.engineCheck === 'checking' ? (
                      <Loader2 className="size-4 shrink-0 animate-spin text-fg-3" aria-hidden />
                    ) : (
                      <span aria-hidden className="size-2 shrink-0 rounded-full bg-ok" />
                    )}
                    <span className="truncate">{t(`onb.engine.claude.${a.engineCheck}`)}</span>
                    <SimBadge />
                  </span>
                  {a.engineCheck === 'detected' && (
                    <button
                      type="button"
                      data-testid="engine-login"
                      onClick={login}
                      className="shrink-0 rounded-full bg-surface-3 px-3.5 py-1.5 text-[12.5px] font-medium text-fg outline-none hover:bg-selected focus-visible:outline-2 focus-visible:outline-ring"
                    >
                      {t('onb.engine.login')}
                    </button>
                  )}
                </div>
              )}
              {id === 'multi' && selected && (
                <p className="mx-4 border-t border-line py-3 text-[13px] text-fg-3">{t('onb.engine.multi.detail')}</p>
              )}
            </ChoiceCard>
          )
        })}
      </div>
      <div className="mt-6 rounded-[14px] bg-surface-2 px-4 py-3.5 text-[13px] leading-[1.55] text-fg-2" data-testid="engine-credits-note">
        <span className="font-medium text-fg">{t('onb.engine.credits.title')}</span> {t('onb.engine.credits.body')}
      </div>
    </div>
  )
}
