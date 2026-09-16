import type * as Fs from 'node:fs'

import type * as PiCodingAgent from '@earendil-works/pi-coding-agent'
import type {
  AgentSession,
  ContextUsage,
} from '@earendil-works/pi-coding-agent'
import { describe, expect, it, vi } from 'vitest'

import type { PmSubagentState } from '../types.js'
import { createState } from '../utils/state.js'
import type { SubagentManagerOptions } from './manager.js'
import { SubagentManager } from './manager.js'
import {
  formatSubagentSummary,
  type LiveSubagent,
  MAX_REUSE_STEERS,
} from './manager.js'

const openMock = vi.hoisted(() => vi.fn())
const createAgentSessionMock = vi.hoisted(() => vi.fn())
const mkdirMock = vi.hoisted(() => vi.fn())

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof Fs>()
  return { ...actual, mkdirSync: mkdirMock }
})

vi.mock('@earendil-works/pi-coding-agent', async (importOriginal) => {
  const actual = await importOriginal<typeof PiCodingAgent>()
  return {
    ...actual,
    SessionManager: Object.assign(Object(actual.SessionManager), {
      open: openMock,
    }),
    createAgentSession: createAgentSessionMock,
    DefaultResourceLoader: class {
      async reload(): Promise<void> {}
    },
  }
})

function makeManager(
  state: PmSubagentState = createState(),
  options: Omit<SubagentManagerOptions, 'state'> = {},
): SubagentManager {
  return new SubagentManager({ state, ...options })
}

function mockOpenSession(): void {
  openMock.mockImplementation(() => ({}))
  createAgentSessionMock.mockResolvedValue({
    session: makeStubSession().session,
  })
  mkdirMock.mockImplementation(() => undefined)
}

type StubSession = Pick<
  AgentSession,
  | 'dispose'
  | 'abort'
  | 'steer'
  | 'subscribe'
  | 'prompt'
  | 'getContextUsage'
  | 'sessionFile'
> & { messages: AgentSession['messages'] }

function makeStubSession(contextUsage?: ContextUsage): {
  session: StubSession
  steerMock: ReturnType<typeof vi.fn>
  promptMock: ReturnType<typeof vi.fn>
  abortMock: ReturnType<typeof vi.fn>
} {
  const steerMock = vi.fn().mockResolvedValue(undefined)
  const promptMock = vi.fn().mockResolvedValue(undefined)
  const abortMock = vi.fn().mockResolvedValue(undefined)

  const session: StubSession = {
    messages: [],
    dispose: () => {},
    abort: abortMock,
    steer: steerMock,
    subscribe: () => () => {},
    prompt: promptMock,
    getContextUsage: vi.fn().mockReturnValue(contextUsage),
    sessionFile: '/tmp/proj/sessions/x.jsonl',
  }

  return { session, steerMock, promptMock, abortMock }
}

function registerSubagent(
  manager: SubagentManager,
  session: StubSession,
  overrides: Partial<{
    id: number
    status: 'running' | 'done' | 'failed' | 'killed'
    steerCount: number
  }> = {},
): LiveSubagent {
  const id = overrides.id ?? 1
  const status = overrides.status ?? 'done'
  const steerCount = overrides.steerCount ?? 0

  const subagent: LiveSubagent = {
    record: {
      id,
      title: `Task ${id}`,
      previousEntries: [],
      prompt: `Do task ${id}`,
      status,
      startedAt: Date.now() - 1000,
      completedAt: status !== 'running' ? Date.now() : undefined,
      steerCount,
      activeTools: [],
      role: 'worker',
      cwd: '/tmp/proj',
      sessionFile: '/tmp/proj/sessions/x.jsonl',
    },
    session: session as unknown as AgentSession,
  }

  ;(
    manager as unknown as { subagents: Map<number, LiveSubagent> }
  ).subagents.set(id, subagent)
  return subagent
}

