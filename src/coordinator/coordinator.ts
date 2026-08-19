import type {
  ExtensionAPI,
  ExtensionContext,
} from '@earendil-works/pi-coding-agent'

import { persist } from '../helper.js'
import {
  applyModeSetup,
  assertModeIdle,
  exitReadOnly,
} from '../mode-switcher.js'
import { getPiModesConfig } from '../models-config.js'
import { exitPlanMode } from '../plan/index.js'
import { readModePrompt } from '../prompts.js'
import { ActivityReporter } from '../subagent/activity.js'
import { MessageBatcher } from '../subagent/batcher.js'
import { SubagentManagerDemo } from '../subagent/demo.js'
import { FleetList } from '../subagent/fleet.js'
import {
  type LiveSubagent,
  SubagentManager,
  type SubagentStatus,
} from '../subagent/manager.js'
import { loadRoles } from '../subagent/roles.js'
import { registerSubagentTools, SUBAGENT_TOOLS } from '../subagent/tools.js'
import { openSubagentViewer } from '../subagent/viewer.js'
import type { ModesState } from '../types.js'

const COORDINATOR_MODE_WIDGET_KEY = 'pi-modes:coordinator-mode'

const JOB_START_EVENT = 'pi-notify:job:start'
const JOB_END_EVENT = 'pi-notify:job:end'

export type { LiveSubagent, SubagentStatus }

interface CoordinatorRuntime {
  manager: SubagentManager
  activityReporter: ActivityReporter
  demoSubagentManager: SubagentManagerDemo | undefined
  fleet: FleetList
  batcher: MessageBatcher
}

let runtime: CoordinatorRuntime | undefined

function requiredRuntime(): CoordinatorRuntime {
  if (!runtime) {
    throw new Error('Coordinator mode is not initialized.')
  }
  return runtime
}

export async function enterCoordinatorMode(
  pi: ExtensionAPI,
  state: ModesState,
  request: string | undefined,
  ctx: ExtensionContext,
): Promise<void> {
  assertModeIdle(state, 'coordinator')
  state.mode = 'coordinator'
  await resumeCoordinatorMode(pi, state, ctx)
  persist(pi, state)
  if (request) pi.sendUserMessage(request, { deliverAs: 'followUp' })
}

export async function resumeCoordinatorMode(
  pi: ExtensionAPI,
  state: ModesState,
  ctx: ExtensionContext,
): Promise<void> {
  const { fleet, activityReporter } = requiredRuntime()
  fleet.setContext(ctx)
  await applyModeSetup(pi, state, 'coordinator', ctx, {
    extraTools: Object.values(SUBAGENT_TOOLS),
    color: 'accent',
  })
  fleet.update()
  activityReporter.start()
  const subagentModel = getPiModesConfig().subagentDefaultModel ?? 'DEFAULT'
  ctx.ui.setWidget(COORDINATOR_MODE_WIDGET_KEY, [
    ctx.ui.theme.fg(
      'accent',
      `${ctx.ui.theme.bold('👥 COORDINATOR MODE')} - subagent model ${subagentModel}`,
    ),
  ])
}

export async function exitCoordinatorMode(
  pi: ExtensionAPI,
  state: ModesState,
  ctx: ExtensionContext,
): Promise<void> {
  const { manager, fleet, batcher, activityReporter } = requiredRuntime()
  batcher.clear()
  activityReporter.stop()
  state.mode = undefined
  fleet.dispose()
  manager.disposeAll()
  ctx.ui.setWidget(COORDINATOR_MODE_WIDGET_KEY, undefined)
  await exitReadOnly(pi, state, ctx, 'coordinator')
}

export async function setupCoordinator(
  pi: ExtensionAPI,
  state: ModesState,
  { demoEnabled }: { demoEnabled: boolean },
): Promise<void> {
  const batcher = new MessageBatcher((messages: readonly string[]) => {
    if (state.mode !== 'coordinator') return
    pi.sendUserMessage(messages.join('\n\n'), { deliverAs: 'steer' })
  })
  const manager = new SubagentManager({
    onStatusChange: () => runtime?.fleet.update(),
    onStart: (subagent) => {
      pi.events.emit(JOB_START_EVENT, {
        id: `pi-modes:session:${subagent.id}`,
      })
    },
    onEnd: (subagent) => {
      pi.events.emit(JOB_END_EVENT, {
        id: `pi-modes:session:${subagent.id}`,
      })
      if (state.mode !== 'coordinator') return
      if (subagent.status === 'killed') return
      batcher.add(subagent, 'done', subagent.message ?? '(no message)')
    },
  })
  const activityReporter = new ActivityReporter({
    list: () => manager.list(),
    onActivity: (subagent, report) => {
      batcher.add(subagent, 'activity', report)
    },
  })

  const fleet = new FleetList({
    list: () => runtime?.demoSubagentManager?.list() ?? manager.list(),
    onOpen: async (ctx, id) => {
      const activeManager = runtime?.demoSubagentManager ?? manager
      return openSubagentViewer(ctx, activeManager, id)
    },
  })

  await loadRoles(process.cwd())

  runtime = {
    manager,
    activityReporter,
    demoSubagentManager: undefined,
    fleet,
    batcher,
  }

  registerSubagentTools(pi, state, manager, fleet)

  const coordinatorPrompt = await readModePrompt('coordinator')
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
    if (state.mode === 'plan') await exitPlanMode(pi, state, ctx)
    await enterCoordinatorMode(pi, state, undefined, ctx)
    if (request) pi.sendUserMessage(request, { deliverAs: 'followUp' })
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

  if (demoEnabled) {
    pi.registerCommand('subagent-demo', {
      description: 'Browse a subagent live demo (coordinator mode)',
      handler: async (args, ctx) => {
        const argList = args.split(/\s+/)
        if (!ctx.hasUI) return
        if (state.mode !== 'coordinator') {
          ctx.ui.notify(
            'Subagents browser is only available in coordinator mode.',
            'info',
          )
          return
        }

        const runtime = requiredRuntime()
        const { fleet } = runtime

        if (argList[0] === 'add') {
          runtime.demoSubagentManager ??= new SubagentManagerDemo()
          runtime.demoSubagentManager.add(argList.slice(1).join(' '))
          fleet.update()
          ctx.ui.notify(
            'Added a demo subagent. Use /subagent demo to exit demo mode.',
            'info',
          )
        } else if (runtime.demoSubagentManager) {
          runtime.demoSubagentManager = undefined
          fleet.update()
          ctx.ui.notify('Demo mode exited.', 'info')
        } else {
          runtime.demoSubagentManager = new SubagentManagerDemo()
          fleet.update()
          ctx.ui.notify(
            'Demo mode active: fake subagents loaded. Use /subagent demo to exit.',
            'info',
          )
        }
      },
    })
  }
}
