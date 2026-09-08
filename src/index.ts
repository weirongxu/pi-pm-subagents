import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

import { setupBashReadonlyTool } from './bash-readonly.js'
import {
  applyCoordinatorMode,
  enterCoordinatorMode,
  setupCoordinator,
} from './coordinator/coordinator.js'
import { setupListDirTool } from './list-dir.js'
import {
  getPmSubagentsConfig,
  loadPmSubagentsConfig,
  setupPmSubagentsConfig,
} from './models-config/models-config.js'
import { setupSubagentModelCycle } from './models-config/subagent-model-cycle.js'
import { readModePrompt } from './prompts/mode.js'
import { isSubagentSpawnContext } from './subagent/identity.js'
import type { PmSubagentState } from './types.js'
import { createState, getLastPmSubagentState } from './utils/state.js'

let pendingPmSubagentState: Partial<PmSubagentState> | undefined

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

  pi.on('session_before_switch', (_event, ctx) => {
    pendingPmSubagentState = getLastPmSubagentState(
      ctx.sessionManager.getEntries(),
    )
  })

  pi.on('session_before_fork', (_event, ctx) => {
    pendingPmSubagentState = getLastPmSubagentState(
      ctx.sessionManager.getEntries(),
    )
  })

  pi.on('session_start', async (_event, ctx) => {
    let data = getLastPmSubagentState(ctx.sessionManager.getEntries())

    if (!data && pendingPmSubagentState) {
      data = pendingPmSubagentState
      pendingPmSubagentState = undefined
    }

    if (data) {
      state.mode = data.mode
      state.modeDiffTools = data.modeDiffTools
      state.previousModel = data.previousModel
      state.sessionSubagentModel = data.sessionSubagentModel

      if (state.mode === 'coordinator') {
        await applyCoordinatorMode(pi, state, ctx, coordinatorDefinition)
      }

      return
    }

    if (getPmSubagentsConfig().defaultMode === 'coordinator') {
      await enterCoordinatorMode(
        pi,
        state,
        undefined,
        ctx,
        coordinatorDefinition,
      )
    }
  })
}