describe('formatSubagentSummary', () => {
  it('renders context usage between title and follow symbol', () => {
    const { session } = makeStubSession()
    const manager = makeManager()
    const subagent = registerSubagent(manager, session, {
      id: 1,
      status: 'done',
      steerCount: 2,
    })
    subagent.record.contextUsage = {
      tokens: 60000,
      contextWindow: 200000,
      percent: 30,
    }

    const summary = formatSubagentSummary(subagent, 80)

    expect(summary).toBe('done #1 Task 1 60k/200k ⟳ 2 1s')
  })

  it('renders ? when tokens is null', () => {
    const { session } = makeStubSession()
    const manager = makeManager()
    const subagent = registerSubagent(manager, session, { id: 1 })
    subagent.record.contextUsage = {
      tokens: null,
      contextWindow: 200000,
      percent: null,
    }

    expect(formatSubagentSummary(subagent, 80)).toContain(' Task 1 ? ')
  })

  it('renders ? when contextUsage is undefined', () => {
    const { session } = makeStubSession()
    const manager = makeManager()
    const subagent = registerSubagent(manager, session, { id: 1 })

    expect(formatSubagentSummary(subagent, 80)).toContain(' Task 1 ? ')
  })
})

describe('SubagentManager.steer', () => {
  it('throws when subagent id does not exist', async () => {
    const manager = makeManager()
    await expect(manager.steer(99, 'task')).rejects.toThrow(
      'Subagent #99 not found',
    )
  })

  it(`throws without archiving or renaming when budget is exhausted`, async () => {
    const { session, steerMock, promptMock } = makeStubSession()
    const manager = makeManager()
    const subagent = registerSubagent(manager, session, {
      id: 1,
      status: 'done',
      steerCount: MAX_REUSE_STEERS,
    })

    await expect(
      manager.steer(1, 'task', { title: 'New Title' }),
    ).rejects.toThrow(
      `Subagent #1 steer budget exhausted (${MAX_REUSE_STEERS}/${MAX_REUSE_STEERS}). Start a fresh subagent instead.`,
    )

    expect(subagent.record.previousEntries).toEqual([])
    expect(subagent.record.title).toBe('Task 1')
    expect(steerMock).not.toHaveBeenCalled()
    expect(promptMock).not.toHaveBeenCalled()
  })

  it('archives the old title and renames when a title is given (running)', async () => {
    const { session, steerMock } = makeStubSession()
    const manager = makeManager()
    const subagent = registerSubagent(manager, session, {
      id: 1,
      status: 'running',
      steerCount: 2,
    })
    const startedAt = Date.now() - 5000
    subagent.record.startedAt = startedAt

    await manager.steer(1, 'New Task', { title: 'New Title' })

    expect(subagent.record.title).toBe('New Title')
    expect(subagent.record.prompt).toBe('New Task')
    expect(subagent.record.steerCount).toBe(3)
    expect(subagent.record.previousEntries).toHaveLength(1)
    expect(subagent.record.previousEntries[0]).toMatchObject({
      title: 'Task 1',
      status: 'done',
      steerCount: 2,
      startedAt,
    })
    expect(subagent.record.previousEntries[0]?.completedAt).toBeGreaterThan(0)
    expect(steerMock).toHaveBeenCalledWith('New Task')
  })

  it('archives idle status and keeps completedAt when a title is given', async () => {
    const { session, promptMock } = makeStubSession()
    const manager = makeManager()
    const subagent = registerSubagent(manager, session, {
      id: 1,
      status: 'failed',
    })
    const completedAt = Date.now() - 1000
    subagent.record.completedAt = completedAt
    promptMock.mockResolvedValue(undefined)

    await manager.steer(1, 'task', { title: 'New Title' })

    expect(subagent.record.previousEntries[0]).toMatchObject({
      status: 'failed',
      completedAt,
    })
  })

  it('does not archive or rename when no title is given', async () => {
    const { session, steerMock } = makeStubSession()
    const manager = makeManager()
    const subagent = registerSubagent(manager, session, {
      id: 1,
      status: 'running',
      steerCount: 3,
    })

    await manager.steer(1, 'New Task')

    expect(subagent.record.title).toBe('Task 1')
    expect(subagent.record.previousEntries).toEqual([])
    expect(subagent.record.prompt).toBe('New Task')
    expect(subagent.record.steerCount).toBe(4)
    expect(steerMock).toHaveBeenCalledWith('New Task')
  })

  it('steers a running subagent without restarting', async () => {
    const { session, steerMock, promptMock } = makeStubSession()
    const onStartMock = vi.fn()
    const manager = makeManager(undefined, { onEachStart: onStartMock })
    registerSubagent(manager, session, {
      id: 1,
      status: 'running',
      steerCount: 0,
    })

    const result = await manager.steer(1, 'New Task')

    expect(result.record.id).toBe(1)
    expect(result.record.status).toBe('running')
    expect(result.record.prompt).toBe('New Task')
    expect(result.record.steerCount).toBe(1)
    expect(steerMock).toHaveBeenCalledWith('New Task')
    expect(promptMock).not.toHaveBeenCalled()
    expect(onStartMock).not.toHaveBeenCalled()
  })

  it('restarts an idle subagent via run + onEachStart', async () => {
    const { session, promptMock } = makeStubSession()
    const onStartMock = vi.fn()
    const onChangedMock = vi.fn()
    const manager = makeManager(undefined, {
      onEachStart: onStartMock,
      onChanged: onChangedMock,
    })
    registerSubagent(manager, session, {
      id: 1,
      status: 'done',
      steerCount: 0,
    })
    promptMock.mockReturnValue(new Promise(() => {}))

    const result = await manager.steer(1, 'New Task')

    expect(result.record.status).toBe('running')
    expect(result.record.prompt).toBe('New Task')
    expect(result.record.steerCount).toBe(1)
    expect(result.record.startedAt).toBeGreaterThan(0)
    expect(result.record.completedAt).toBeUndefined()
    expect(promptMock).toHaveBeenCalledWith('New Task')
    expect(onStartMock).toHaveBeenCalledOnce()
    expect(onChangedMock).toHaveBeenCalled()
  })
})

