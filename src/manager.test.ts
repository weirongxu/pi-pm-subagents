import { afterEach, describe, expect, it, vi } from 'vitest'

import type { LiveWorker } from '../src/manager.js'
import { CompletionBatcher } from '../src/manager.js'

const makeWorker = (id: number): LiveWorker =>
  ({
    id,
    text: `task-${id}`,
    status: 'done',
    summary: `summary-${id}`,
  }) as LiveWorker

describe('CompletionBatcher', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('flushes a single worker after the batching window', () => {
    vi.useFakeTimers()
    const worker = makeWorker(1)
    const flushed: LiveWorker[][] = []
    const batcher = new CompletionBatcher(
      (workers) => flushed.push(workers),
      100,
    )

    batcher.add(worker)
    expect(batcher.pending).toEqual([worker])
    vi.advanceTimersByTime(99)
    expect(flushed).toHaveLength(0)

    vi.advanceTimersByTime(1)

    expect(flushed).toEqual([[worker]])
    expect(batcher.pending).toEqual([])
  })

  it('combines workers completed in the same window', () => {
    vi.useFakeTimers()
    const first = makeWorker(1)
    const second = makeWorker(2)
    const flushed: LiveWorker[][] = []
    const batcher = new CompletionBatcher(
      (workers) => flushed.push(workers),
      100,
    )

    batcher.add(first)
    vi.advanceTimersByTime(50)
    batcher.add(second)
    vi.advanceTimersByTime(50)

    expect(flushed).toEqual([[first, second]])
    expect(batcher.pending).toEqual([])
  })

  it('clears pending workers after every flush', () => {
    vi.useFakeTimers()
    const first = makeWorker(1)
    const second = makeWorker(2)
    const flushed: LiveWorker[][] = []
    const batcher = new CompletionBatcher(
      (workers) => flushed.push(workers),
      100,
    )

    batcher.add(first)
    batcher.flushNow()
    expect(batcher.pending).toEqual([])

    batcher.add(second)
    batcher.flushNow()

    expect(flushed).toEqual([[first], [second]])
    expect(batcher.pending).toEqual([])
  })

  it('flushes immediately when requested', () => {
    vi.useFakeTimers()
    const worker = makeWorker(1)
    const flushed: LiveWorker[][] = []
    const batcher = new CompletionBatcher(
      (workers) => flushed.push(workers),
      100,
    )

    batcher.add(worker)
    batcher.flushNow()

    expect(flushed).toEqual([[worker]])
    vi.advanceTimersByTime(100)
    expect(flushed).toHaveLength(1)
  })

  it('clears pending workers without flushing them', () => {
    vi.useFakeTimers()
    const worker = makeWorker(1)
    const flushed: LiveWorker[][] = []
    const batcher = new CompletionBatcher(
      (workers) => flushed.push(workers),
      100,
    )

    batcher.add(worker)
    batcher.clear()
    vi.advanceTimersByTime(100)

    expect(flushed).toHaveLength(0)
    expect(batcher.pending).toEqual([])
  })
})
