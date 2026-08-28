import type {
  ExtensionAPI,
  ExtensionContext,
} from '@earendil-works/pi-coding-agent'
import { Key } from '@earendil-works/pi-tui'

import { renderCoordinatorModeWidget } from '../coordinator/index.js'
import type { ModesState } from '../types.js'
import { getPiModesConfig } from './models-config.js'
import { MODEL_DEFAULT } from './subagent-model-constants.js'
import { cycleSubagentModel } from './subagent-model-utils.js'

function cycleAndApply(
  ctx: ExtensionContext,
  state: ModesState,
  direction: 1 | -1,
): void {
  const config = getPiModesConfig()
  const scoped = config.subagentModelScoped ?? []

  if (scoped.length === 0) {
    ctx.ui.notify(
      'Subagent scope is empty. Use /modes-subagent-scope to add models.',
      'warning',
    )
    return
  }

  const currentRef = state.sessionSubagentModel
  const result = cycleSubagentModel(scoped, currentRef, direction)
  state.sessionSubagentModel =
    result.ref === MODEL_DEFAULT ? undefined : result.ref
  ctx.ui.notify(
    `Subagent model: ${result.ref} [session] (${result.index + 1}/${result.poolSize})`,
    'info',
  )
  if (state.mode === 'coordinator') renderCoordinatorModeWidget(ctx, state)
}

export function setupSubagentModelCycle(
  pi: ExtensionAPI,
  state: ModesState,
): void {
  const config = getPiModesConfig()
  state.sessionSubagentModel ??= config.subagentModel

  pi.registerShortcut(Key.alt('n'), {
    description: 'Cycle subagent model forward',
    handler: (ctx) => {
      cycleAndApply(ctx, state, 1)
    },
  })
}
