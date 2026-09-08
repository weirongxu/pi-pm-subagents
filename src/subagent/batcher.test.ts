import { afterEach, describe, expect, it, vi } from 'vitest'

import { MessageBatcher } from './batcher.js'
import type { LiveSubagent } from './manager.js'

const makeSubagent = (
  id: number,
  title: string,
  status: string,
): LiveSubagent =>
  ({
    id,
    title,
    text: title,
    status: status as never,
    startedAt: Date.now() - 5000,
    session: { messages: [] as never },
    followUpCount: 0,
    activeTools: [],
  }) as unknown as LiveSubagent

describe('MessageBatcher', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('flushes after batching window', () => {
    vi.useFakeTimers()
    const flushed: string[][] = []
    const batcher = new MessageBatcher((items) => flushed.push(items), 100)
    const subagent = makeSubagent(1, 'task-1', 'done')
    subagent.contextUsage = {
      tokens: 60000,
      contextWindow: 200000,
      percent: 30,
    }

    batcher.add(subagent, 'done', 'Task completed')
    expect(batcher.pending.length).toBe(1)

    vi.advanceTimersByTime(99)
    expect(flushed).toHaveLength(0)

    vi.advanceTimersByTime(1)
    expect(flushed).toHaveLength(1)
    const firstFlush = flushed[0]
    expect(firstFlush?.[0]).toContain('done #1')
    expect(firstFlush?.[0]).toContain('60k/200k')
    expect(firstFlush?.[0]).toContain('<type>done</type>')
    expect(firstFlush?.[0]).toContain('<message>Task completed</message>')
    expect(batcher.pending).toEqual([])
  })

  it('combines multiple items in the same window', () => {
    vi.useFakeTimers()
    const flushed: string[][] = []
    const batcher = new MessageBatcher((items) => flushed.push(items), 100)

    const subagent1 = makeSubagent(1, 'task-1', 'done')
    const subagent2 = makeSubagent(2, 'task-2', 'failed')

    batcher.add(subagent1, 'done', 'Task 1 completed')
    vi.advanceTimersByTime(50)
    batcher.add(subagent2, 'failed', 'Task 2 failed')
    vi.advanceTimersByTime(100)

    expect(flushed).toHaveLength(1)
    const firstFlush = flushed[0]
    expect(firstFlush?.length).toBe(2)
    expect(firstFlush?.[0]).toContain('done #1')
    expect(firstFlush?.[0]).toContain('Task 1 completed')
    expect(firstFlush?.[1]).toContain('failed #2')
    expect(firstFlush?.[1]).toContain('Task 2 failed')
    expect(batcher.pending).toEqual([])
  })

  it('clears pending items after flushNow', () => {
    vi.useFakeTimers()
    const flushed: string[][] = []
    const batcher = new MessageBatcher((items) => flushed.push(items), 100)

    const subagent1 = makeSubagent(1, 'task-1', 'done')
    batcher.add(subagent1, 'done', 'Task 1 completed')
    batcher.flushNow()
    expect(batcher.pending).toEqual([])

    const subagent2 = makeSubagent(2, 'task-2', 'done')
    batcher.add(subagent2, 'done', 'Task 2 completed')
    batcher.flushNow()

    expect(flushed).toHaveLength(2)
    expect(flushed[0]?.[0]).toContain('done #1')
    expect(flushed[1]?.[0]).toContain('done #2')
    expect(batcher.pending).toEqual([])
  })

  it('flushes immediately when requested via flushNow', () => {
    vi.useFakeTimers()
    const flushed: string[][] = []
    const batcher = new MessageBatcher((items) => flushed.push(items), 100)

    const subagent = makeSubagent(1, 'task-1', 'done')
    batcher.add(subagent, 'done', 'Task completed')
    batcher.flushNow()

    expect(flushed).toHaveLength(1)
    const firstFlush = flushed[0]
    expect(firstFlush?.[0]).toContain('done #1')
    vi.advanceTimersByTime(100)
    expect(flushed).toHaveLength(1)
  })

  it('clears pending items without flushing via clear', () => {
    vi.useFakeTimers()
    const flushed: string[][] = []
    const batcher = new MessageBatcher((items) => flushed.push(items), 100)

    const subagent = makeSubagent(1, 'task-1', 'done')
    batcher.add(subagent, 'done', 'Task completed')
    batcher.clear()
    vi.advanceTimersByTime(100)

    expect(flushed).toHaveLength(0)
    expect(batcher.pending).toEqual([])
  })

  it('adds items in order and flushes them together', () => {
    vi.useFakeTimers()
    const flushed: string[][] = []
    const batcher = new MessageBatcher((items) => flushed.push(items), 100)

    const subagent1 = makeSubagent(1, 'task-1', 'done')
    const subagent2 = makeSubagent(2, 'task-2', 'running')

    batcher.add(subagent1, 'done', 'Subagent #1 work done.')
    batcher.add(subagent2, 'activity', 'Subagent activity update')
    vi.advanceTimersByTime(100)

    expect(flushed).toHaveLength(1)
    const firstFlush = flushed[0]
    expect(firstFlush?.length).toBe(2)
    expect(firstFlush?.[0]).toContain('done #1')
    expect(firstFlush?.[0]).toContain('Subagent #1 work done.')
    expect(firstFlush?.[1]).toContain('running #2')
    expect(firstFlush?.[1]).toContain('Subagent activity update')
  })

  it('formats plan items with reviewed-by-user tag', () => {
    vi.useFakeTimers()
    const flushed: string[][] = []
    const batcher = new MessageBatcher((items) => flushed.push(items), 100)
    const subagent = makeSubagent(1, 'plan-1', 'done')

    batcher.add(subagent, 'plan', 'The implementation plan')
    batcher.flushNow()

    expect(flushed).toHaveLength(1)
    const item = flushed[0]?.[0]
    expect(item).toContain('<subagent-plan>')
    expect(item).toContain('</subagent-plan>')
    expect(item).toContain('<type>plan</type>')
    expect(item).toContain('<reviewed-by-user>true</reviewed-by-user>')
    expect(item).toContain('<message>The implementation plan</message>')
  })

  it('does not add reviewed-by-user tag to non-plan items', () => {
    vi.useFakeTimers()
    const flushed: string[][] = []
    const batcher = new MessageBatcher((items) => flushed.push(items), 100)
    const subagent = makeSubagent(1, 'task-1', 'done')

    batcher.add(subagent, 'done', 'Task completed')
    batcher.flushNow()

    const item = flushed[0]?.[0]
    expect(item).not.toContain('reviewed-by-user')
  })

  it('resets timer on each add', () => {
    vi.useFakeTimers()
    const flushed: string[][] = []
    const batcher = new MessageBatcher((items) => flushed.push(items), 100)

    const subagent1 = makeSubagent(1, 'task-1', 'done')
    const subagent2 = makeSubagent(2, 'task-2', 'running')

    batcher.add(subagent1, 'done', 'First message')
    vi.advanceTimersByTime(50)
    expect(flushed).toHaveLength(0)

    batcher.add(subagent2, 'activity', 'Second message')
    vi.advanceTimersByTime(50)
    expect(flushed).toHaveLength(0)

    vi.advanceTimersByTime(50)
    expect(flushed).toHaveLength(1)

    const firstFlush = flushed[0]
    expect(firstFlush?.length).toBe(2)
    expect(firstFlush?.[0]).toContain('done #1')
    expect(firstFlush?.[0]).toContain('First message')
    expect(firstFlush?.[1]).toContain('running #2')
    expect(firstFlush?.[1]).toContain('Second message')
  })

  it('clears old timer and starts new one when adding item', () => {
    vi.useFakeTimers()
    const flushed: string[][] = []
    const batcher = new MessageBatcher((items) => flushed.push(items), 100)

    const subagent = makeSubagent(1, 'task-1', 'done')

    batcher.add(subagent, 'done', 'Message 1')
    vi.advanceTimersByTime(80)
    expect(flushed).toHaveLength(0)

    batcher.add(subagent, 'activity', 'Message 2')
    vi.advanceTimersByTime(80)
    expect(flushed).toHaveLength(0)

    vi.advanceTimersByTime(20)
    expect(flushed).toHaveLength(1)

    const firstFlush = flushed[0]
    expect(firstFlush?.length).toBe(2)
    expect(firstFlush?.[0]).toContain('Message 1')
    expect(firstFlush?.[1]).toContain('Message 2')
  })
})
