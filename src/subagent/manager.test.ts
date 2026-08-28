import type { AgentSession } from '@earendil-works/pi-coding-agent'
import { describe, expect, it, vi } from 'vitest'

import { type LiveSubagent, SubagentManager } from './manager.js'

type StubSession = Pick<
  AgentSession,
  'dispose' | 'abort' | 'steer' | 'subscribe' | 'prompt'
> & { messages: AgentSession['messages'] }

function makeStubSession(): {
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
  }

  return { session, steerMock, promptMock, abortMock }
}

function registerSubagent(
  manager: SubagentManager,
  session: StubSession,
  overrides: Partial<{
    id: number
    status: 'running' | 'done' | 'failed' | 'killed'
    followUpCount: number
  }> = {},
): LiveSubagent {
  const id = overrides.id ?? 1
  const status = overrides.status ?? 'done'
  const followUpCount = overrides.followUpCount ?? 0

  const subagent: LiveSubagent = {
    id,
    title: `Task ${id}`,
    previousEntries: [],
    prompt: `Do task ${id}`,
    status,
    session: session as unknown as AgentSession,
    startedAt: Date.now() - 1000,
    completedAt: status !== 'running' ? Date.now() : undefined,
    message: status !== 'running' ? 'done' : undefined,
    followUpCount,
    enabledTools: new Set<string>(),
    role: 'worker',
  }

  ;(
    manager as unknown as { subagents: Map<number, LiveSubagent> }
  ).subagents.set(id, subagent)
  return subagent
}

