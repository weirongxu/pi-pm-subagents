import { afterEach, describe, expect, it, vi } from 'vitest'

import { MessageBatcher } from './batcher.js'
import type { LiveWorker } from './worker.js'

const makeWorker = (id: number, title: string, status: string): LiveWorker =>
  ({
    id,
    title,
    text: title,
    status: status as never,
    startedAt: Date.now() - 5000,
    session: { messages: [] as never },
    followUpCount: 0,
    enabledTools: new Set(),
  }) as unknown as LiveWorker

describe('MessageBatcher', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('flushes after batching window', () => {
    vi.useFakeTimers()
    const flushed: string[][] = []
    const batcher = new MessageBatcher((items) => flushed.push(items), 100)
    const worker = makeWorker(1, 'task-1', 'done')

    batcher.add(worker, 'done', 'Task completed')
    expect(batcher.pending.length).toBe(1)

    vi.advanceTimersByTime(99)
    expect(flushed).toHaveLength(0)

    vi.advanceTimersByTime(1)
    expect(flushed).toHaveLength(1)
    const firstFlush = flushed[0]
    expect(firstFlush?.[0]).toContain('done #1')
    expect(firstFlush?.[0]).toContain('<notify-type>done</notify-type>')
    expect(firstFlush?.[0]).toContain('<message>\nTask completed\n</message>')
    expect(batcher.pending).toEqual([])
  })

  it('combines multiple items in the same window', () => {
    vi.useFakeTimers()
    const flushed: string[][] = []
    const batcher = new MessageBatcher((items) => flushed.push(items), 100)

    const worker1 = makeWorker(1, 'task-1', 'done')
    const worker2 = makeWorker(2, 'task-2', 'failed')

    batcher.add(worker1, 'done', 'Task 1 completed')
    vi.advanceTimersByTime(50)
    batcher.add(worker2, 'failed', 'Task 2 failed')
    vi.advanceTimersByTime(50)

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

    const worker1 = makeWorker(1, 'task-1', 'done')
    batcher.add(worker1, 'done', 'Task 1 completed')
    batcher.flushNow()
    expect(batcher.pending).toEqual([])

    const worker2 = makeWorker(2, 'task-2', 'done')
    batcher.add(worker2, 'done', 'Task 2 completed')
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

    const worker = makeWorker(1, 'task-1', 'done')
    batcher.add(worker, 'done', 'Task completed')
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

    const worker = makeWorker(1, 'task-1', 'done')
    batcher.add(worker, 'done', 'Task completed')
    batcher.clear()
    vi.advanceTimersByTime(100)

    expect(flushed).toHaveLength(0)
    expect(batcher.pending).toEqual([])
  })

  it('adds items in order and flushes them together', () => {
    vi.useFakeTimers()
    const flushed: string[][] = []
    const batcher = new MessageBatcher((items) => flushed.push(items), 100)

    const worker1 = makeWorker(1, 'task-1', 'done')
    const worker2 = makeWorker(2, 'task-2', 'running')

    batcher.add(worker1, 'done', 'Worker #1 work done.')
    batcher.add(worker2, 'activity', 'Worker activity update')
    vi.advanceTimersByTime(100)

    expect(flushed).toHaveLength(1)
    const firstFlush = flushed[0]
    expect(firstFlush?.length).toBe(2)
    expect(firstFlush?.[0]).toContain('done #1')
    expect(firstFlush?.[0]).toContain('Worker #1 work done.')
    expect(firstFlush?.[1]).toContain('running #2')
    expect(firstFlush?.[1]).toContain('Worker activity update')
  })
})
