import type {
  ExtensionAPI,
  ExtensionContext,
} from '@earendil-works/pi-coding-agent'

import { getPmSubagentsConfig } from '../models-config/models-config.js'
import { formatSubagentModelLabel } from '../models-config/subagent-model-utils.js'
import { runPlanCommand } from '../plan/command.js'
import { registerPlanDemoCommand } from '../plan/demo.js'
import { applyModeFor, assertModeIdle, exitModeFor } from '../pm-mode.js'
import { loadRoles } from '../prompts/roles.js'
import { ActivityReporter } from '../subagent/activity.js'
import { MessageBatcher } from '../subagent/batcher.js'
import { registerSubagentDemoCommand } from '../subagent/demo.js'
import { FleetList } from '../subagent/fleet.js'
import { SubagentManager } from '../subagent/manager.js'
import { restoreSubagents } from '../subagent/restore.js'
import { registerSubagentTools, SUBAGENT_TOOLS } from '../subagent/tools.js'
import { openSubagentViewer } from '../subagent/viewer.js'
import type { PmSubagentState } from '../types.js'
import {
  mergePromptDefinitions,
  type PromptDefinition,
} from '../utils/markdown.js'
import { notifyAgentMessage } from '../utils/messages.ts'
import { persistSnapshot } from '../utils/state.js'
import { requiredRuntime, setRuntime } from './runtime.js'

const COORDINATOR_MODE_WIDGET_KEY = 'pi-pm-subagents:coordinator-mode'

/** job event for pi-notify */
const JOB_START_EVENT = 'pi-notify:job:start'
const JOB_END_EVENT = 'pi-notify:job:end'

export async function enterCoordinatorMode(
  pi: ExtensionAPI,
  state: PmSubagentState,
  prompt: string | undefined,
  ctx: ExtensionContext,
  def: PromptDefinition,
): Promise<void> {
  assertModeIdle(state, 'coordinator')
  state.mode = 'coordinator'
  await applyCoordinatorMode(pi, state, ctx, def)
  if (prompt) notifyAgentMessage(pi, prompt)
}

export function renderCoordinatorModeWidget(
  ctx: ExtensionContext,
  state?: PmSubagentState,
): void {
  const config = getPmSubagentsConfig()
  const scope = config.subagentModelScoped ?? []
  const currentRef = state?.sessionSubagentModel ?? config.subagentModel
  const label = formatSubagentModelLabel(scope, currentRef)
  ctx.ui.setWidget(COORDINATOR_MODE_WIDGET_KEY, [
    ctx.ui.theme.fg(
      'accent',
      `${ctx.ui.theme.bold('👥 COORDINATOR MODE')} - subagent: ${label}`,
    ),
  ])
}

export async function applyCoordinatorMode(
  pi: ExtensionAPI,
  state: PmSubagentState,
  ctx: ExtensionContext,
  def: PromptDefinition,
): Promise<void> {
  const { fleet, activityReporter } = requiredRuntime()
  fleet.setContext(ctx)

  await applyModeFor(pi, state, 'coordinator', ctx, {
    promptDefinition: mergePromptDefinitions(def, {
      fm: {
        extraTools: Object.values(SUBAGENT_TOOLS),
      },
    }),
    color: 'accent',
  })

  renderCoordinatorModeWidget(ctx, state)
  await restoreSubagents(pi, state, ctx, state.subagents)

  fleet.update()
  activityReporter.start()
}

export async function exitCoordinatorMode(
  pi: ExtensionAPI,
  state: PmSubagentState,
  ctx: ExtensionContext,
): Promise<void> {
  const { manager, fleet, batcher, activityReporter } = requiredRuntime()
  batcher.clear()
  activityReporter.stop()
  fleet.dispose()
  manager.disposeAll()
  ctx.ui.setWidget(COORDINATOR_MODE_WIDGET_KEY, undefined)
  state.mode = undefined
  state.subagents = undefined
  await exitModeFor(pi, state, ctx, 'coordinator')
}

