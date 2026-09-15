import type {
  ExtensionAPI,
  ExtensionContext,
  SessionEntry,
} from '@earendil-works/pi-coding-agent'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { PmSubagentState } from './types.js'
import { createState, PLUGIN_KEY } from './utils/state.js'

const applyCoordinatorModeMock = vi.hoisted(() => vi.fn(async () => {}))

vi.mock('./coordinator/coordinator.js', () => ({
  applyCoordinatorMode: applyCoordinatorModeMock,
  enterCoordinatorMode: vi.fn(async () => {}),
}))

vi.mock('./models-config/models-config.js', () => ({
  getPmSubagentsConfig: () => ({}),
}))

import { requiredRuntime, setRuntime } from './coordinator/runtime.js'
import { setupSessionLifecycle } from './session-lifecycle.js'
import { SubagentManager } from './subagent/manager.js'

type SessionStartHandler = (
  event: { reason: 'startup' | 'reload' | 'new' | 'resume' | 'fork' },
  ctx: ExtensionContext,
) => Promise<void>

function makeSetup() {
  const handlers: Record<string, SessionStartHandler> = {}
  const appendEntry = vi.fn()
  const pi = {
    on: (event: string, handler: SessionStartHandler) => {
      handlers[event] = handler
    },
    appendEntry,
  } as unknown as ExtensionAPI
  const state: PmSubagentState = createState()
  setupSessionLifecycle(pi, state, { fm: {}, systemPrompt: '' })

  const runSessionStart = async (
    entry: SessionEntry | undefined,
    reason: 'startup' | 'reload' | 'new' | 'resume' | 'fork' = 'startup',
  ): Promise<void> => {
    const handler = handlers['session_start']
    if (!handler) throw new Error('session_start handler not registered')
    await handler({ reason }, {
      sessionManager: { getEntries: () => (entry ? [entry] : []) },
    } as unknown as ExtensionContext)
  }

  return { runSessionStart, state, appendEntry, handlers }
}

function makeShutdownRuntime(state: PmSubagentState) {
  const manager = new SubagentManager({ state })
  const disposeAll = vi.spyOn(manager, 'disposeAll')
  const fleet = { dispose: vi.fn() }
  const batcher = { clear: vi.fn() }
  const activityReporter = { stop: vi.fn() }
  setRuntime({
    manager,
    activityReporter,
    demoSubagentManager: undefined,
    fleet,
    batcher,
  } as unknown as Parameters<typeof setRuntime>[0])
  return { manager, disposeAll, fleet, batcher, activityReporter }
}

function runShutdown(handlers: Record<string, SessionStartHandler>): void {
  const handler = handlers['session_shutdown']
  if (!handler) throw new Error('session_shutdown handler not registered')
  void handler(
    { reason: 'startup' } as never,
    {} as unknown as ExtensionContext,
  )
}

function makeCustomEntry(data: Record<string, unknown>): SessionEntry {
  return {
    type: 'custom',
    customType: 'pm-subagents',
    data,
  } as unknown as SessionEntry
}

describe('setupSessionLifecycle session_start', () => {
  it('copies subagents into state when restoring coordinator mode', async () => {
    const { runSessionStart, state } = makeSetup()
    const subagents = [
      {
        id: 1,
        title: 'Task 1',
        status: 'done',
        cwd: '/tmp/p',
        sessionFile: '/tmp/p/s.jsonl',
      },
    ]
    applyCoordinatorModeMock.mockClear()

    await runSessionStart(
      makeCustomEntry({
        mode: 'coordinator',
        sessionSubagentModel: 'anthropic:claude-x',
        subagents,
      }),
    )

    expect(state.mode).toBe('coordinator')
    expect(state.subagents).toEqual(subagents)
    expect(applyCoordinatorModeMock).toHaveBeenCalledOnce()
  })

  it('clears subagents when the persisted mode is not coordinator', async () => {
    const { runSessionStart, state } = makeSetup()
    state.subagents = [{ id: 1 } as never]
    applyCoordinatorModeMock.mockClear()

    await runSessionStart(makeCustomEntry({ mode: undefined, subagents: [] }))

    expect(state.mode).toBeUndefined()
    expect(state.subagents).toBeUndefined()
    expect(applyCoordinatorModeMock).not.toHaveBeenCalled()
  })

  it.each(['resume', 'fork', 'reload', 'new'] as const)(
    'falls to default-mode path on empty session with %s',
    async (reason) => {
      const { runSessionStart, state } = makeSetup()
      applyCoordinatorModeMock.mockClear()

      await runSessionStart(undefined, reason)

      expect(state.mode).toBeUndefined()
      expect(state.subagents).toBeUndefined()
      expect(applyCoordinatorModeMock).not.toHaveBeenCalled()
    },
  )
})

describe('setupSessionLifecycle session_shutdown', () => {
  afterEach(() => {
    setRuntime(undefined)
  })

  it('persists the snapshot and tears down runtime in coordinator mode', () => {
    const { handlers, state, appendEntry } = makeSetup()
    const { disposeAll, fleet, batcher, activityReporter } =
      makeShutdownRuntime(state)
    state.mode = 'coordinator'

    runShutdown(handlers)

    expect(appendEntry).toHaveBeenCalledWith(
      PLUGIN_KEY,
      expect.objectContaining({ mode: 'coordinator', subagents: [] }),
    )
    expect(disposeAll).toHaveBeenCalledOnce()
    expect(batcher.clear).toHaveBeenCalledOnce()
    expect(activityReporter.stop).toHaveBeenCalledOnce()
    expect(fleet.dispose).toHaveBeenCalledOnce()
    expect(() => requiredRuntime()).toThrow()
  })

  it('skips coordinator teardown in non-coordinator mode', () => {
    const { handlers, state } = makeSetup()
    const { disposeAll, fleet, batcher, activityReporter } =
      makeShutdownRuntime(state)

    runShutdown(handlers)

    expect(disposeAll).not.toHaveBeenCalled()
    expect(batcher.clear).toHaveBeenCalledOnce()
    expect(activityReporter.stop).toHaveBeenCalledOnce()
    expect(fleet.dispose).toHaveBeenCalledOnce()
    expect(() => requiredRuntime()).toThrow()
    expect(state.mode).toBeUndefined()
  })

  it('does not throw when the runtime was never initialized', () => {
    const { handlers } = makeSetup()

    expect(() => {
      runShutdown(handlers)
    }).not.toThrow()
    expect(() => requiredRuntime()).toThrow()
  })
})
