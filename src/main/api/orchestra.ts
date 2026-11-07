// IPC handlers, module "orchestra": the agent runtime (src/main/orchestra, docs/AGENT-RUNTIME.md). One domain per file.
import type { ApiHandlers } from '../../shared/api'
import type { ORCHESTRA_METHODS } from '../../shared/api/orchestra'
import type { ApiContext } from './context'

type OrchestraMethodKey = (typeof ORCHESTRA_METHODS)[number]

const id = (v: unknown, what: string): number => {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) throw new Error(`${what} : entier positif attendu`)
  return v
}

export function orchestraApi(ctx: ApiContext): Pick<ApiHandlers, OrchestraMethodKey> {
  const o = ctx.orchestra
  return {
    'orchestra.status': () => o.status(),
    'orchestra.tree': () => o.tree(),
    'orchestra.agents': () => o.agents(),
    'orchestra.seed': () => o.seed(),
    'orchestra.createAgent': (input) => o.createAgent(input),
    'orchestra.updateAgent': (agentId, patch) => o.updateAgent(id(agentId, 'agentId'), patch),
    'orchestra.tasks': (filter) => o.tasks(filter),
    'orchestra.enqueue': (input) => o.enqueue(input),
    'orchestra.retryTask': (taskId) => o.retryTask(id(taskId, 'taskId')),
    'orchestra.cancelTask': (taskId) => o.cancelTask(id(taskId, 'taskId')),
    'orchestra.accounts': () => o.accounts(),
    'orchestra.saveAccount': (input) => o.saveAccount(input),
    'orchestra.clearLimit': (accountId) => o.clearLimit(id(accountId, 'accountId')),
    'orchestra.routines': (agentId) => o.routines(agentId === undefined ? undefined : id(agentId, 'agentId')),
    'orchestra.toggleRoutine': (routineId, enabled) => o.toggleRoutine(id(routineId, 'routineId'), enabled),
    'orchestra.memory': (agentId) => o.memory(id(agentId, 'agentId')),
    'orchestra.deleteMemory': (memoryId) => o.deleteMemory(id(memoryId, 'memoryId')),
    'orchestra.inbox': (includeClosed) => o.inbox(includeClosed === true),
    'orchestra.answer': (itemId, answer) => o.answer(id(itemId, 'itemId'), answer),
    'orchestra.events': (afterId, limit) => o.events(typeof afterId === 'number' ? afterId : 0, typeof limit === 'number' ? limit : 200),
    'orchestra.tick': (opts) => o.tick(opts ?? {}),
    'orchestra.say': (input) => o.say(input),
    'orchestra.technologies': () => o.technologies(),
    'orchestra.agentContext': (agentId, taskId) => o.agentContext(id(agentId, 'agentId'), taskId === undefined ? undefined : id(taskId, 'taskId')),
    'orchestra.contextBlock': (scope, channelId) => o.contextBlock(scope, channelId === undefined ? undefined : id(channelId, 'channelId')),
    'orchestra.saveContextBlock': (input) => o.saveContextBlock(input),
    'orchestra.addCliAccount': (input) => o.addCliAccount(input),
    'orchestra.openLogin': (accountId) => o.openLogin(id(accountId, 'accountId')),
    'orchestra.checkAccount': (accountId) => o.checkAccount(id(accountId, 'accountId'))
  }
}
