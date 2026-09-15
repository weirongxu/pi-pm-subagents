import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

import { setupBashReadonlyTool } from './bash-readonly.js'
import { setupCoordinator } from './coordinator/coordinator.js'
import { setupListDirTool } from './list-dir.js'
import {
  loadPmSubagentsConfig,
  setupPmSubagentsConfig,
} from './models-config/models-config.js'
import { setupSubagentModelCycle } from './models-config/subagent-model-cycle.js'
import { readModePrompt } from './prompts/mode.js'
import { setupSessionLifecycle } from './session-lifecycle.js'
import { isSubagentSpawnContext } from './subagent/identity.js'
import { createState } from './utils/state.js'

export default async function pmSubagentsExtension(
  pi: ExtensionAPI,
): Promise<void> {
  setupBashReadonlyTool(pi)
  setupListDirTool(pi)
  if (isSubagentSpawnContext()) {
    return
  }

  const state = createState()
  await loadPmSubagentsConfig()

  const coordinatorDefinition = await readModePrompt('coordinator')

  const demoEnabled = process.env.PI_DEMO === '1'

  await setupCoordinator(pi, state, {
    demoEnabled,
    coordinatorDefinition,
  })
  setupPmSubagentsConfig(pi, state, coordinatorDefinition)
  setupSubagentModelCycle(pi, state)
  setupSessionLifecycle(pi, state, coordinatorDefinition)
}
