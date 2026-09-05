import { AsyncLocalStorage } from 'node:async_hooks'

export const SUBAGENT_SESSION_ID_PREFIX = 'pi-pm-subagents-subagent-'

const spawnContext = new AsyncLocalStorage<{ id: number }>()

export function isSubagentSpawnContext(): boolean {
  return spawnContext.getStore() !== undefined
}

export function runInSubagentSpawnContext<T>(
  id: number,
  fn: () => Promise<T>,
): Promise<T> {
  return spawnContext.run({ id }, fn)
}
