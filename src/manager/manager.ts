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
import { getModelsConfig } from '../models-config.js'
import { exitPlanMode } from '../plan/index.js'
import { readPrompt } from '../prompts.js'
import { ActivityReporter } from '../subagent/activity.js'
import { MessageBatcher } from '../subagent/batcher.js'
import { SubagentManagerDemo } from '../subagent/demo.js'
import { FleetList } from '../subagent/fleet.js'
import {
  type LiveSubagent,
  SubagentManager,
  type SubagentStatus,
} from '../subagent/manager.js'
import {
  registerSubagentTools,
  resetSubagentTools,
  SUBAGENT_TOOLS,
} from '../subagent/tools.js'
import { openSubagentViewer } from '../subagent/viewer.js'
import type { ModesState } from '../types.js'

const MANAGER_MODE_WIDGET_KEY = 'pi-modes:manager-mode'

const JOB_START_EVENT = 'pi-notify:job:start'
const JOB_END_EVENT = 'pi-notify:job:end'

export type { LiveSubagent, SubagentStatus }

interface ManagerRuntime {
  manager: SubagentManager
  activityReporter: ActivityReporter
  demoSubagentManager: SubagentManagerDemo | undefined
  fleet: FleetList
  batcher: MessageBatcher
}

let runtime: ManagerRuntime | undefined

function requiredRuntime(): ManagerRuntime {
  if (!runtime) {
    throw new Error('Manager mode is not initialized.')
  }
  return runtime
}

export async function enterManagerMode(
  pi: ExtensionAPI,
  state: ModesState,
  request: string | undefined,
  ctx: ExtensionContext,
): Promise<void> {
  assertModeIdle(state, 'manager')
  state.mode = 'manager'
  state.planMarkdown = request
  await resumeManagerMode(pi, state, ctx)
  persist(pi, state)
  if (request) pi.sendUserMessage(request, { deliverAs: 'followUp' })
}

export async function resumeManagerMode(
  pi: ExtensionAPI,
  state: ModesState,
  ctx: ExtensionContext,
): Promise<void> {
  const { manager, fleet, activityReporter } = requiredRuntime()
  registerSubagentTools(pi, state, manager, fleet)
  fleet.setContext(ctx)
  await applyModeSetup(pi, state, 'manager', ctx, {
    extraTools: Object.values(SUBAGENT_TOOLS),
    color: 'accent',
  })
  fleet.update()
  activityReporter.start()
  const subagentModel = getModelsConfig().subagent
  ctx.ui.setWidget(MANAGER_MODE_WIDGET_KEY, [
    ctx.ui.theme.fg(
      'accent',
      `${ctx.ui.theme.bold('👥 MANAGER MODE')} - subagent model ${subagentModel}`,
    ),
  ])
}

export async function exitManagerMode(
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
  ctx.ui.setWidget(MANAGER_MODE_WIDGET_KEY, undefined)
  await exitReadOnly(pi, state, ctx, 'manager', { restoreModel: true })
}

export async function setupManager(
  pi: ExtensionAPI,
  state: ModesState,
  { demoEnabled }: { demoEnabled: boolean },
): Promise<void> {
  const batcher = new MessageBatcher((messages: readonly string[]) => {
    if (state.mode !== 'manager') return
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
      if (state.mode !== 'manager') return
      batcher.add(
        subagent,
        'done',
        `<message>\n${subagent.message ?? '(no message)'}\n</message>`,
      )
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

  runtime = {
    manager,
    activityReporter,
    demoSubagentManager: undefined,
    fleet,
    batcher,
  }

  pi.on('session_start', () => {
    resetSubagentTools()
  })

  const managerPrompt = await readPrompt('manager')
  pi.on('before_agent_start', async (event) => {
    if (state.mode !== 'manager') return
    return { systemPrompt: `${event.systemPrompt}\n\n${managerPrompt}` }
  })

  pi.registerCommand('manager', {
    description:
      'Manager mode. Usage: /manager [request] — toggles, or enters with a task',
    handler: async (args, ctx) => {
      const request = args.trim()
      if (state.mode === 'manager') {
        await exitManagerMode(pi, state, ctx)
        ctx.ui.notify('Manager mode off.', 'info')
        return
      }
      if (state.mode === 'plan') await exitPlanMode(pi, state, ctx)
      await enterManagerMode(pi, state, undefined, ctx)
      if (request) pi.sendUserMessage(request, { deliverAs: 'followUp' })
    },
  })

  if (demoEnabled) {
    pi.registerCommand('subagent-demo', {
      description: 'Browse a subagent live demo (manager mode)',
      handler: async (args, ctx) => {
        const argList = args.split(/\s+/)
        if (!ctx.hasUI) return
        if (state.mode !== 'manager') {
          ctx.ui.notify(
            'Subagents browser is only available in manager mode.',
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
