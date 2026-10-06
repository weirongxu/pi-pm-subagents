import type * as managerModule from './manager.js'
import {
  MessageBatcher,
  type SubagentBatchMessage,
  type SubagentNotification,
} from './batcher.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LiveSubagent } from './manager.js'

// Overridable hook so tests can stub the job summary rendering.
const jobOfMock = vi.hoisted(() => ({
  fn: undefined as undefined | ((subagent: LiveSubagent) => string),
}))

vi.mock('./manager.js', async (importOriginal) => {
  const actual = await importOriginal<typeof managerModule>()
  return {
    ...actual,
    formatSubagentSummary: (subagent: LiveSubagent) =>
      jobOfMock.fn
        ? jobOfMock.fn(subagent)
        : actual.formatSubagentSummary(subagent),
  }
})

const makeSubagent = (
  id: number,
  title: string,
  status: string,
): LiveSubagent =>
  ({
    record: {
      id,
      title,
      text: title,
      status: status as never,
      startedAt: Date.now() - 5000,
      steerCount: 0,
      activeTools: [],
    },
    session: { messages: [] as never },
  }) as unknown as LiveSubagent

// Test-only accessor for the private buffer to inspect queued items.
const bufferOf = (
  batcher: MessageBatcher,
): { silent: SubagentNotification[]; response: SubagentNotification[] } =>
  (
    batcher as unknown as {
      buffer: {
        silent: SubagentNotification[]
        response: SubagentNotification[]
      }
    }
  ).buffer

interface FlushedEntry {
  message: SubagentBatchMessage
  triggerTurn: boolean
}

const makeBatcher = (windowMs = 100) => {
  const flushed: FlushedEntry[] = []
  const batcher = new MessageBatcher(
    (message, triggerTurn) => flushed.push({ message, triggerTurn }),
    windowMs,
  )
  return { batcher, flushed }
}