describe('SubagentManager.steer composition', () => {
  it('accumulates previous titles with full metadata on each steer', async () => {
    const { session, promptMock } = makeStubSession()
    const manager = makeManager()
    const subagent = registerSubagent(manager, session, {
      id: 1,
      status: 'done',
      steerCount: 0,
    })
    promptMock.mockResolvedValue(undefined)

    for (const [title, task] of [
      ['Title 1', 'task 1'],
      ['Title 2', 'task 2'],
      ['Title 3', 'task 3'],
    ] as const) {
      await manager.steer(1, task, { title })
    }

    expect(subagent.record.previousEntries).toHaveLength(3)
    expect(subagent.record.previousEntries[0]).toMatchObject({
      title: 'Title 2',
      status: 'done',
      steerCount: 2,
    })
    expect(subagent.record.previousEntries[1]).toMatchObject({
      title: 'Title 1',
      status: 'done',
      steerCount: 1,
    })
    expect(subagent.record.previousEntries[2]).toMatchObject({
      title: 'Task 1',
      status: 'done',
      steerCount: 0,
    })
    expect(subagent.record.title).toBe('Title 3')
  })

  it('records contextUsage in the previous entry on steer', async () => {
    const contextUsage: ContextUsage = {
      tokens: 50000,
      contextWindow: 200000,
      percent: 25.0,
    }
    const { session } = makeStubSession()
    const manager = makeManager()
    const subagent = registerSubagent(manager, session, {
      id: 1,
      status: 'done',
      steerCount: 0,
    })
    subagent.record.contextUsage = contextUsage

    await manager.steer(1, 'task 2', { title: 'Title 2' })

    expect(subagent.record.previousEntries[0]).toMatchObject({
      title: 'Task 1',
      contextUsage,
    })
  })

  it('records contextUsage in the previous entry when steering a running subagent', async () => {
    const contextUsage: ContextUsage = {
      tokens: 80000,
      contextWindow: 200000,
      percent: 40.0,
    }
    const { session, steerMock } = makeStubSession()
    const manager = makeManager()
    const subagent = registerSubagent(manager, session, {
      id: 1,
      status: 'running',
      steerCount: 0,
    })
    subagent.record.contextUsage = contextUsage

    await manager.steer(1, 'more work', { title: 'New Title' })

    expect(subagent.record.previousEntries[0]).toMatchObject({
      status: 'done',
      contextUsage,
    })
    expect(steerMock).toHaveBeenCalled()
  })
})

