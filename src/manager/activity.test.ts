import { describe, expect, it, vi } from 'vitest'

import { ActivityReporter } from './activity.js'
import type { LiveWorker } from './worker.js'

const makeWorker = (id: number, messages: unknown[]): LiveWorker =>
  ({
    id,
    title: `task-${id}`,
    text: `task-${id}`,
    status: 'running',
    startedAt: Date.now() - 1000,
    session: { messages: messages as never },
    followUpCount: 0,
    enabledTools: new Set(),
  }) as unknown as LiveWorker

const assistant = (text: string) =>
  ({
    role: 'assistant',
    content: [{ type: 'text', text }],
    timestamp: Date.now(),
  }) as unknown as never

describe('ActivityReporter.formatActivityReport', () => {
  it('returns last assistant message text', () => {
    const messages = [assistant('Working on it')]
    const worker = makeWorker(1, messages)
    const report = ActivityReporter.formatActivityReport(worker)
    expect(report).toBe('Working on it')
  })

  it('returns fallback for worker with no valid last message', () => {
    const worker = makeWorker(1, [])
    const report = ActivityReporter.formatActivityReport(worker)
    expect(report).toBe('(Just started, waiting for first message)')
  })

  it('truncates long message text to MAX_ACTIVITY_BYTES', () => {
    const longText = 'a'.repeat(1000)
    const messages = [assistant(longText)]
    const worker = makeWorker(1, messages)
    const report = ActivityReporter.formatActivityReport(worker)
    expect(report).toContain('[Output truncated')
  })
})

describe('ActivityReporter integration', () => {
  it('starts and stops without errors', () => {
    vi.useFakeTimers()
    let reportCount = 0

    const activityReporter = new ActivityReporter({
      list: () => [],
      onActivity: () => {
        reportCount += 1
      },
    })

    activityReporter.start()
    activityReporter.stop()
    vi.advanceTimersByTime(5 * 60 * 1000)

    expect(reportCount).toBe(0)
  })

  it('does not call onActivity when no running workers', () => {
    vi.useFakeTimers()
    const reports: { worker: LiveWorker; report: string }[] = []

    const activityReporter = new ActivityReporter({
      list: () =>
        [
          { id: 1, status: 'done', title: 'Task 1' },
          { id: 2, status: 'failed', title: 'Task 2' },
        ] as LiveWorker[],
      onActivity: (worker, report) => reports.push({ worker, report }),
      checkIntervalMs: 100,
    })

    activityReporter.start()
    vi.advanceTimersByTime(100)

    expect(reports).toHaveLength(0)
  })

  it('calls onActivity with worker and report when running workers exist', () => {
    vi.useFakeTimers()
    const reports: { worker: LiveWorker; report: string }[] = []
    const worker = makeWorker(1, [assistant('Doing task')])
    worker.startedAt = Date.now() - 60000

    const activityReporter = new ActivityReporter({
      list: () => [worker],
      onActivity: (worker, report) => reports.push({ worker, report }),
      checkIntervalMs: 100,
      notificationIntervalMs: 1000,
    })

    activityReporter.start()
    vi.advanceTimersByTime(100)

    expect(reports).toHaveLength(1)
    expect(reports[0]?.worker.id).toBe(1)
    expect(reports[0]?.report).toBe('Doing task')
  })

  it('respects custom checkIntervalMs', () => {
    vi.useFakeTimers()
    const reports: { worker: LiveWorker; report: string }[] = []
    const worker = makeWorker(1, [])
    worker.startedAt = Date.now() - 60000

    const activityReporter = new ActivityReporter({
      list: () => [worker],
      onActivity: (worker, report) => reports.push({ worker, report }),
      checkIntervalMs: 200,
      notificationIntervalMs: 1000,
    })

    activityReporter.start()
    vi.advanceTimersByTime(199)
    expect(reports).toHaveLength(0)

    vi.advanceTimersByTime(1)
    expect(reports).toHaveLength(1)
  })

  it('does not leak timers on multiple starts', () => {
    vi.useFakeTimers()
    let reportCount = 0
    const worker = makeWorker(1, [])
    worker.startedAt = Date.now() - 60000

    const activityReporter = new ActivityReporter({
      list: () => [worker],
      onActivity: () => {
        reportCount += 1
      },
      checkIntervalMs: 50,
      notificationIntervalMs: 100,
    })

    activityReporter.start()
    vi.advanceTimersByTime(50)
    expect(reportCount).toBe(1)

    vi.advanceTimersByTime(50)
    expect(reportCount).toBe(1)

    activityReporter.start()
    vi.advanceTimersByTime(50)
    expect(reportCount).toBe(2)
  })
})

describe('ActivityReporter per-worker throttling', () => {
  it('throttles notifications per worker based on notificationIntervalMs', () => {
    vi.useFakeTimers()
    const reports: { worker: LiveWorker; report: string }[] = []
    const worker = makeWorker(1, [])
    worker.startedAt = Date.now() - 60000

    const activityReporter = new ActivityReporter({
      list: () => [worker],
      onActivity: (worker, report) => reports.push({ worker, report }),
      checkIntervalMs: 100,
      notificationIntervalMs: 200,
    })

    activityReporter.start()
    vi.advanceTimersByTime(100)
    expect(reports).toHaveLength(1)

    vi.advanceTimersByTime(100)
    expect(reports).toHaveLength(1)

    vi.advanceTimersByTime(100)
    expect(reports).toHaveLength(2)
  })

  it('tracks per-worker throttling independently', () => {
    vi.useFakeTimers()
    const reports: { worker: LiveWorker; report: string }[] = []
    const w1 = makeWorker(1, [])
    w1.startedAt = Date.now() - 60000
    const w2 = makeWorker(2, [])
    w2.startedAt = Date.now() - 60000

    const activityReporter = new ActivityReporter({
      list: () => [w1, w2],
      onActivity: (worker, report) => reports.push({ worker, report }),
      checkIntervalMs: 100,
      notificationIntervalMs: 200,
    })

    activityReporter.start()
    vi.advanceTimersByTime(100)
    expect(reports).toHaveLength(2)

    w1.status = 'done'
    vi.advanceTimersByTime(100)
    expect(reports).toHaveLength(2)

    vi.advanceTimersByTime(100)
    expect(reports).toHaveLength(3)
    expect(reports[2]?.worker.id).toBe(2)
  })

  it('does not send report when worker is not due yet', () => {
    vi.useFakeTimers()
    const reports: { worker: LiveWorker; report: string }[] = []
    const worker = makeWorker(1, [])
    worker.startedAt = Date.now() - 1000

    const activityReporter = new ActivityReporter({
      list: () => [worker],
      onActivity: (worker, report) => reports.push({ worker, report }),
      checkIntervalMs: 100,
      notificationIntervalMs: 1500,
    })

    activityReporter.start()
    vi.advanceTimersByTime(100)
    expect(reports).toHaveLength(0)

    vi.advanceTimersByTime(400)
    expect(reports).toHaveLength(1)
  })
})
