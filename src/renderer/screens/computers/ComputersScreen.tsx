// Ordinateurs (section `ordinateurs`): remote PC (H1), agent browsers and the PC cloud (a demo card, PLAN-V2-PRODUCTION §4.9).
import { Cloud } from 'lucide-react'
import { t } from '../../../shared/fr'
import { DemoBadge, DemoBoundary } from '@/components/atelier/demo'
import { PageShell } from '@/components/atelier/page'
import { Panel } from '@/components/atelier/primitives'
import { Button } from '@/components/ui/button'
import { toast } from '@/lib/toast'
import type { ScreenProps } from '../registry'
import { BrowsersBlock } from './BrowsersBlock'
import { MachinesBlock } from './MachinesBlock'

/** The PC cloud card: DÉMO (feature `cloud-pc`), nothing is started, nothing is billed. */
export function CloudPcCard() {
  return (
    <Panel title={t('computers.cloud')} data-testid="computers-cloud" action={<DemoBadge />}>
      <DemoBoundary feature="cloud-pc">
        <div className="flex flex-wrap items-center gap-4 rounded-card border border-line bg-surface-2 p-4">
          <Cloud className="size-8 text-fg-3" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-[13.5px] text-fg">{t('computers.cloud.blurb')}</p>
            <p className="mt-1 text-[12.5px] text-fg-3">{t('computers.cloud.spec')}</p>
            <p className="mt-1 text-[12.5px] text-fg-2" data-testid="cloud-price">
              {t('computers.cloud.price')}
            </p>
            <p className="mt-0.5 text-[12px] text-fg-3">{t('computers.cloud.idle')}</p>
          </div>
          <Button variant="outline" onClick={() => toast.demo()}>
            {t('computers.cloud.start')}
          </Button>
        </div>
      </DemoBoundary>
    </Panel>
  )
}

export function ComputersScreen(_props: ScreenProps) {
  return (
    <PageShell section="ordinateurs" title={t('section.ordinateurs')} subtitle={t('computers.subtitle')}>
      <div className="flex flex-col gap-5">
        <MachinesBlock />
        <BrowsersBlock />
        <CloudPcCard />
      </div>
    </PageShell>
  )
}