describe('SubagentManager subscribe contextUsage', () => {
  it('initializes contextUsage on subscribe', () => {
    const contextUsage: ContextUsage = {
      tokens: 50000,
      contextWindow: 200000,
      percent: 25.0,
    }
    const { session } = makeStubSession(contextUsage)
    const manager = makeManager()
    const subagent = registerSubagent(manager, session, { id: 1 })

    expect(subagent.record.contextUsage).toBeUndefined()
    ;(manager as unknown as { subscribe: (s: LiveSubagent) => void }).subscribe(
      subagent,
    )

    expect(subagent.record.contextUsage).toEqual(contextUsage)
  })

  it('updates contextUsage on message_end event', () => {
    const initialUsage: ContextUsage = {
      tokens: 50000,
      contextWindow: 200000,
      percent: 25.0,
    }
    const updatedUsage: ContextUsage = {
      tokens: 100000,
      contextWindow: 200000,
      percent: 50.0,
    }

    const subscribeMock = vi.fn().mockReturnValue(() => {})
    const getContextUsageMock = vi.fn().mockReturnValue(initialUsage)

    const session = {
      messages: [],
      dispose: () => {},
      abort: vi.fn().mockResolvedValue(undefined),
      steer: vi.fn().mockResolvedValue(undefined),
      subscribe: subscribeMock,
      prompt: vi.fn().mockResolvedValue(undefined),
      getContextUsage: getContextUsageMock,
    } as unknown as StubSession

    const manager = makeManager()
    const subagent = registerSubagent(manager, session, { id: 1 })
    ;(manager as unknown as { subscribe: (s: LiveSubagent) => void }).subscribe(
      subagent,
    )

    expect(subagent.record.contextUsage).toEqual(initialUsage)

    getContextUsageMock.mockReturnValue(updatedUsage)
    const calls = subscribeMock.mock.calls
    expect(calls.length).toBeGreaterThan(0)
    const subscribeCallback = calls[0]?.[0]
    if (subscribeCallback) {
      subscribeCallback({ type: 'message_end', turnIndex: 0 })
    }

    expect(subagent.record.contextUsage).toEqual(updatedUsage)
  })
})

