import { afterEach, describe, expect, it, vi } from 'vitest'

import { MessageBatcher } from './batcher.js'
import type { LiveSubagent } from './manager.js'

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
): { silent: string[]; response: string[] } =>
  (batcher as unknown as { buffer: { silent: string[]; response: string[] } })
    .buffer

interface FlushedEntry {
  messages: readonly string[]
  triggerTurn: boolean
}

const makeBatcher = (windowMs = 100) => {
  const flushed: FlushedEntry[] = []
  const batcher = new MessageBatcher(
    (messages, triggerTurn) => flushed.push({ messages, triggerTurn }),
    windowMs,
  )
  return { batcher, flushed }
}

describe('MessageBatcher', () => {
  afterEach(() => {
    vi.useRealTimers()
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
    expect(firstFlush?.messages[0]).toContain('done #1')
    expect(firstFlush?.messages[0]).toContain('60k/200k')
    expect(firstFlush?.messages[0]).toContain('<type>done</type>')
    expect(firstFlush?.messages[0]).toContain(
      '<message>Task completed</message>',
    )
    expect(bufferOf(batcher).silent).toEqual([])
    expect(bufferOf(batcher).response).toEqual([])
  })

  it('combines multiple items in the same window', () => {
    vi.useFakeTimers()
    const { batcher, flushed } = makeBatcher()

    const subagent1 = makeSubagent(1, 'task-1', 'done')
    const subagent2 = makeSubagent(2, 'task-2', 'failed')

    batcher.add(subagent1, 'done', 'Task 1 completed')
    vi.advanceTimersByTime(50)
    batcher.add(subagent2, 'done', 'Task 2 failed')
    vi.advanceTimersByTime(100)

    expect(flushed).toHaveLength(1)
    const firstFlush = flushed[0]
    expect(firstFlush?.messages.length).toBe(2)
    expect(firstFlush?.messages[0]).toContain('done #1')
    expect(firstFlush?.messages[0]).toContain('Task 1 completed')
    expect(firstFlush?.messages[1]).toContain('failed #2')
    expect(firstFlush?.messages[1]).toContain('Task 2 failed')
    expect(bufferOf(batcher).silent).toEqual([])
    expect(bufferOf(batcher).response).toEqual([])
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
    expect(flushed[0]?.messages[0]).toContain('done #1')
    expect(flushed[1]?.messages[0]).toContain('done #2')
    expect(bufferOf(batcher).silent).toEqual([])
    expect(bufferOf(batcher).response).toEqual([])
  })

  it('escapes XML special characters in message and job summary', () => {
    vi.useFakeTimers()
    const { batcher, flushed } = makeBatcher()
    const subagent = makeSubagent(1, 'fix <auth> & "quotes"', 'done')

    batcher.add(subagent, 'done', 'parsed <config> && values > 0')
    batcher.flushNow()

    const item = flushed[0]?.messages[0] ?? ''
    expect(item).toContain(
      '<message>parsed &lt;config&gt; &amp;&amp; values &gt; 0</message>',
    )
    expect(item).toContain('fix &lt;auth&gt; &amp; "quotes"')
  })

  it('flushes immediately when requested via flushNow', () => {
    vi.useFakeTimers()
    const { batcher, flushed } = makeBatcher()

    const subagent = makeSubagent(1, 'task-1', 'done')
    batcher.add(subagent, 'done', 'Task completed')
    batcher.flushNow()

    expect(flushed).toHaveLength(1)
    const firstFlush = flushed[0]
    expect(firstFlush?.messages[0]).toContain('done #1')
    vi.advanceTimersByTime(100)
    expect(flushed).toHaveLength(1)
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

  it('adds items in order and flushes them together', () => {
    vi.useFakeTimers()
    const { batcher, flushed } = makeBatcher()

    const subagent1 = makeSubagent(1, 'task-1', 'done')
    const subagent2 = makeSubagent(2, 'task-2', 'running')

    batcher.add(subagent1, 'done', 'Subagent #1 work done.')
    batcher.add(subagent2, 'activity', 'Subagent activity update')
    vi.advanceTimersByTime(100)

    expect(flushed).toHaveLength(1)
    const firstFlush = flushed[0]
    expect(firstFlush?.messages.length).toBe(2)
    expect(firstFlush?.messages[0]).toContain('done #1')
    expect(firstFlush?.messages[0]).toContain('Subagent #1 work done.')
    expect(firstFlush?.messages[1]).toContain('running #2')
    expect(firstFlush?.messages[1]).toContain('Subagent activity update')
  })

  it('adds reviewed tag for reviewed type', () => {
    vi.useFakeTimers()
    const { batcher, flushed } = makeBatcher()
    const subagent = makeSubagent(1, 'plan-1', 'done')

    batcher.add(subagent, 'reviewed', 'The implementation plan')
    batcher.flushNow()

    expect(flushed).toHaveLength(1)
    const item = flushed[0]?.messages[0] ?? ''
    expect(item).toContain('<subagent-reviewed>')
    expect(item).toContain('</subagent-reviewed>')
    expect(item).toContain('<type>reviewed</type>')
    expect(item).not.toContain('reviewed-by-user')
    expect(item).not.toContain('<revisions>')
    expect(item).toContain('<message>The implementation plan</message>')
  })

  it('omits revisions for reviewed items', () => {
    vi.useFakeTimers()
    const { batcher, flushed } = makeBatcher()
    const subagent = makeSubagent(1, 'plan-1', 'done')

    batcher.add(subagent, 'reviewed', 'The updated plan')
    batcher.flushNow()

    const item = flushed[0]?.messages[0] ?? ''
    expect(item).toContain('<message>The updated plan</message>')
    expect(item).not.toContain('<revisions>')
  })

  it('uses steer tag for steer type with xml-escaped message', () => {
    vi.useFakeTimers()
    const { batcher, flushed } = makeBatcher()
    const subagent = makeSubagent(1, 'task-1', 'running')

    batcher.add(subagent, 'steer', 'focus on <auth> & "cases"')
    batcher.flushNow()

    expect(flushed).toHaveLength(1)
    const item = flushed[0]?.messages[0] ?? ''
    expect(item).toContain('<subagent-steer>')
    expect(item).toContain('</subagent-steer>')
    expect(item).toContain('<type>steer</type>')
    expect(item).toContain(
      '<message>focus on &lt;auth&gt; &amp; "cases"</message>',
    )
    expect(item).toContain('running #1')
  })

  it('uses done tag for done type', () => {
    vi.useFakeTimers()
    const { batcher, flushed } = makeBatcher()
    const subagent = makeSubagent(1, 'task-1', 'done')

    batcher.add(subagent, 'done', 'Task completed')
    batcher.flushNow()

    const item = flushed[0]?.messages[0] ?? ''
    expect(item).toContain('<subagent-done>')
    expect(item).toContain('</subagent-done>')
    expect(item).toContain('<type>done</type>')
    expect(item).not.toContain('reviewed-by-user')
  })

  it('resets timer on each add', () => {
    vi.useFakeTimers()
    const { batcher, flushed } = makeBatcher()

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
    expect(firstFlush?.messages.length).toBe(2)
    expect(firstFlush?.messages[0]).toContain('done #1')
    expect(firstFlush?.messages[0]).toContain('First message')
    expect(firstFlush?.messages[1]).toContain('running #2')
    expect(firstFlush?.messages[1]).toContain('Second message')
  })

  it('clears old timer and starts new one when adding item', () => {
    vi.useFakeTimers()
    const { batcher, flushed } = makeBatcher()

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
    expect(firstFlush?.messages.length).toBe(2)
    expect(firstFlush?.messages[0]).toContain('Message 1')
    expect(firstFlush?.messages[1]).toContain('Message 2')
  })

  it('routes steer items to the silent channel and others to the responsive one', () => {
    vi.useFakeTimers()
    const { batcher, flushed } = makeBatcher()

    batcher.add(makeSubagent(1, 'task-1', 'running'), 'steer', 'Steer message')
    batcher.flushNow()
    expect(flushed).toHaveLength(1)
    expect(flushed[0]?.triggerTurn).toBe(false)
    expect(flushed[0]?.messages[0]).toContain('Steer message')

    batcher.add(makeSubagent(2, 'task-2', 'done'), 'done', 'Done message')
    batcher.add(
      makeSubagent(3, 'task-3', 'running'),
      'activity',
      'Activity message',
    )
    batcher.add(makeSubagent(4, 'plan-4', 'done'), 'reviewed', 'Reviewed plan')
    batcher.flushNow()

    expect(flushed).toHaveLength(2)
    expect(flushed[1]?.triggerTurn).toBe(true)
    expect(flushed[1]?.messages.length).toBe(3)
    expect(flushed[1]?.messages[0]).toContain('<type>done</type>')
    expect(flushed[1]?.messages[1]).toContain('<type>activity</type>')
    expect(flushed[1]?.messages[2]).toContain('<type>reviewed</type>')
  })

  it('flushes steer and done items as two separate flushes with their own flags', () => {
    vi.useFakeTimers()
    const { batcher, flushed } = makeBatcher()

    batcher.add(makeSubagent(1, 'task-1', 'running'), 'steer', 'Steer message')
    batcher.add(makeSubagent(2, 'task-2', 'done'), 'done', 'Done message')
    batcher.flushNow()

    expect(flushed).toHaveLength(2)
    expect(flushed[0]?.triggerTurn).toBe(false)
    expect(flushed[0]?.messages[0]).toContain('<subagent-steer>')
    expect(flushed[1]?.triggerTurn).toBe(true)
    expect(flushed[1]?.messages[0]).toContain('<subagent-done>')
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
    expect(flushed[0]?.triggerTurn).toBe(false)
    expect(flushed[1]?.triggerTurn).toBe(true)
  })

  it('flushNow flushes both channels silently first, skipping empty channels', () => {
    vi.useFakeTimers()
    const { batcher, flushed } = makeBatcher()

    // Responsive-only: silent channel is empty and must be skipped.
    batcher.add(makeSubagent(1, 'task-1', 'done'), 'done', 'Done message')
    batcher.flushNow()
    expect(flushed).toHaveLength(1)
    expect(flushed[0]?.triggerTurn).toBe(true)

    // Both channels: silent flushes first.
    batcher.add(makeSubagent(2, 'task-2', 'running'), 'steer', 'Steer message')
    batcher.add(makeSubagent(3, 'task-3', 'done'), 'done', 'Done message')
    batcher.flushNow()

    expect(flushed).toHaveLength(3)
    expect(flushed[1]?.triggerTurn).toBe(false)
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

  it('routes each item to its channel with the right trigger-turn flag', () => {
    vi.useFakeTimers()
    const { batcher, flushed } = makeBatcher()

    batcher.add(makeSubagent(1, 'task-1', 'running'), 'steer', 'Steer message')
    batcher.add(makeSubagent(2, 'task-2', 'done'), 'done', 'Done message')
    batcher.flushNow()

    expect(flushed[0]?.messages).toEqual([
      expect.stringContaining('Steer message'),
    ])
    expect(flushed[0]?.triggerTurn).toBe(false)
    expect(flushed[1]?.messages).toEqual([
      expect.stringContaining('Done message'),
    ])
    expect(flushed[1]?.triggerTurn).toBe(true)
  })
})
