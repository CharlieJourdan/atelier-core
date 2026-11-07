// The example workspace's credits, always apart from the real balance (they cannot be spent): a badged line.
import { t } from '../../../shared/fr'
import { ExampleBadge, fmtCredits } from '@/components/atelier/kit'

export function ExampleCreditsLine({ example, className }: { example: number; className?: string }) {
  if (!(example > 0)) return null
  return (
    <p data-testid="example-credits" className={`m-0 flex flex-wrap items-center gap-2 text-[12px] text-fg-3 ${className ?? ''}`}>
      <ExampleBadge />
      {t('credits.exampleLine', { n: fmtCredits(example) })}
    </p>
  )
}