describe('MessageBatcher', () => {
  afterEach(() => {
    vi.useRealTimers()
    jobOfMock.fn = undefined
  })

  it('flushes after batching window', () => {
    vi.useFakeTimers()
    const { batcher, flushed } = makeBatcher()
    const subagent = makeSubagent(1, 'task-1', 'done')
    subagent.record.contextUsage = {
      tokens: 60000,
      contextWindow: 200000,
      percent: 30,
    }

    batcher.add(subagent, 'done', 'Task completed')
    expect(bufferOf(batcher).response.length).toBe(1)

    vi.advanceTimersByTime(99)
    expect(flushed).toHaveLength(0)

    vi.advanceTimersByTime(1)
    expect(flushed).toHaveLength(1)
    const firstFlush = flushed[0]
    expect(firstFlush?.message.kind).toBe('done')
    expect(firstFlush?.message.jobs).toEqual([
      expect.stringContaining('done #1'),
    ])
    expect(firstFlush?.message.jobs[0]).toContain('60k/200k')
    expect(firstFlush?.message.content).toContain('**[done #1]**')
    expect(firstFlush?.message.content).toContain('Task completed')
    expect(firstFlush?.triggerTurn).toBe(true)
    expect(bufferOf(batcher).silent).toEqual([])
    expect(bufferOf(batcher).response).toEqual([])
  })

  it('joins multiple same-kind items into one content block', () => {
    vi.useFakeTimers()
    const { batcher, flushed } = makeBatcher()

    const subagent1 = makeSubagent(1, 'task-1', 'done')
    const subagent2 = makeSubagent(2, 'task-2', 'done')

    batcher.add(subagent1, 'done', 'Task 1 completed')
    vi.advanceTimersByTime(50)
    batcher.add(subagent2, 'done', 'Task 2 completed')
    vi.advanceTimersByTime(100)

    expect(flushed).toHaveLength(1)
    const firstFlush = flushed[0]
    expect(firstFlush?.message.kind).toBe('done')
    expect(firstFlush?.message.jobs).toEqual([
      expect.stringContaining('done #1'),
      expect.stringContaining('done #2'),
    ])
    expect(firstFlush?.message.content).toContain(
      '**[done #1]** task-1 ? ⟳ 0 5s\n\nTask 1 completed\n\n---\n\n**[done #2]** task-2 ? ⟳ 0 5s\n\nTask 2 completed',
    )
  })

  it('renders a degenerate job fallback without status and id', () => {
    vi.useFakeTimers()
    const { batcher, flushed } = makeBatcher()
    jobOfMock.fn = () => 'weird-job'

    batcher.add(makeSubagent(1, 'task-1', 'done'), 'done', 'Task completed')
    batcher.flushNow()

    expect(flushed[0]?.message.content).toBe(
      '**[weird-job]**\n\nTask completed',
    )
    expect(flushed[0]?.message.jobs).toEqual(['weird-job'])
  })

  it('flushes each kind independently with its own message', () => {
    vi.useFakeTimers()
    const { batcher, flushed } = makeBatcher()

    batcher.add(makeSubagent(1, 'task-1', 'done'), 'done', 'Done message')
    batcher.add(makeSubagent(2, 'task-2', 'running'), 'activity', 'Activity')
    vi.advanceTimersByTime(100)

    expect(flushed).toHaveLength(2)
    const kinds = flushed.map((entry) => entry.message.kind)
    expect(kinds).toContain('done')
    expect(kinds).toContain('activity')
    for (const entry of flushed) {
      expect(entry.message.jobs).toHaveLength(1)
    }
  })

  it('flushes immediately when requested via flushNow', () => {
    vi.useFakeTimers()
    const { batcher, flushed } = makeBatcher()

    const subagent = makeSubagent(1, 'task-1', 'done')
    batcher.add(subagent, 'done', 'Task completed')
    batcher.flushNow()

    expect(flushed).toHaveLength(1)
    expect(flushed[0]?.message.jobs[0]).toContain('done #1')
    vi.advanceTimersByTime(100)
    expect(flushed).toHaveLength(1)
  })

  it('clears pending items after flushNow', () => {
    vi.useFakeTimers()
    const { batcher, flushed } = makeBatcher()

    const subagent1 = makeSubagent(1, 'task-1', 'done')
    batcher.add(subagent1, 'done', 'Task 1 completed')
    batcher.flushNow()
    expect(bufferOf(batcher).silent).toEqual([])
    expect(bufferOf(batcher).response).toEqual([])

    const subagent2 = makeSubagent(2, 'task-2', 'done')
    batcher.add(subagent2, 'done', 'Task 2 completed')
    batcher.flushNow()

    expect(flushed).toHaveLength(2)
    expect(flushed[0]?.message.jobs[0]).toContain('done #1')
    expect(flushed[1]?.message.jobs[0]).toContain('done #2')
  })

  it('preserves raw message text without escaping', () => {
    vi.useFakeTimers()
    const { batcher, flushed } = makeBatcher()
    const subagent = makeSubagent(1, 'fix <auth> & "quotes"', 'done')

    batcher.add(subagent, 'done', 'parsed <config> && values > 0')
    batcher.flushNow()

    expect(flushed[0]?.message.content).toContain(
      'parsed <config> && values > 0',
    )
    expect(flushed[0]?.message.content).toContain('fix <auth> & "quotes"')
  })

  it('clears pending items without flushing via clear', () => {
    vi.useFakeTimers()
    const { batcher, flushed } = makeBatcher()

    const subagent = makeSubagent(1, 'task-1', 'done')
    batcher.add(subagent, 'done', 'Task completed')
    batcher.clear()
    vi.advanceTimersByTime(100)

    expect(flushed).toHaveLength(0)
    expect(bufferOf(batcher).silent).toEqual([])
    expect(bufferOf(batcher).response).toEqual([])
  })

  it('renders reviewed and steer kinds with correct markers', () => {
    vi.useFakeTimers()
    const { batcher, flushed } = makeBatcher()

    batcher.add(makeSubagent(1, 'plan-1', 'done'), 'reviewed', 'Plan review')
    batcher.add(
      makeSubagent(2, 'task-2', 'running'),
      'steer',
      'focus on <auth>',
    )
    batcher.flushNow()

    expect(flushed).toHaveLength(2)
    const reviewed = flushed.find((e) => e.message.kind === 'reviewed')
    const steer = flushed.find((e) => e.message.kind === 'steer')
    expect(reviewed?.message.content).toContain('**[done #1]**')
    expect(reviewed?.message.content).toContain('Plan review')
    expect(steer?.message.content).toContain('**[running #2]**')
    expect(steer?.message.content).toContain('focus on <auth>')
    expect(steer?.triggerTurn).toBe(false)
    expect(reviewed?.triggerTurn).toBe(true)
  })

  it('resets timer on each add', () => {
    vi.useFakeTimers()
    const { batcher, flushed } = makeBatcher()

    batcher.add(makeSubagent(1, 'task-1', 'done'), 'done', 'First message')
    vi.advanceTimersByTime(50)
    expect(flushed).toHaveLength(0)

    batcher.add(makeSubagent(2, 'task-2', 'running'), 'activity', 'Second')
    vi.advanceTimersByTime(50)
    expect(flushed).toHaveLength(0)

    vi.advanceTimersByTime(50)
    // done and activity land in different kinds, so they flush separately.
    expect(flushed).toHaveLength(2)
  })

  it('routes each kind to its channel with the right trigger-turn flag', () => {
    vi.useFakeTimers()
    const { batcher, flushed } = makeBatcher()

    batcher.add(makeSubagent(1, 'task-1', 'running'), 'steer', 'Steer message')
    batcher.add(makeSubagent(2, 'task-2', 'done'), 'done', 'Done message')
    batcher.flushNow()

    expect(flushed[0]?.message).toMatchObject({
      kind: 'steer',
      content: expect.stringContaining('Steer message'),
      jobs: [expect.stringContaining('running #1')],
    })
    expect(flushed[0]?.triggerTurn).toBe(false)
    expect(flushed[1]?.message).toMatchObject({
      kind: 'done',
      content: expect.stringContaining('Done message'),
      jobs: [expect.stringContaining('done #2')],
    })
    expect(flushed[1]?.triggerTurn).toBe(true)
  })

  it('shares one debounce window across silent and response queues', () => {
    vi.useFakeTimers()
    const { batcher, flushed } = makeBatcher()

    batcher.add(makeSubagent(1, 'task-1', 'done'), 'done', 'Done message')
    vi.advanceTimersByTime(60)
    // Adding a steer item resets the shared window, delaying the pending done.
    batcher.add(makeSubagent(2, 'task-2', 'running'), 'steer', 'Steer message')
    vi.advanceTimersByTime(40)
    expect(flushed).toHaveLength(0)

    vi.advanceTimersByTime(60)
    expect(flushed).toHaveLength(2)
    expect(flushed[0]?.message.kind).toBe('steer')
    expect(flushed[0]?.triggerTurn).toBe(false)
    expect(flushed[1]?.message.kind).toBe('done')
    expect(flushed[1]?.triggerTurn).toBe(true)
  })

  it('flushNow flushes silent first, skipping empty channels', () => {
    vi.useFakeTimers()
    const { batcher, flushed } = makeBatcher()

    // Response-only: silent channel is empty and must be skipped.
    batcher.add(makeSubagent(1, 'task-1', 'done'), 'done', 'Done message')
    batcher.flushNow()
    expect(flushed).toHaveLength(1)
    expect(flushed[0]?.triggerTurn).toBe(true)

    // Both channels: silent flushes first.
    batcher.add(makeSubagent(2, 'task-2', 'running'), 'steer', 'Steer message')
    batcher.add(makeSubagent(3, 'task-3', 'done'), 'done', 'Done message')
    batcher.flushNow()

    expect(flushed).toHaveLength(3)
    expect(flushed[1]?.message.kind).toBe('steer')
    expect(flushed[1]?.triggerTurn).toBe(false)
    expect(flushed[2]?.message.kind).toBe('done')
    expect(flushed[2]?.triggerTurn).toBe(true)
  })

  it('clears both channels without flushing via clear', () => {
    vi.useFakeTimers()
    const { batcher, flushed } = makeBatcher()

    batcher.add(makeSubagent(1, 'task-1', 'running'), 'steer', 'Steer message')
    batcher.add(makeSubagent(2, 'task-2', 'done'), 'done', 'Done message')
    batcher.clear()
    expect(bufferOf(batcher).silent).toEqual([])
    expect(bufferOf(batcher).response).toEqual([])
    vi.advanceTimersByTime(200)
    expect(flushed).toHaveLength(0)
  })
})
