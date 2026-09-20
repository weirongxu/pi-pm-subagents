import type {
  ExtensionAPI,
  ExtensionContext,
} from '@earendil-works/pi-coding-agent'
import { describe, expect, it, vi } from 'vitest'

import type * as PmModeModule from '../pm-mode.js'
import type * as ManagerModule from '../subagent/manager.js'
import type { LiveSubagent, SubagentManager } from '../subagent/manager.js'
import type { PmSubagentState, SubagentRecord } from '../types.js'
import { PLUGIN_KEY, createState } from '../utils/state.js'

vi.mock('../models-config/models-config.js', () => ({
  getPmSubagentsConfig: () => ({}),
}))

vi.mock('../pm-mode.js', async (importOriginal) => {
  const actual = await importOriginal<typeof PmModeModule>()
  return {
    applyModeFor: vi.fn(async () => {}),
    assertModeIdle: vi.fn(),
    // Real exitModeFor persists on exit; mirror that without tool/model restore.
    exitModeFor: vi.fn(async (_pi: ExtensionAPI, state: PmSubagentState) => {
      const { persist } = await import('../utils/state.js')
      persist(_pi, state)
    }),
    restoreModel: actual.restoreModel,
  }
})

vi.mock('../prompts/roles.js', () => ({
  loadRoles: vi.fn(async () => {}),
}))

vi.mock('../subagent/tools.js', () => ({
  registerSubagentTools: vi.fn(),
  SUBAGENT_TOOLS: {
    delegate: 'subagent_delegate',
    steer: 'subagent_steer',
    kill: 'subagent_kill',
    list: 'subagent_list',
  },
}))

const activityReporterStops = vi.hoisted(
  () => [] as Array<ReturnType<typeof vi.fn>>,
)

vi.mock('../subagent/activity.js', () => ({
  ActivityReporter: class {
    start = vi.fn()
    stop = vi.fn()
    constructor() {
      activityReporterStops.push(this.stop)
    }
  },
}))

vi.mock('../subagent/fleet.js', () => ({
  FleetList: class {
    setContext(): void {}
    update(): void {}
    dispose(): void {}
  },
}))

const managerInstances: SubagentManager[] = []

vi.mock('../subagent/manager.js', async (importOriginal) => {
  const actual = await importOriginal<typeof ManagerModule>()
  return {
    ...actual,
    SubagentManager: class extends actual.SubagentManager {
      constructor(
        ...args: ConstructorParameters<typeof actual.SubagentManager>
      ) {
        super(...args)
        managerInstances.push(this)
      }
    },
  }
})

import { exitCoordinatorMode, setupCoordinator } from './coordinator.js'
import { requiredRuntime } from './runtime.js'

type AnyHandler = (event: never, ctx: ExtensionContext) => unknown

function makePi() {
  const handlers: Record<string, AnyHandler> = {}
  const appendEntry = vi.fn()
  const emit = vi.fn()
  const sendMessage = vi.fn()
  const pi = {
    on: (event: string, handler: AnyHandler) => {
      handlers[event] = handler
    },
    registerCommand: () => {},
    appendEntry,
    events: { emit },
    sendMessage,
  } as unknown as ExtensionAPI
  return { handlers, appendEntry, emit, sendMessage, pi }
}

function makeCtx(): ExtensionContext {
  return {
    ui: { setWidget: vi.fn(), notify: vi.fn() },
  } as unknown as ExtensionContext
}

function makeRecord(overrides: Partial<SubagentRecord>): SubagentRecord {
  return {
    id: 1,
    title: 'Task 1',
    prompt: 'Do task 1',
    status: 'done',
    startedAt: Date.now() - 1000,
    steerCount: 0,
    activeTools: [],
    role: 'worker',
    cwd: '/tmp/proj',
    sessionFile: '/tmp/proj/sessions/x.jsonl',
    previousEntries: [],
    ...overrides,
  }
}

