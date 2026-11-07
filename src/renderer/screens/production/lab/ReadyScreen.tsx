// « Pipelines prêtes », the full page (production-lab, Charlie 01/11: « Voir toutes les pipelines… ça nous amène sur la
// page prebuild pipeline, avec toutes les pipelines qu'on peut défiler, voir »): every ready pipeline as a grid, with the
// categories and the orders of the Lab's row, and the same three actions.
import { ArrowLeft } from 'lucide-react'
import { t } from '../../../../shared/fr'
import { ProtoPage } from '@/components/proto/kit'
import { Button } from '@/components/ui/button'
import type { ScreenProps } from '../../registry'
import { LoadLine } from '../recettes/ui'
import { ReadyBrowser } from './ReadyBrowser'
import { useLab } from './use-lab'

export function ReadyScreen({ onRoute }: ScreenProps) {
  const lab = useLab(onRoute)
  const bases = lab.bases ?? []
  return (
    <ProtoPage
      testId="view-production-ready"
      wide
      title={t('lab.ready')}
      subtitle={t('lab.ready.subtitle')}
      actions={
        <Button variant="ghost" size="sm" onClick={() => onRoute({ section: 'production', page: 'apercu' })} data-testid="ready-back">
          <ArrowLeft />
          {t('lab.back')}
        </Button>
      }
    >
      <LoadLine error={lab.error} loading={lab.bases === null && !lab.error} />
      {lab.bases && bases.length === 0 && <p className="text-[12.5px] text-fg-3">{t('lab.ready.empty')}</p>}
      {bases.length > 0 && <ReadyBrowser bases={bases} estimates={lab.estimates} layout="grid" actions={{ busy: lab.busy, onUse: (b) => void lab.use(b), onAdd: (b, m) => void lab.add(b, m) }} />}
    </ProtoPage>
  )
}
