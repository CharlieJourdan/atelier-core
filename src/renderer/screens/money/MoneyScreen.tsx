// Monétisation (section `monetisation`): six tabs. Real: P&L, revenues, sponsors, offers (pack), costs. Demo (labelled):
// the YouTube curve until the read-only access exists, and the « mise en ligne » of an offer.
import { useState } from 'react'
import { t } from '../../../shared/fr'
import { PageShell } from '@/components/atelier/page'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { ScreenProps } from '../registry'
import { CostsTab } from './CostsTab'
import { OffersTab } from './OffersTab'
import { OverviewTab } from './OverviewTab'
import { RevenuesTab } from './RevenuesTab'
import { SponsorsTab } from './SponsorsTab'
import { YoutubeTab } from './YoutubeTab'

export const MONEY_TABS = ['overview', 'revenues', 'sponsors', 'offers', 'youtube', 'costs'] as const
export type MoneyTab = (typeof MONEY_TABS)[number]

export function MoneyScreen(_props: ScreenProps) {
  const [tab, setTab] = useState<MoneyTab>('overview')
  return (
    <PageShell section="monetisation" title={t('section.monetisation')} subtitle={t('money.subtitle')}>
      <Tabs value={tab} onValueChange={(v) => setTab(v as MoneyTab)} className="flex flex-col gap-5">
        <TabsList className="self-start">
          {MONEY_TABS.map((k) => (
            <TabsTrigger key={k} value={k}>
              {t(`money.tab.${k}` as never)}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="overview">
          <OverviewTab onAddRevenue={() => setTab('revenues')} />
        </TabsContent>
        <TabsContent value="revenues">
          <RevenuesTab />
        </TabsContent>
        <TabsContent value="sponsors">
          <SponsorsTab />
        </TabsContent>
        <TabsContent value="offers">
          <OffersTab />
        </TabsContent>
        <TabsContent value="youtube">
          <YoutubeTab />
        </TabsContent>
        <TabsContent value="costs">
          <CostsTab />
        </TabsContent>
      </Tabs>
    </PageShell>
  )
}
