import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

import { setupBashReadonlyTool } from './bash-readonly.js'
import { resumeCoordinatorMode, setupCoordinator } from './coordinator/index.js'
import { createState, getLastModesState, persist } from './helper.js'
import { loadPiModesConfig, setupModesConfig } from './models-config.js'
import { resumePlanMode, setupPlan } from './plan/index.js'
import type { ModesState } from './types.js'

let pendingModesState: Partial<ModesState> | undefined

export default async function modesExtension(pi: ExtensionAPI): Promise<void> {
  const state = createState()
  await loadPiModesConfig()

  const demoEnabled = process.env.DEMO === '1'

  setupBashReadonlyTool(pi)
  await setupPlan(pi, state, { demoEnabled })
  await setupCoordinator(pi, state, { demoEnabled })
  setupModesConfig(pi)

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
      state.planMarkdown = data.planMarkdown
      state.previousActiveTools = data.previousActiveTools

      if (state.mode === 'plan') {
        await resumePlanMode(pi, state, ctx)
      } else if (state.mode === 'coordinator') {
        await resumeCoordinatorMode(pi, state, ctx)
      }

      persist(pi, state)
    }
  })
}
