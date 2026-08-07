import { describe, expect, it } from 'vitest'

import { type FleetEntry, formatElapsed } from './fleet-list.js'

describe('formatElapsed', () => {
  const base = (
    overrides: Partial<FleetEntry> & { title?: never },
  ): FleetEntry => ({
    id: 1,
    title: '',
    startedAt: 1000,
    status: 'running',
    ...overrides,
  })

  it('rounds to whole seconds', () => {
    expect(formatElapsed(base({ startedAt: 0, completedAt: 12_400 }))).toBe(
      '12s',
    )
  })

  it('uses now when the worker is still running', () => {
    const now = Date.now()
    const worker = base({ startedAt: now - 3_600 })
    expect(formatElapsed(worker)).toBe('4s')
  })

  it('never goes negative', () => {
    expect(formatElapsed(base({ startedAt: 5_000, completedAt: 1_000 }))).toBe(
      '0s',
    )
  })
})
