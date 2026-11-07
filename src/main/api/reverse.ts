// IPC handlers, module "reverse" (reverse-pipeline): the reverse-engineered pipeline on the cloning engine
// (src/main/production/clone/reverse/service.ts). The renderer is untrusted: every argument goes through the zod schemas.
import { z } from 'zod'
import type { ApiHandlers } from '../../shared/api'
import type { REVERSE_METHODS } from '../../shared/api/reverse'
import { ReverseRequest, ReverseTransform } from '../../shared/reverse/pipeline'
import type { CloneEngine } from '../production/clone/engine'
import { ReverseService } from '../production/clone/reverse/service'
import type { ApiContext } from './context'

type ReverseMethodKey = (typeof REVERSE_METHODS)[number]

const Id = z.string().regex(/^[a-z0-9-]+$/i, 'pipeline id')
const Budget = z.number().positive().max(1000)

/** Reads an argument with its schema; a refusal says which argument and why (no value echoed). */
function arg<T>(schema: z.ZodType<T>, value: unknown, name: string): T {
  const r = schema.safeParse(value)
  if (!r.success) throw new Error(`Argument invalide (${name}) : ${r.error.issues.map((i) => `${i.path.join('.') || name} ${i.message}`).slice(0, 3).join('; ')}`)
  return r.data
}

const services = new WeakMap<CloneEngine, ReverseService>()
const serviceOf = (engine: CloneEngine): ReverseService => {
  let s = services.get(engine)
  if (!s) services.set(engine, (s = new ReverseService(engine)))
  return s
}

export function reverseApi(ctx: Pick<ApiContext, 'clones'>): Pick<ApiHandlers, ReverseMethodKey> {
  const r = (): ReverseService => serviceOf(ctx.clones)
  return {
    'reverse.start': (request) => r().start(arg(ReverseRequest, request, 'request')),
    'reverse.status': (id) => r().status(arg(Id, id, 'id')),
    'reverse.result': (id) => r().result(arg(Id, id, 'id')),
    'reverse.transform': (id, transform) => r().transform(arg(Id, id, 'id'), arg(ReverseTransform, transform, 'transform')),
    'reverse.list': () => r().list(),
    'reverse.prove': (id, budgetUsd) => r().prove(arg(Id, id, 'id'), arg(Budget, budgetUsd, 'budgetUsd'))
  }
}
