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
import type { ModesState } from '../types.js'
import { ActivityReporter } from './activity.js'
import { MessageBatcher } from './batcher.js'
import { FleetList } from './fleet.js'
import { openWorkerViewer } from './viewer.js'
import type { LiveWorker, WorkerStatus } from './worker.js'
import {
  formatWorkerSummary,
  MAX_CONCURRENCY_WORKER,
  MAX_REUSE_FOLLOWUPS,
  WorkerManager,
} from './worker.js'
import { WorkerManagerDemo } from './worker-demo.js'

const MANAGER_MODE_WIDGET_KEY = 'pi-modes:manager-mode'

const JOB_START_EVENT = 'pi-notify:job:start'
const JOB_END_EVENT = 'pi-notify:job:end'

const MANAGER_TOOLS = {
  delegate: 'worker_delegate',
  kill: 'worker_kill',
  list: 'worker_list',
}

export type { LiveWorker, WorkerStatus }

interface ManagerRuntime {
  manager: WorkerManager
  activityReporter: ActivityReporter
  demoManager: WorkerManagerDemo | undefined
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
  const workerModel = getModelsConfig().worker
  ctx.ui.setWidget(MANAGER_MODE_WIDGET_KEY, [
    ctx.ui.theme.fg(
      'accent',
      `${ctx.ui.theme.bold('👥 MANAGER MODE')} - worker model ${workerModel}`,
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
  manager: WorkerManager,
  fleet: FleetList,
): void {
  if (managerToolsRegistered) return

  pi.registerTool({
    name: MANAGER_TOOLS.list,
    label: 'List Workers',
    description: `List all background workers with their status, don't use ${MANAGER_TOOLS.list} to wait workers finished just idle`,
    parameters: Type.Object({}),
    async execute() {
      const allWorkers = manager.list()
      if (allWorkers.length === 0) {
        return {
          content: [{ type: 'text', text: 'No workers.' }],
          details: {},
        }
      }

      const sorted = [...allWorkers].sort((a, b) => a.startedAt - b.startedAt)
      const lines = [`Workers (${allWorkers.length}):`]
      for (const worker of sorted) {
        lines.push(formatWorkerSummary(worker))
      }

      const hasRunning = sorted.some((worker) => worker.status === 'running')
      if (hasRunning)
        lines.push(
          '',
          'Do not poll worker_list to wait for completion - just idle — you will be notified when workers finish.',
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
    label: 'Delegate Worker',
    description: `Delegate task to background with full tool access. The tool returns immediately with a worker id; I'll send you last message when worker finishes. Max concurrency ${MAX_CONCURRENCY_WORKER} running workers`,
    parameters: Type.Object({
      title: Type.String(),
      prompt: Type.String({
        description:
          'A self-contained description of the work the worker should do.',
      }),
      followupOf: Type.Optional(
        Type.Number({
          description: `Reuse worker id to follow up. Omit for a fresh task. Max reuse ${MAX_REUSE_FOLLOWUPS} times`,
        }),
      ),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const workerRef = getModelsConfig().worker
      const workerModel = resolveModelRef(ctx, workerRef) ?? ctx.model
      let worker: LiveWorker
      try {
        worker = await manager.spawn(params.title, params.prompt, {
          cwd: ctx.cwd,
          model: workerModel,
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
          void manager.abort(worker.id)
        }
        if (signal.aborted) stop()
        else signal.addEventListener('abort', stop, { once: true })
      }

      return {
        content: [
          {
            type: 'text',
            text: `Worker id #${worker.id} background. I'll send you last message when it finishes.`,
          },
        ],
        details: { workerId: worker.id, status: worker.status },
      }
    },
  })

  pi.registerTool({
    name: MANAGER_TOOLS.kill,
    label: 'Kill Worker',
    description:
      'Stop a running worker by id. Only running workers can be killed.',
    parameters: Type.Object({
      id: Type.Number({ description: 'Worker id to stop.' }),
    }),
    async execute(_toolCallId, params): Promise<AgentToolResult<unknown>> {
      const worker = manager.get(params.id)
      if (!worker) {
        return {
          content: [{ type: 'text', text: `Worker #${params.id} not found.` }],
          details: {},
        }
      }
      try {
        const stopped = await manager.abort(params.id)
        const message = stopped
          ? `Worker #${params.id} stopped.`
          : `Worker #${params.id} is not running (status: ${worker.status}).`
        return {
          content: [{ type: 'text', text: message }],
          details: { workerId: params.id, status: worker.status },
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return {
          content: [{ type: 'text', text: message }],
          details: { workerId: params.id, status: worker.status },
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
  const manager = new WorkerManager({
    onStatusChange: () => runtime?.fleet.update(),
    onStart: (worker) => {
      pi.events.emit(JOB_START_EVENT, {
        id: `pi-modes:session:${worker.id}`,
      })
    },
    onEnd: (worker) => {
      pi.events.emit(JOB_END_EVENT, {
        id: `pi-modes:session:${worker.id}`,
      })
      if (state.mode !== 'manager') return
      batcher.add(
        worker,
        'done',
        `<message>\n${worker.message ?? '(no message)'}\n</message>`,
      )
    },
  })
  const activityReporter = new ActivityReporter({
    list: () => manager.list(),
    onActivity: (worker, report) => {
      batcher.add(worker, 'activity', report)
    },
  })

  const fleet = new FleetList({
    list: () => runtime?.demoManager?.list() ?? manager.list(),
    onOpen: async (ctx, id) => {
      const activeManager = runtime?.demoManager ?? manager
      return openWorkerViewer(ctx, activeManager, id)
    },
  })

  runtime = {
    manager,
    activityReporter,
    demoManager: undefined,
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
    pi.registerCommand('workers-demo', {
      description: 'Browse a worker live demo (manager mode)',
      handler: async (args, ctx) => {
        const argList = args.split(/\s+/)
        if (!ctx.hasUI) return
        if (state.mode !== 'manager') {
          ctx.ui.notify(
            'Workers browser is only available in manager mode.',
            'info',
          )
          return
        }

        const runtime = requiredRuntime()
        const { fleet } = runtime

        if (argList[0] === 'add') {
          runtime.demoManager ??= new WorkerManagerDemo()
          runtime.demoManager.add(argList.slice(1).join(' '))
          fleet.update()
          ctx.ui.notify(
            'Added a demo worker. Use /workers demo to exit demo mode.',
            'info',
          )
        } else if (runtime.demoManager) {
          runtime.demoManager = undefined
          fleet.update()
          ctx.ui.notify('Demo mode exited.', 'info')
        } else {
          runtime.demoManager = new WorkerManagerDemo()
          fleet.update()
          ctx.ui.notify(
            'Demo mode active: fake workers loaded. Use /workers demo to exit.',
            'info',
          )
        }
      },
    })
  }
}
