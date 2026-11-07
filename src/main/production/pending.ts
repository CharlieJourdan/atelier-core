// Until Atelier's own production engine is wired in (lots P2 to P7), the video producer has nothing to call: its
// deliverable (the edit) is not run through a model. The runner puts the task on hold with one clear message, and the
// owner can still upload the edit by hand. Nothing here starts a process or spends anything.
import { t } from '../../shared/fr'
import type { DeliverableRow } from '../../shared/workflow'
import type { ExtraTools, MediaHooks, MediaOutcome } from '../agents/media'

/** Shown in the video chat (French UI text, `fr.ts`). */
export const PRODUCTION_PENDING_MESSAGE = t('production.pending')

export class ProductionPending implements MediaHooks {
  handles(deliverable: DeliverableRow): boolean {
    return deliverable.type === 'edit'
  }

  direct(): string | null {
    return null
  }

  tools(): ExtraTools | null {
    return null
  }

  unavailable(deliverable: DeliverableRow): string | null {
    return this.handles(deliverable) ? PRODUCTION_PENDING_MESSAGE : null
  }

  afterRun(): MediaOutcome {
    return { kind: 'missing', message: PRODUCTION_PENDING_MESSAGE }
  }

  activeTaskIds(): number[] {
    return []
  }
}