describe('SubagentManager.followup', () => {
  describe('subagent not found', () => {
    it('throws when subagent id does not exist', async () => {
      const manager = new SubagentManager()
      await expect(manager.followup(99, 'title', 'task')).rejects.toThrow(
        'Subagent #99 not found',
      )
    })
  })

  describe('done subagent followup (regression)', () => {
    it('calls run, onStart, resets fields, increments followUpCount', async () => {
      const { session, promptMock } = makeStubSession()
      const onStartMock = vi.fn()
      const onStatusChangeMock = vi.fn()
      const manager = new SubagentManager({
        onStart: onStartMock,
        onStatusChange: onStatusChangeMock,
      })

      registerSubagent(manager, session, {
        id: 1,
        status: 'done',
        followUpCount: 0,
      })
      promptMock.mockReturnValue(new Promise(() => {}))

      const result = await manager.followup(1, 'New Title', 'New Task')

      expect(result.id).toBe(1)
      expect(result.status).toBe('running')
      expect(result.title).toBe('New Title')
      expect(result.prompt).toBe('New Task')
      expect(result.followUpCount).toBe(1)
      expect(result.startedAt).toBeGreaterThan(0)
      expect(result.completedAt).toBeUndefined()
      expect(result.message).toBeUndefined()
      expect(onStartMock).toHaveBeenCalledOnce()
      expect(onStatusChangeMock).toHaveBeenCalled()
      expect(promptMock).toHaveBeenCalledOnce()
    })

    it('throws when followUpCount reaches MAX_REUSE_FOLLOWUPS (10)', async () => {
      const { session } = makeStubSession()
      const manager = new SubagentManager()
      registerSubagent(manager, session, {
        id: 1,
        status: 'done',
        followUpCount: 10,
      })

      await expect(manager.followup(1, 'title', 'task')).rejects.toThrow(
        'Subagent #1 follow-up budget exhausted (10/10). Start a fresh subagent instead.',
      )

      expect(session.prompt).not.toHaveBeenCalled()
    })
  })

  describe('running subagent followup (steer)', () => {
    it('calls session.steer with prefixed task text', async () => {
      const { session, steerMock, promptMock } = makeStubSession()
      const onStartMock = vi.fn()
      const onStatusChangeMock = vi.fn()
      const manager = new SubagentManager({
        onStart: onStartMock,
        onStatusChange: onStatusChangeMock,
      })

      registerSubagent(manager, session, {
        id: 1,
        status: 'running',
        followUpCount: 0,
      })

      const result = await manager.followup(1, 'New Title', 'New Task')

      expect(result.id).toBe(1)
      expect(result.status).toBe('running')
      expect(result.title).toBe('New Title')
      expect(result.prompt).toBe('New Task')
      expect(result.followUpCount).toBe(1)
      expect(steerMock).toHaveBeenCalledOnce()
      expect(steerMock).toHaveBeenCalledWith('New Task')
      expect(promptMock).not.toHaveBeenCalled()
      expect(onStartMock).not.toHaveBeenCalled()
    })

    it('does not reset startedAt / completedAt / message', async () => {
      const { session, steerMock } = makeStubSession()
      const manager = new SubagentManager()
      const subagent = registerSubagent(manager, session, {
        id: 1,
        status: 'running',
        followUpCount: 0,
      })
      const originalStartedAt = Date.now() - 5000
      subagent.startedAt = originalStartedAt

      await manager.followup(1, 'title', 'task')

      expect(steerMock).toHaveBeenCalled()
      expect(subagent.startedAt).toBe(originalStartedAt)
      expect(subagent.completedAt).toBeUndefined()
      expect(subagent.message).toBeUndefined()
    })

    it('increments followUpCount each time', async () => {
      const { session, steerMock } = makeStubSession()
      const manager = new SubagentManager()
      registerSubagent(manager, session, {
        id: 1,
        status: 'running',
        followUpCount: 3,
      })

      await manager.followup(1, 't1', 'task 1')
      expect(steerMock).toHaveBeenCalledTimes(1)

      await manager.followup(1, 't2', 'task 2')
      expect(steerMock).toHaveBeenCalledTimes(2)

      const subagent = (
        manager as unknown as { subagents: Map<number, LiveSubagent> }
      ).subagents.get(1)
      expect(subagent?.followUpCount).toBe(5)
    })

    it('throws when followUpCount reaches MAX_REUSE_FOLLOWUPS (10)', async () => {
      const { session, steerMock } = makeStubSession()
      const manager = new SubagentManager()
      registerSubagent(manager, session, {
        id: 1,
        status: 'running',
        followUpCount: 10,
      })

      await expect(manager.followup(1, 'title', 'task')).rejects.toThrow(
        'Subagent #1 follow-up budget exhausted (10/10). Start a fresh subagent instead.',
      )

      expect(steerMock).not.toHaveBeenCalled()
    })

    it('saves previousEntry.status as done (not running)', async () => {
      const { session, steerMock } = makeStubSession()
      const manager = new SubagentManager()
      const subagent = registerSubagent(manager, session, {
        id: 1,
        status: 'running',
        followUpCount: 0,
      })

      await manager.followup(1, 'New Title', 'task')

      expect(steerMock).toHaveBeenCalled()
      expect(subagent.previousEntries).toHaveLength(1)
      expect(subagent.previousEntries[0]).toMatchObject({
        title: 'Task 1',
        status: 'done',
        followUpCount: 0,
      })
    })
  })

  describe('previousEntries accumulation', () => {
    it('accumulates previous titles with full metadata on each followup', async () => {
      const { session } = makeStubSession()
      const manager = new SubagentManager()
      const subagent = registerSubagent(manager, session, {
        id: 1,
        status: 'done',
        followUpCount: 0,
      })

      await manager.followup(1, 'Title 1', 'task 1')
      await manager.followup(1, 'Title 2', 'task 2')
      await manager.followup(1, 'Title 3', 'task 3')

      expect(subagent.previousEntries).toHaveLength(3)
      expect(subagent.previousEntries[0]).toMatchObject({
        title: 'Title 2',
        status: 'done',
        followUpCount: 2,
      })
      expect(subagent.previousEntries[1]).toMatchObject({
        title: 'Title 1',
        status: 'done',
        followUpCount: 1,
      })
      expect(subagent.previousEntries[2]).toMatchObject({
        title: 'Task 1',
        status: 'done',
        followUpCount: 0,
      })
      expect(subagent.title).toBe('Title 3')
    })

    it('does not modify previousEntries when followup budget exhausted', async () => {
      const { session } = makeStubSession()
      const manager = new SubagentManager()
      const subagent = registerSubagent(manager, session, {
        id: 1,
        status: 'done',
        followUpCount: 10,
      })

      await expect(manager.followup(1, 'New Title', 'task')).rejects.toThrow()

      expect(subagent.previousEntries).toEqual([])
      expect(subagent.title).toBe('Task 1')
    })
  })
})
