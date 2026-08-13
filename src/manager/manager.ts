import type {
  AgentToolResult,
  ExtensionAPI,
  ExtensionContext,
} from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'

import { persist } from '../helper.js'
import {
  applyModeSetup,
  assertModeIdle,
  exitReadOnly,
} from '../mode-switcher.js'
import { getModelsConfig, resolveModelRef } from '../models-config.js'
import { exitPlanMode } from '../plan/index.js'
import { readPrompt } from '../prompts.js'
import { FleetList } from '../subagent/fleet.js'
import {
  ActivityReporter,
  formatSubagentSummary,
  type LiveSubagent,
  MAX_CONCURRENCY_SUBAGENT,
  MAX_REUSE_FOLLOWUPS,
  MessageBatcher,
  openSubagentViewer,
  SubagentManager,
  SubagentManagerDemo,
  type SubagentStatus,
} from '../subagent/index.js'
import type { ModesState } from '../types.js'

const MANAGER_MODE_WIDGET_KEY = 'pi-modes:manager-mode'

const JOB_START_EVENT = 'pi-notify:job:start'
const JOB_END_EVENT = 'pi-notify:job:end'

const MANAGER_TOOLS = {
  delegate: 'subagent_delegate',
  kill: 'subagent_kill',
  list: 'subagent_list',
}

export type { LiveSubagent, SubagentStatus }

interface ManagerRuntime {
  manager: SubagentManager
  activityReporter: ActivityReporter
  demoSubagentManager: SubagentManagerDemo | undefined
  fleet: FleetList
  batcher: MessageBatcher
}

let runtime: ManagerRuntime | undefined
let managerToolsRegistered = false

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
  ensureManagerTools(pi, state, manager, fleet)
  fleet.setContext(ctx)
  await applyModeSetup(pi, state, 'manager', ctx, {
    extraTools: Object.values(MANAGER_TOOLS),
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

function ensureManagerTools(
  pi: ExtensionAPI,
  state: ModesState,
  manager: SubagentManager,
  fleet: FleetList,
): void {
  if (managerToolsRegistered) return

  pi.registerTool({
    name: MANAGER_TOOLS.list,
    label: 'List Subagents',
    description: `List all background subagents with their status, don't use ${MANAGER_TOOLS.list} to wait subagents finished just idle`,
    parameters: Type.Object({}),
    async execute() {
      const allSubagents = manager.list()
      if (allSubagents.length === 0) {
        return {
          content: [{ type: 'text', text: 'No subagents.' }],
          details: {},
        }
      }

      const sorted = [...allSubagents].sort((a, b) => a.startedAt - b.startedAt)
      const lines = [`Subagents (${allSubagents.length}):`]
      for (const subagent of sorted) {
        lines.push(formatSubagentSummary(subagent))
      }

      const hasRunning = sorted.some(
        (subagent) => subagent.status === 'running',
      )
      if (hasRunning)
        lines.push(
          '',
          'Do not poll subagent_list to wait for completion - just idle — you will be notified when subagents finish.',
        )
      return {
        content: [
          {
            type: 'text',
            text: lines.join('\n'),
          },
        ],
        details: {},
      }
    },
  })

  pi.registerTool({
    name: MANAGER_TOOLS.delegate,
    label: 'Delegate Subagent',
    description: `Delegate task to background with full tool access. The tool returns immediately with a subagent id; I'll send you last message when subagent finishes. Max concurrency ${MAX_CONCURRENCY_SUBAGENT} running subagents`,
    parameters: Type.Object({
      title: Type.String(),
      prompt: Type.String({
        description:
          'A self-contained description of the work the subagent should do.',
      }),
      followupOf: Type.Optional(
        Type.Number({
          description: `Reuse subagent id to follow up. Omit for a fresh task. Max reuse ${MAX_REUSE_FOLLOWUPS} times`,
        }),
      ),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const subagentRef = getModelsConfig().subagent
      const subagentModel = resolveModelRef(ctx, subagentRef) ?? ctx.model
      let subagent: LiveSubagent
      try {
        subagent = await manager.spawn(params.title, params.prompt, {
          cwd: ctx.cwd,
          model: subagentModel,
          thinkingLevel: ctx.thinkingLevel,
          tools: state.toolsBackup,
          followupOf: params.followupOf,
        })
        fleet.update()
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return {
          content: [{ type: 'text', text: message }],
          details: {},
        }
      }

      if (signal) {
        const stop = (): void => {
          void manager.abort(subagent.id)
        }
        if (signal.aborted) stop()
        else signal.addEventListener('abort', stop, { once: true })
      }

      return {
        content: [
          {
            type: 'text',
            text: `Subagent id #${subagent.id} background. I'll send you last message when it finishes.`,
          },
        ],
        details: { subagentId: subagent.id, status: subagent.status },
      }
    },
  })

  pi.registerTool({
    name: MANAGER_TOOLS.kill,
    label: 'Kill Subagent',
    description:
      'Stop a running subagent by id. Only running subagents can be killed.',
    parameters: Type.Object({
      id: Type.Number({ description: 'Subagent id to stop.' }),
    }),
    async execute(_toolCallId, params): Promise<AgentToolResult<unknown>> {
      const subagent = manager.get(params.id)
      if (!subagent) {
        return {
          content: [
            { type: 'text', text: `Subagent #${params.id} not found.` },
          ],
          details: {},
        }
      }
      try {
        const stopped = await manager.abort(params.id)
        const message = stopped
          ? `Subagent #${params.id} stopped.`
          : `Subagent #${params.id} is not running (status: ${subagent.status}).`
        return {
          content: [{ type: 'text', text: message }],
          details: { subagentId: params.id, status: subagent.status },
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return {
          content: [{ type: 'text', text: message }],
          details: { subagentId: params.id, status: subagent.status },
        }
      }
    },
  })

  managerToolsRegistered = true
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
    managerToolsRegistered = false
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
