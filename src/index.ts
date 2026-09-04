import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

import { setupBashReadonlyTool } from './bash-readonly.js'
import {
  applyCoordinatorMode,
  enterCoordinatorMode,
  setupCoordinator,
} from './coordinator/coordinator.js'
import {
  getPiModesConfig,
  loadPiModesConfig,
  setupModesConfig,
} from './models-config/models-config.js'
import { setupSubagentModelCycle } from './models-config/subagent-model-cycle.js'
import { readModePrompt } from './prompts/mode.js'
import type { ModesState } from './types.js'
import { createState, getLastModesState } from './utils/state.js'

let pendingModesState: Partial<ModesState> | undefined

export default async function modesExtension(pi: ExtensionAPI): Promise<void> {
  const state = createState()
  await loadPiModesConfig()

  const coordinatorDefinition = await readModePrompt('coordinator')

  const demoEnabled = process.env.PI_DEMO === '1'

  setupBashReadonlyTool(pi)
  await setupCoordinator(pi, state, {
    demoEnabled,
    coordinatorDefinition,
  })
  setupModesConfig(pi, state)
  setupSubagentModelCycle(pi, state)

  pi.on('session_before_switch', (_event, ctx) => {
    pendingModesState = getLastModesState(ctx.sessionManager.getEntries())
  })

  pi.on('session_before_fork', (_event, ctx) => {
    pendingModesState = getLastModesState(ctx.sessionManager.getEntries())
  })

  pi.on('session_start', async (_event, ctx) => {
    let data = getLastModesState(ctx.sessionManager.getEntries())

    if (!data && pendingModesState) {
      data = pendingModesState
      pendingModesState = undefined
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

    if (getPiModesConfig().defaultMode === 'coordinator') {
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
