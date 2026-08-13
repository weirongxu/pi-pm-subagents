import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

import { setupBashReadonlyTool } from './bash-readonly.js'
import { createState, getLastModesState } from './helper.js'
import { resumeManagerMode, setupManager } from './manager/index.js'
import { loadModelsConfig, setupModesConfig } from './models-config.js'
import { resumePlanMode, setupPlan } from './plan/index.js'

export default async function modesExtension(pi: ExtensionAPI): Promise<void> {
  const state = createState()
  await loadModelsConfig()

  const demoEnabled = process.env.DEMO === '1'

  setupBashReadonlyTool(pi)
  await setupPlan(pi, state, { demoEnabled })
  await setupManager(pi, state, { demoEnabled })
  setupModesConfig(pi, state)

  // Restore persisted state on startup, reload, new, resume, and fork.
  pi.on('session_start', async (_event, ctx) => {
    const data = getLastModesState(ctx.sessionManager.getEntries())
    if (data) {
      state.mode = data.mode
      state.planMarkdown = data.planMarkdown
      state.toolsBackup = data.toolsBackup
      state.modelBackup = data.modelBackup

      if (state.mode === 'plan') {
        await resumePlanMode(pi, state, ctx)
      } else if (state.mode === 'manager') {
        await resumeManagerMode(pi, state, ctx)
      }
    }
  })
}
