import type { ActivityReporter } from '../subagent/activity.js'
import type { MessageBatcher } from '../subagent/batcher.js'
import type { SubagentManagerDemo } from '../subagent/demo.js'
import type { FleetList } from '../subagent/fleet.js'
import type { SubagentManager } from '../subagent/manager.js'

export interface CoordinatorRuntime {
  manager: SubagentManager
  activityReporter: ActivityReporter
  demoSubagentManager: SubagentManagerDemo | undefined
  fleet: FleetList
  batcher: MessageBatcher
}

let runtimeLocal: CoordinatorRuntime | undefined

export function requiredRuntime(): CoordinatorRuntime {
  if (!runtimeLocal) {
    throw new Error('Coordinator mode is not initialized.')
  }
  return runtimeLocal
}

export function optionalRuntime(): CoordinatorRuntime | undefined {
  return runtimeLocal
}

export function setRuntime(next: CoordinatorRuntime | undefined): void {
  runtimeLocal = next
}
