import type * as PiCodingAgent from '@earendil-works/pi-coding-agent'
import type {
  AgentSession,
  ExtensionContext,
} from '@earendil-works/pi-coding-agent'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { setRuntime } from '../coordinator/runtime.js'
import type { SubagentRecord } from '../types.js'
import { createState } from '../utils/state.js'
import { SubagentManager } from './manager.js'
import { restoreSubagents } from './restore.js'

const openMock = vi.hoisted(() => vi.fn(() => ({})))

vi.mock('@earendil-works/pi-coding-agent', async (importOriginal) => {
  const actual = await importOriginal<typeof PiCodingAgent>()
  return {
    ...actual,
    SessionManager: Object.assign(Object(actual.SessionManager), {
      open: openMock,
    }),
    createAgentSession: vi.fn().mockResolvedValue({
      session: {
        messages: [],
        dispose: () => {},
        abort: async () => {},
        steer: async () => {},
        subscribe: () => () => {},
        prompt: async () => {},
        getContextUsage: () => undefined,
      } satisfies Partial<AgentSession>,
    }),
    DefaultResourceLoader: class {
      async reload(): Promise<void> {}
    },
  }
})

vi.mock('./spawn-options.js', () => ({
  buildSpawnOptions: () => ({
    systemPrompt: 'sp',
    onComplete: async () => {},
  }),
}))

function makeRecord(overrides: Partial<SubagentRecord> = {}): SubagentRecord {
  return {
    id: 1,
    title: 'Task 1',
    prompt: 'Do task 1',
    status: 'done',
    startedAt: Date.now() - 1000,
    completedAt: Date.now(),
    followUpCount: 0,
    activeTools: [],
    role: 'unknown-role',
    cwd: '/tmp/proj',
    sessionFile: '/tmp/proj/sessions/x.jsonl',
    previousEntries: [],
    ...overrides,
  }
}

function makeCtx(notify: ReturnType<typeof vi.fn>): ExtensionContext {
  return { ui: { notify } } as unknown as ExtensionContext
}

function makeRuntime(manager: SubagentManager): void {
  setRuntime({
    manager,
    activityReporter: { start: () => {}, stop: () => {} } as never,
    demoSubagentManager: undefined,
    fleet: {
      setContext: () => {},
      update: () => {},
      dispose: () => {},
    } as never,
    batcher: { add: () => {} } as never,
  })
}

describe('restoreSubagents', () => {
  afterEach(() => {
    setRuntime(undefined)
  })

  it('restores records with unknown roles falling back to worker shape and notifies', async () => {
    const manager = new SubagentManager({ state: createState() })
    makeRuntime(manager)
    const notify = vi.fn()
    const restored = await restoreSubagents(
      {} as never,
      { ...createState(), mode: 'coordinator' as const },
      makeCtx(notify),
      [makeRecord()],
    )

    expect(restored).toBe(1)
    expect(manager.get(1)?.record.role).toBe('unknown-role')
    expect(manager.get(1)?.record.status).toBe('done')
    expect(openMock).toHaveBeenCalledWith(
      '/tmp/proj/sessions/x.jsonl',
      undefined,
      '/tmp/proj',
    )
    expect(notify).toHaveBeenCalledWith(
      'Subagent restore from previous session: restored 1',
      'info',
    )
  })

  it('skips records already live in the manager', async () => {
    const manager = new SubagentManager({ state: createState() })
    makeRuntime(manager)
    const notify = vi.fn()
    const ctx = makeCtx(notify)

    await restoreSubagents(
      {} as never,
      { ...createState(), mode: 'coordinator' as const },
      ctx,
      [makeRecord({ id: 1 })],
    )
    notify.mockClear()

    const restored = await restoreSubagents(
      {} as never,
      { ...createState(), mode: 'coordinator' as const },
      ctx,
      [makeRecord({ id: 1 })],
    )

    expect(restored).toBe(0)
    expect(notify).not.toHaveBeenCalled()
  })

  it('reports failed restores when the session file cannot be reopened', async () => {
    openMock.mockImplementation(() => {
      throw new Error('no such session file')
    })
    const manager = new SubagentManager({ state: createState() })
    makeRuntime(manager)
    const notify = vi.fn()

    const restored = await restoreSubagents(
      {} as never,
      { ...createState(), mode: 'coordinator' as const },
      makeCtx(notify),
      [makeRecord({ id: 5 })],
    )

    expect(restored).toBe(0)
    expect(notify).toHaveBeenCalledWith(
      'Subagent restore from previous session: failed 1',
      'warning',
    )
  })
})