export async function setupCoordinator(
  pi: ExtensionAPI,
  state: PmSubagentState,
  {
    demoEnabled,
    coordinatorDefinition,
  }: {
    demoEnabled: boolean
    coordinatorDefinition: PromptDefinition
  },
): Promise<void> {
  let pendingUiPrompts = 0
  const batcher = new MessageBatcher((messages: readonly string[]) => {
    if (state.mode !== 'coordinator') return
    notifyAgentMessage(pi, messages.join('\n\n'))
  })
  const manager = new SubagentManager({
    state,
    onStatusChange: () => {
      persistSnapshot(pi, state, manager)
      fleet.update()
    },
    onEachStart: (subagent) => {
      pi.events.emit(JOB_START_EVENT, {
        id: `pi-pm-subagents:session:${subagent.record.id}`,
      })
    },
    onEachEnd: (subagent) => {
      pi.events.emit(JOB_END_EVENT, {
        id: `pi-pm-subagents:session:${subagent.record.id}`,
      })
    },
  })
  const activityReporter = new ActivityReporter({
    list: () => manager.list(),
    onActivity: (subagent, report) => {
      batcher.add(subagent, 'activity', report)
    },
    shouldPause: () => pendingUiPrompts > 0,
  })

  pi.on('ui_prompt_start', () => {
    pendingUiPrompts++
  })
  pi.on('ui_prompt_end', () => {
    pendingUiPrompts = Math.max(0, pendingUiPrompts - 1)
  })

  const fleet = new FleetList({
    list: () => {
      const runtime = requiredRuntime()
      const items =
        runtime.demoSubagentManager?.list() ?? runtime.manager.list()
      return items.map(({ record }) => record)
    },
    onOpen: async (ctx, id) => {
      const runtime = requiredRuntime()
      const activeManager = runtime.demoSubagentManager ?? runtime.manager
      return openSubagentViewer(ctx, activeManager, id)
    },
  })

  await loadRoles(process.cwd(), {
    skipPluginAgents: getPmSubagentsConfig().skipPluginAgents,
  })

  setRuntime({
    manager,
    activityReporter,
    demoSubagentManager: undefined,
    fleet,
    batcher,
  })

  registerSubagentTools(pi, state)

  const coordinatorPrompt = coordinatorDefinition.systemPrompt

  pi.on('before_agent_start', async (event) => {
    if (state.mode !== 'coordinator') return
    return { systemPrompt: `${event.systemPrompt}\n\n${coordinatorPrompt}` }
  })

  const runCoordinatorCommand = async (args: string, ctx: ExtensionContext) => {
    const request = args.trim()
    if (state.mode === 'coordinator') {
      await exitCoordinatorMode(pi, state, ctx)
      ctx.ui.notify('Coordinator mode off.', 'info')
      return
    }
    await enterCoordinatorMode(pi, state, undefined, ctx, coordinatorDefinition)
    if (request) notifyAgentMessage(pi, request)
  }

  pi.registerCommand('coordinator', {
    description:
      'Coordinator mode. Usage: /coordinator [request] — toggles, or enters with a task',
    handler: runCoordinatorCommand,
  })

  pi.registerCommand('pm', {
    description:
      'Coordinator mode. Usage: /pm [request] — toggles, or enters with a task',
    handler: runCoordinatorCommand,
  })

  pi.registerCommand('plan', {
    description: 'Delegate a planner subagent. Usage: /plan <request>',
    handler: async (args, ctx) => {
      await runPlanCommand(pi, state, args, ctx, () =>
        enterCoordinatorMode(pi, state, undefined, ctx, coordinatorDefinition),
      )
    },
  })

  if (demoEnabled) {
    registerSubagentDemoCommand(pi, state, {
      getDemoManager: () => requiredRuntime().demoSubagentManager,
      setDemoManager: (manager) => {
        requiredRuntime().demoSubagentManager = manager
      },
      updateFleet: () => {
        requiredRuntime().fleet.update()
      },
    })
    registerPlanDemoCommand(pi)
  }
}
