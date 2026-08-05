import type {
  ExtensionAPI,
  ExtensionContext,
} from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'

import { DemoWorkerManager } from './demo-worker-manager.js'
import { FleetList } from './fleet-list.js'
import { MANAGER_TOOLS, type ModesState, persist } from './helper.js'
import {
  applyModeSetup,
  assertModeIdle,
  exitReadOnly,
} from './mode-switcher.js'
import { getModelsConfig, resolveModelRef } from './models-config.js'
import { exitPlanMode } from './plan.js'
import { readPrompt } from './prompts.js'
import { type LiveWorker, WorkerManager } from './worker-manager.js'
import { openWorkerViewer } from './worker-viewer.js'

export type { LiveWorker, WorkerStatus } from './worker-manager.js'

interface ManagerRuntime {
  manager: WorkerManager
  demoManager: DemoWorkerManager | undefined
  fleet: FleetList
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
  ensureManagerTools(pi, state, manager)
  fleet.setContext(ctx)
  await applyModeSetup(pi, state, 'manager', ctx, {
    extraTools: Object.values(MANAGER_TOOLS),
    color: 'accent',
    render: () => {
      fleet.update()
      ctx.ui.setWidget('manager-mode', [
        ctx.ui.theme.fg(
          'accent',
          ctx.ui.theme.bold('👥 MANAGER MODE — read-only'),
        ),
      ])
    },
  })
}

export async function exitManagerMode(
  pi: ExtensionAPI,
  state: ModesState,
  ctx: ExtensionContext,
): Promise<void> {
  const { manager, fleet } = requiredRuntime()
  state.mode = undefined
  fleet.dispose()
  manager.disposeAll()
  ctx.ui.setWidget('manager-mode', undefined)
  await exitReadOnly(pi, state, ctx, 'manager', { restoreModel: true })
}

function ensureManagerTools(
  pi: ExtensionAPI,
  state: ModesState,
  workers: WorkerManager,
): void {
  if (managerToolsRegistered) return
  managerToolsRegistered = true

  pi.registerTool({
    name: MANAGER_TOOLS.list,
    label: 'List Workers',
    description: 'List all background workers with their status',
    promptSnippet: 'Check status of all background workers',
    parameters: Type.Object({}),
    async execute() {
      const allWorkers = workers.list()
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
        lines.push(`${worker.status} #${worker.id} ${worker.text} ${elapsed}`)
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
    description: `Delegate task to background with full tool access. The tool returns immediately with a worker id; the worker's summary when it finishes`,
    promptSnippet: 'Delegate task to background worker with full tool access',
    promptGuidelines: [
      `Use ${MANAGER_TOOLS.delegate} to execute task through background worker`,
    ],
    parameters: Type.Object({
      task: Type.String({
        description:
          'A self-contained description of the work the worker should do.',
      }),
      followupOf: Type.Optional(
        Type.Number({
          description: 'Worker id to follow up. Omit for a fresh task.',
        }),
      ),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const workerRef = getModelsConfig().worker
      const workerModel = workerRef
        ? (resolveModelRef(ctx, workerRef) ?? ctx.model)
        : ctx.model
      const worker = await workers.spawn(params.task, {
        cwd: ctx.cwd,
        model: workerModel,
        thinkingLevel: ctx.thinkingLevel,
        tools: state.toolsBackup,
        systemPrompt: await readPrompt('worker'),
        followupOf: params.followupOf,
      })

      if (signal) {
        const stop = (): void => {
          void workers.abort(worker.id)
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
}

function doneMessage(worker: LiveWorker): string {
  const label =
    worker.status === 'failed'
      ? 'failed'
      : worker.status === 'stopped'
        ? 'stopped'
        : 'finished'
  return `Worker #${worker.id} (${worker.text}) ${label}.\n\n<summary>\n${worker.summary ?? '(no summary)'}\n</summary>`
}

export async function setupManager(
  pi: ExtensionAPI,
  state: ModesState,
): Promise<void> {
  const manager = new WorkerManager({
    onStatusChange: () => runtime?.fleet.update(),
    onDone: (worker) => {
      if (state.mode !== 'manager') return
      pi.sendUserMessage(doneMessage(worker), { deliverAs: 'followUp' })
    },
  })
  const fleet = new FleetList({
    list: () => runtime?.demoManager?.list() ?? manager.list(),
    onOpen: async (ctx, id) => {
      const activeManager = runtime?.demoManager ?? manager
      return openWorkerViewer(ctx, activeManager, id)
    },
  })
  runtime = { manager, demoManager: undefined, fleet }

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