describe('SubagentManager.restore', () => {
  it('restores a record and marks running as killed', async () => {
    mockOpenSession()
    const manager = makeManager()
    const onComplete = vi.fn().mockResolvedValue(undefined)

    const ok = await manager.restore(
      {
        id: 7,
        title: 'Restored',
        prompt: 'Do it',
        status: 'running',
        startedAt: Date.now() - 1000,
        steerCount: 1,
        activeTools: ['read'],
        role: 'worker',
        cwd: '/tmp/proj',
        sessionFile: '/tmp/proj/sessions/x.jsonl',
        previousEntries: [],
      },
      { onComplete },
    )

    expect(ok).toBe('restored')
    const restored = manager.get(7)
    expect(restored).toBeDefined()
    expect(restored?.record.status).toBe('killed')
    expect(restored?.record.completedAt).toBeGreaterThan(0)
    expect(restored?.record.id).toBe(7)
    expect(openMock).toHaveBeenCalledWith(
      '/tmp/proj/sessions/x.jsonl',
      undefined,
      '/tmp/proj',
    )

    // No job-start side effects: onComplete is only stored, not invoked.
    expect(onComplete).not.toHaveBeenCalled()
  })

  it("returns 'already-live' when the id is already live", async () => {
    mockOpenSession()
    const { session } = makeStubSession()
    const manager = makeManager()
    registerSubagent(manager, session, { id: 1 })

    await expect(
      manager.restore({
        id: 1,
        title: 'T',
        prompt: 'p',
        status: 'done',
        startedAt: Date.now(),
        steerCount: 0,
        activeTools: [],
        role: 'worker',
        cwd: '/tmp/proj',
        sessionFile: '/tmp/proj/sessions/x.jsonl',
        previousEntries: [],
      }),
    ).resolves.toBe('already-live')
    expect(manager.list()).toHaveLength(1)
    expect(manager.get(1)?.record.title).toBe('Task 1')
  })

  it("returns 'failed' when the id is occupied by a different subagent", async () => {
    mockOpenSession()
    const { session } = makeStubSession()
    const manager = makeManager()
    registerSubagent(manager, session, { id: 1 })

    await expect(
      manager.restore({
        id: 1,
        title: 'Other session',
        prompt: 'p',
        status: 'done',
        startedAt: Date.now(),
        steerCount: 0,
        activeTools: [],
        role: 'worker',
        cwd: '/tmp/proj',
        sessionFile: '/tmp/proj/sessions/other.jsonl',
        previousEntries: [],
      }),
    ).resolves.toBe('failed')
    expect(manager.list()).toHaveLength(1)
    expect(manager.get(1)?.record.title).toBe('Task 1')
  })

  it("returns 'failed' when sessionFile is missing", async () => {
    const manager = makeManager()

    await expect(
      manager.restore({
        id: 2,
        title: 'T',
        prompt: 'p',
        status: 'done',
        startedAt: Date.now(),
        steerCount: 0,
        activeTools: [],
        role: 'worker',
        cwd: '/tmp/proj',
        sessionFile: '',
        previousEntries: [],
      }),
    ).resolves.toBe('failed')
  })

  it("returns 'failed' when reopening the session file fails", async () => {
    openMock.mockImplementation(() => {
      throw new Error('no such file')
    })
    const manager = makeManager()

    await expect(
      manager.restore({
        id: 3,
        title: 'T',
        prompt: 'p',
        status: 'done',
        startedAt: Date.now(),
        steerCount: 0,
        activeTools: [],
        role: 'worker',
        cwd: '/tmp/proj',
        sessionFile: '/missing/session.jsonl',
        previousEntries: [],
      }),
    ).resolves.toBe('failed')
    expect(manager.get(3)).toBeUndefined()
  })
})

describe('SubagentManager.disposeAll', () => {
  it('kills running records, fires onEachEnd, leaves done records untouched', async () => {
    const { session } = makeStubSession()
    const onEachEnd = vi.fn()
    const manager = makeManager(undefined, { onEachEnd })
    const running = registerSubagent(manager, session, {
      id: 1,
      status: 'running',
    })
    const done = registerSubagent(manager, session, { id: 2, status: 'done' })

    manager.disposeAll()

    expect(running.record.status).toBe('killed')
    expect(running.record.completedAt).toBeGreaterThan(0)
    expect(done.record.status).toBe('done')
    expect(onEachEnd).toHaveBeenCalledOnce()
    expect(onEachEnd).toHaveBeenCalledWith(running)
    // Records are cleared and sessions disposed.
    expect(manager.list()).toHaveLength(0)
    await expect(
      manager.restore({
        id: 9,
        title: 'T',
        prompt: 'p',
        status: 'done',
        startedAt: Date.now(),
        steerCount: 0,
        activeTools: [],
        role: 'worker',
        cwd: '/tmp/proj',
        sessionFile: '/tmp/proj/sessions/x.jsonl',
        previousEntries: [],
      }),
    ).resolves.toBe('failed')
  })
})

