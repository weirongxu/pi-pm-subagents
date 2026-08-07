import type {
  AgentToolResult,
  ExtensionAPI,
  ExtensionContext,
} from '@earendil-works/pi-coding-agent'
import { truncateToWidth } from '@earendil-works/pi-tui'
import { Type } from 'typebox'

import { MANAGER_TOOLS } from './consts.js'
import { DemoWorkerManager } from './demo-worker-manager.js'
import { FleetList } from './fleet-list.js'
import { persist } from './helper.js'
import {
  applyModeSetup,
  assertModeIdle,
  exitReadOnly,
} from './mode-switcher.js'
import { getModelsConfig, resolveModelRef } from './models-config.js'
import { exitPlanMode } from './plan.js'
import { readPrompt } from './prompts.js'
import type { ModesState } from './types.js'
import {
  type LiveWorker,
  MAX_CONCURRENCY_WORKER,
  MAX_REUSE_FOLLOWUPS,
  WorkerManager,
} from './worker-manager.js'
import { openWorkerViewer } from './worker-viewer.js'

const MANAGER_MODE_WIDGET_KEY = 'pi-modes:manager-mode'

export type { LiveWorker, WorkerStatus } from './worker-manager.js'

export class CompletionBatcher {
  private pendingWorkers: LiveWorker[] = []
  private timer: ReturnType<typeof setTimeout> | undefined

  constructor(
    private readonly flush: (workers: LiveWorker[]) => void,
    private readonly windowMs = 5000,
  ) {}

  get pending(): readonly LiveWorker[] {
    return [...this.pendingWorkers]
  }

  add(worker: LiveWorker): void {
    this.pendingWorkers.push(worker)
    if (this.timer !== undefined) return
    this.timer = setTimeout(() => {
      this.flushNow()
    }, this.windowMs)
  }

  flushNow(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
    if (this.pendingWorkers.length === 0) return

    const workers = this.pendingWorkers
    this.pendingWorkers = []
    this.flush(workers)
  }

  clear(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
    this.pendingWorkers = []
  }
}

interface ManagerRuntime {
  manager: WorkerManager
  demoManager: DemoWorkerManager | undefined
  fleet: FleetList
  batcher: CompletionBatcher
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
  const { manager, fleet } = requiredRuntime()
  ensureManagerTools(pi, state, manager, fleet)
  fleet.setContext(ctx)
  await applyModeSetup(pi, state, 'manager', ctx, {
    extraTools: Object.values(MANAGER_TOOLS),
    color: 'accent',
  })
  fleet.update()
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
  const { manager, fleet, batcher } = requiredRuntime()
  batcher.clear()
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
    description: `List all background workers with their status, don't use tool call to waiting workers finished just idle`,
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
        const end = worker.completedAt ?? Date.now()
        const elapsed = `${Math.max(0, Math.round((end - worker.startedAt) / 1000))}s`
        lines.push(
          `${worker.status} #${worker.id} ${truncateToWidth(worker.title, 30)} ${elapsed}`,
        )
      }
      return {
        content: [{ type: 'text', text: lines.join('\n') }],
        details: {},
      }
    },
  })

  pi.registerTool({
    name: MANAGER_TOOLS.delegate,
    label: 'Delegate Worker',
    description: `Delegate task to background with full tool access. The tool returns immediately with a worker id; the worker's summary when it finishes. Max concurrency ${MAX_CONCURRENCY_WORKER} running workers`,
    parameters: Type.Object({
      title: Type.String(),
      requirements: Type.String({
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
        worker = await manager.spawn(params.title, params.requirements, {
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
            text: `Worker id #${worker.id} background. Received summary when it finishes.`,
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

function doneMessage(worker: LiveWorker): string {
  return `Worker #${worker.id} work done.\n\n<message>\n${worker.message ?? '(no message)'}\n</message>`
}

export async function setupManager(
  pi: ExtensionAPI,
  state: ModesState,
): Promise<void> {
  const batcher = new CompletionBatcher((workers) => {
    if (state.mode !== 'manager') return
    pi.sendUserMessage(workers.map(doneMessage).join('\n\n'), {
      deliverAs: 'steer',
    })
  })
  const manager = new WorkerManager({
    onStatusChange: () => runtime?.fleet.update(),
    onDone: (worker) => {
      if (state.mode !== 'manager') return
      batcher.add(worker)
    },
  })
  const fleet = new FleetList({
    list: () => runtime?.demoManager?.list() ?? manager.list(),
    onOpen: async (ctx, id) => {
      const activeManager = runtime?.demoManager ?? manager
      return openWorkerViewer(ctx, activeManager, id)
    },
  })
  runtime = { manager, demoManager: undefined, fleet, batcher }

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
        runtime.demoManager ??= new DemoWorkerManager()
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
        runtime.demoManager = new DemoWorkerManager()
        fleet.update()
        ctx.ui.notify(
          'Demo mode active: fake workers loaded. Use /workers demo to exit.',
          'info',
        )
      }
    },
  })
}