function seedRecord(manager: SubagentManager, record: SubagentRecord): void {
  const subagents = (
    manager as unknown as { subagents: Map<number, LiveSubagent> }
  ).subagents
  subagents.set(record.id, {
    record,
    session: { dispose: () => {} } as unknown as LiveSubagent['session'],
  })
}

function lastPersistedData(appendEntry: ReturnType<typeof vi.fn>) {
  const calls = appendEntry.mock.calls.filter((call) => call[0] === PLUGIN_KEY)
  const last = calls[calls.length - 1]
  return last?.[1] as { mode?: string; subagents?: SubagentRecord[] }
}

async function makeSetup() {
  managerInstances.length = 0
  const { handlers, appendEntry, emit, sendMessage, pi } = makePi()
  const state: PmSubagentState = { ...createState(), mode: 'coordinator' }
  await setupCoordinator(pi, state, {
    demoEnabled: false,
    coordinatorDefinition: { fm: {}, systemPrompt: '' },
  })
  const manager = managerInstances[0]
  if (!manager) throw new Error('SubagentManager was not constructed')
  return { handlers, appendEntry, emit, sendMessage, pi, state, manager }
}

describe('exitCoordinatorMode', () => {
  it('disposes running records, clears state.subagents, persists without a roster', async () => {
    const { appendEntry, emit, pi, state, manager } = await makeSetup()
    seedRecord(manager, makeRecord({ id: 1, status: 'running' }))

    await exitCoordinatorMode(pi, state, makeCtx())

    expect(state.mode).toBeUndefined()
    expect(state.subagents).toBeUndefined()
    expect(manager.list()).toHaveLength(0)
    expect(emit).toHaveBeenCalledWith(
      'pi-notify:job:end',
      expect.objectContaining({ id: 'pi-pm-subagents:session:1' }),
    )
    const data = lastPersistedData(appendEntry)
    expect(data.mode).toBeUndefined()
    expect(data.subagents).toBeUndefined()
  })
})

describe('message batcher delivery', () => {
  function makeBatcherSubagent(
    overrides: Partial<SubagentRecord>,
  ): LiveSubagent {
    return {
      record: makeRecord({
        status: 'done',
        contextUsage: { tokens: 60000, contextWindow: 200000, percent: 30 },
        ...overrides,
      }),
      session: { dispose: () => {} },
    } as unknown as LiveSubagent
  }

  it('delivers steer-only batches without triggering a turn', async () => {
    const { sendMessage } = await makeSetup()
    const { batcher } = requiredRuntime()
    batcher.add(
      makeBatcherSubagent({ id: 1, status: 'running' }),
      'steer',
      'Focus on auth',
    )

    batcher.flushNow()

    expect(sendMessage).toHaveBeenCalledTimes(1)
    const steerCall = sendMessage.mock.calls[0]
    expect(steerCall).toBeDefined()
    expect(steerCall?.[0]?.content).toContain('<subagent-steer>')
    expect(steerCall?.[1]).toEqual({ deliverAs: 'steer', triggerTurn: false })
  })

  it('splits steer and done items into separate deliveries on flushNow', async () => {
    const { sendMessage } = await makeSetup()
    const { batcher } = requiredRuntime()
    batcher.add(
      makeBatcherSubagent({ id: 1, status: 'running' }),
      'steer',
      'Focus on auth',
    )
    batcher.add(makeBatcherSubagent({ id: 2 }), 'done', 'Task completed')

    batcher.flushNow()

    expect(sendMessage).toHaveBeenCalledTimes(2)

    const steerCall = sendMessage.mock.calls[0]
    expect(steerCall).toBeDefined()
    expect(steerCall?.[0]?.content).toContain('<subagent-steer>')
    expect(steerCall?.[1]).toEqual({ deliverAs: 'steer', triggerTurn: false })

    const doneCall = sendMessage.mock.calls[1]
    expect(doneCall).toBeDefined()
    expect(doneCall?.[0]?.content).toContain('<subagent-done>')
    expect(doneCall?.[1]).toEqual({ deliverAs: 'steer', triggerTurn: true })
  })
})
