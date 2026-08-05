import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

import {
  createState,
  getLastModesState,
  isReadOnlyBashCommand,
} from './helper.js'
import { resumeManagerMode, setupManager } from './manager.js'
import { loadModelsConfig, setupModesConfig } from './models-config.js'
import { resumePlanMode, setupPlan } from './plan.js'

export default async function modesExtension(pi: ExtensionAPI): Promise<void> {
  const state = createState()
  await loadModelsConfig()

  await setupPlan(pi, state)
  await setupManager(pi, state)
  setupModesConfig(pi, state)

  // Shared read-only bash gate for both plan and manager modes.
  pi.on('tool_call', async (event) => {
    if (!state.mode || event.toolName !== 'bash') return
    const command = (event.input as { command?: string }).command ?? ''
    if (!isReadOnlyBashCommand(command)) {
      return {
        block: true,
        reason: `Read-only mode (plan/manager): command not allowed.\n  ${command}`,
      }
    }
  })

  // Restore persisted state on startup, reload, new, resume, and fork.
  pi.on('session_start', async (_event, ctx) => {
    const data = getLastModesState(ctx.sessionManager.getEntries())
    if (!data) return

    state.mode = data.mode
    state.planMarkdown = data.planMarkdown
    state.toolsBackup = data.toolsBackup
    state.modelBackup = data.modelBackup

    if (state.mode === 'plan') {
      await resumePlanMode(pi, state, ctx)
    } else if (state.mode === 'manager') {
      await resumeManagerMode(pi, state, ctx)
    }
  })
}