describe('SubagentManager.restore after dispose', () => {
  it("returns 'failed' and does not insert once disposed", async () => {
    mockOpenSession()
    const manager = makeManager()
    manager.disposeAll()

    const ok = await manager.restore({
      id: 4,
      title: 'T',
      prompt: 'p',
      status: 'done',
      startedAt: Date.now(),
      steerCount: 0,
      activeTools: [],
      role: 'worker',
      cwd: '/tmp/proj',
      sessionFile: '/tmp/proj/sessions/x.jsonl',
      previousEntries: [],
    })

    expect(ok).toBe('failed')
    expect(manager.get(4)).toBeUndefined()
  })
})

describe('SubagentManager.restore disposed during await', () => {
  it("returns 'failed' and disposes the freshly opened session", async () => {
    let resolveCreate: (value: { session: AgentSession }) => void = () => {}
    const disposeSpy = vi.fn()
    const deferredSession = {
      messages: [],
      dispose: disposeSpy,
      abort: vi.fn().mockResolvedValue(undefined),
      steer: vi.fn().mockResolvedValue(undefined),
      subscribe: vi.fn().mockReturnValue(() => {}),
      prompt: vi.fn().mockResolvedValue(undefined),
      getContextUsage: vi.fn().mockReturnValue(undefined),
    } as unknown as AgentSession
    openMock.mockImplementation(() => ({}))
    createAgentSessionMock.mockReturnValue(
      new Promise<{ session: AgentSession }>((resolve) => {
        resolveCreate = resolve
      }),
    )
    const manager = makeManager()

    const pending = manager.restore({
      id: 8,
      title: 'T',
      prompt: 'p',
      status: 'done',
      startedAt: Date.now(),
      steerCount: 0,
      activeTools: [],
      role: 'worker',
      cwd: '/tmp/proj',
      sessionFile: '/tmp/proj/sessions/x.jsonl',
      previousEntries: [],
    })

    manager.disposeAll()
    resolveCreate({ session: deferredSession })

    await expect(pending).resolves.toBe('failed')
    expect(disposeSpy).toHaveBeenCalledOnce()
    expect(manager.get(8)).toBeUndefined()
  })
})

function restoredRecord(id: number, status: 'done' | 'running' = 'done') {
  return {
    id,
    title: `Restored ${id}`,
    prompt: 'Do it',
    status,
    startedAt: Date.now() - 1000,
    steerCount: 0,
    activeTools: [],
    role: 'worker' as const,
    cwd: '/tmp/proj',
    sessionFile: '/tmp/proj/sessions/x.jsonl',
    previousEntries: [],
  }
}

describe('SubagentManager id sequencing', () => {
  it('allocates from state.maxSubagentId and bumps it', async () => {
    mockOpenSession()
    const state: PmSubagentState = { ...createState(), maxSubagentId: 5 }
    const manager = makeManager(state)

    const created = await manager.createNewSubagent('T', 'p', {
      cwd: '/tmp/proj',
    })

    expect(created.record.id).toBe(6)
    expect(state.maxSubagentId).toBe(6)
  })

  it('restore leaves the id counter untouched', async () => {
    mockOpenSession()
    const state: PmSubagentState = createState()
    const manager = makeManager(state)

    const ok = await manager.restore(restoredRecord(5))
    expect(ok).toBe('restored')
    expect(state.maxSubagentId).toBe(0)

    const created = await manager.createNewSubagent('T', 'p', {
      cwd: '/tmp/proj',
    })
    expect(created.record.id).toBe(1)
  })
})
