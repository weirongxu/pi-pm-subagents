import {
  applyCoordinatorMode,
  enterCoordinatorMode,
} from './coordinator/coordinator.js'
import { getLastPmSubagentState, persistSnapshot } from './utils/state.js'
import { optionalRuntime, setRuntime } from './coordinator/runtime.js'
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import type { PmSubagentState } from './types.js'
import type { PromptDefinition } from './utils/markdown.js'
import { getPmSubagentsConfig } from './models-config/models-config.js'

export function setupSessionLifecycle(
  pi: ExtensionAPI,
  state: PmSubagentState,
  coordinatorDefinition: PromptDefinition,
): void {
  pi.on('session_start', async (event, ctx) => {
    let data = getLastPmSubagentState(ctx.sessionManager.getEntries())

    if (event.reason === 'new') {
      data = undefined
    }

    if (data) {
      state.mode = data.mode
      state.modeDiffTools = data.modeDiffTools
      state.previousModel = data.previousModel
      state.sessionSubagentModel = data.sessionSubagentModel
      state.subagents =
        state.mode === 'coordinator' ? data.subagents : undefined
      state.maxSubagentId = data.maxSubagentId

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

  pi.on('session_shutdown', () => {
    const rt = optionalRuntime()
    try {
      if (rt) {
        const { manager, fleet, batcher, activityReporter } = rt
        if (state.mode === 'coordinator') {
          persistSnapshot(pi, state, manager)
          manager.disposeAll()
        }
        batcher.clear()
        activityReporter.stop()
        fleet.dispose()
      }
    } finally {
      setRuntime(undefined)
    }
  })
}
