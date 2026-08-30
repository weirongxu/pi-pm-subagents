import { describe, expect, it, vi } from 'vitest'

import { ActivityReporter, MAX_ACTIVITY_BYTES } from './activity.js'
import type { LiveSubagent } from './manager.js'

const makeSubagent = (id: number, messages: unknown[]): LiveSubagent =>
  ({
    id,
    title: `task-${id}`,
    text: `task-${id}`,
    status: 'running',
    startedAt: Date.now() - 1000,
    session: { messages: messages as never },
    followUpCount: 0,
    enabledTools: new Set(),
  }) as unknown as LiveSubagent

const assistant = (text: string) =>
  ({
    role: 'assistant',
    content: [{ type: 'text', text }],
    timestamp: Date.now(),
  }) as unknown as never

describe('ActivityReporter.formatActivityReport', () => {
  it('returns last assistant message text', () => {
    const messages = [assistant('Working on it')]
    const subagent = makeSubagent(1, messages)
    const report = ActivityReporter.formatActivityReport(subagent)
    expect(report).toBe('Working on it')
  })

  it('returns fallback for subagent with no valid last message', () => {
    const subagent = makeSubagent(1, [])
    const report = ActivityReporter.formatActivityReport(subagent)
    expect(report).toBe('(Just started, waiting for first message)')
  })

  it('truncates long message text to MAX_ACTIVITY_BYTES', () => {
    const longText = 'a'.repeat(MAX_ACTIVITY_BYTES * 2)
    const messages = [assistant(longText)]
    const subagent = makeSubagent(1, messages)
    const report = ActivityReporter.formatActivityReport(subagent)
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

  it('does not call onActivity when no running subagents', () => {
    vi.useFakeTimers()
    const reports: { subagent: LiveSubagent; report: string }[] = []

    const activityReporter = new ActivityReporter({
      list: () =>
        [
          { id: 1, status: 'done', title: 'Task 1' },
          { id: 2, status: 'failed', title: 'Task 2' },
        ] as LiveSubagent[],
      onActivity: (subagent, report) => reports.push({ subagent, report }),
      checkIntervalMs: 100,
    })

    activityReporter.start()
    vi.advanceTimersByTime(100)

    expect(reports).toHaveLength(0)
  })

  it('calls onActivity with subagent and report when running subagents exist', () => {
    vi.useFakeTimers()
    const reports: { subagent: LiveSubagent; report: string }[] = []
    const subagent = makeSubagent(1, [assistant('Doing task')])
    subagent.startedAt = Date.now() - 60000

    const activityReporter = new ActivityReporter({
      list: () => [subagent],
      onActivity: (subagent, report) => reports.push({ subagent, report }),
      checkIntervalMs: 100,
      notificationIntervalMs: 1000,
    })

    activityReporter.start()
    vi.advanceTimersByTime(100)

    expect(reports).toHaveLength(1)
    expect(reports[0]?.subagent.id).toBe(1)
    expect(reports[0]?.report).toBe('Doing task')
  })

  it('respects custom checkIntervalMs', () => {
    vi.useFakeTimers()
    const reports: { subagent: LiveSubagent; report: string }[] = []
    const subagent = makeSubagent(1, [])
    subagent.startedAt = Date.now() - 60000

    const activityReporter = new ActivityReporter({
      list: () => [subagent],
      onActivity: (subagent, report) => reports.push({ subagent, report }),
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
    const subagent = makeSubagent(1, [])
    subagent.startedAt = Date.now() - 60000

    const activityReporter = new ActivityReporter({
      list: () => [subagent],
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

describe('ActivityReporter per-subagent throttling', () => {
  it('throttles notifications per subagent based on notificationIntervalMs', () => {
    vi.useFakeTimers()
    const reports: { subagent: LiveSubagent; report: string }[] = []
    const subagent = makeSubagent(1, [])
    subagent.startedAt = Date.now() - 60000

    const activityReporter = new ActivityReporter({
      list: () => [subagent],
      onActivity: (subagent, report) => reports.push({ subagent, report }),
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

  it('tracks per-subagent throttling independently', () => {
    vi.useFakeTimers()
    const reports: { subagent: LiveSubagent; report: string }[] = []
    const s1 = makeSubagent(1, [])
    s1.startedAt = Date.now() - 60000
    const s2 = makeSubagent(2, [])
    s2.startedAt = Date.now() - 60000

    const activityReporter = new ActivityReporter({
      list: () => [s1, s2],
      onActivity: (subagent, report) => reports.push({ subagent, report }),
      checkIntervalMs: 100,
      notificationIntervalMs: 200,
    })

    activityReporter.start()
    vi.advanceTimersByTime(100)
    expect(reports).toHaveLength(2)

    s1.status = 'done'
    vi.advanceTimersByTime(100)
    expect(reports).toHaveLength(2)

    vi.advanceTimersByTime(100)
    expect(reports).toHaveLength(3)
    expect(reports[2]?.subagent.id).toBe(2)
  })

  it('does not send report when subagent is not due yet', () => {
    vi.useFakeTimers()
    const reports: { subagent: LiveSubagent; report: string }[] = []
    const subagent = makeSubagent(1, [])
    subagent.startedAt = Date.now() - 1000

    const activityReporter = new ActivityReporter({
      list: () => [subagent],
      onActivity: (subagent, report) => reports.push({ subagent, report }),
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
