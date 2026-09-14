import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

import {
  applyCoordinatorMode,
  enterCoordinatorMode,
} from './coordinator/coordinator.js'
import { getPmSubagentsConfig } from './models-config/models-config.js'
import type { PmSubagentState } from './types.js'
import type { PromptDefinition } from './utils/markdown.js'
import { getLastPmSubagentState } from './utils/state.js'

let pendingPmSubagentState: Partial<PmSubagentState> | undefined

export function setupSessionStore(
  pi: ExtensionAPI,
  state: PmSubagentState,
  coordinatorDefinition: PromptDefinition,
): void {
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
