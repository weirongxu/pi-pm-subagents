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

  it('rounds down to whole seconds', () => {
    expect(formatElapsed(base({ startedAt: 0, completedAt: 12_400 }))).toBe(
      '12s',
    )
  })

  it('uses now when the worker is still running', () => {
    const now = Date.now()
    const worker = base({ startedAt: now - 4_000 })
    expect(formatElapsed(worker)).toBe('4s')
  })

  it('never goes negative', () => {
    expect(formatElapsed(base({ startedAt: 5_000, completedAt: 1_000 }))).toBe(
      '0s',
    )
  })

  it('shows minutes for >= 60s', () => {
    expect(formatElapsed(base({ startedAt: 0, completedAt: 5 * 60_000 }))).toBe(
      '5m',
    )
    expect(formatElapsed(base({ startedAt: 0, completedAt: 10 * 60_000 }))).toBe(
      '10m',
    )
  })

  it('shows hours for >= 60min', () => {
    expect(
      formatElapsed(base({ startedAt: 0, completedAt: 2 * 60 * 60_000 })),
    ).toBe('2h')
    expect(
      formatElapsed(base({ startedAt: 0, completedAt: 24 * 60 * 60_000 })),
    ).toBe('24h')
  })

  it('handles boundary values', () => {
    expect(formatElapsed(base({ startedAt: 0, completedAt: 59_999 }))).toBe(
      '59s',
    )
    expect(formatElapsed(base({ startedAt: 0, completedAt: 60_000 }))).toBe(
      '1m',
    )
    expect(formatElapsed(base({ startedAt: 0, completedAt: 59 * 60_000 }))).toBe(
      '59m',
    )
    expect(
      formatElapsed(base({ startedAt: 0, completedAt: 60 * 60_000 })),
    ).toBe('1h')
  })

  it('rounds down minutes', () => {
    expect(formatElapsed(base({ startedAt: 0, completedAt: 89_999 }))).toBe(
      '1m',
    )
    expect(formatElapsed(base({ startedAt: 0, completedAt: 119_999 }))).toBe(
      '1m',
    )
    expect(formatElapsed(base({ startedAt: 0, completedAt: 120_000 }))).toBe(
      '2m',
    )
  })
})
