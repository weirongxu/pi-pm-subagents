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
      '5m 0s',
    )
    expect(
      formatElapsed(base({ startedAt: 0, completedAt: 10 * 60_000 })),
    ).toBe('10m 0s')
  })

  it('shows hours for >= 60min', () => {
    expect(
      formatElapsed(base({ startedAt: 0, completedAt: 2 * 60 * 60_000 })),
    ).toBe('2h 0m 0s')
    expect(
      formatElapsed(base({ startedAt: 0, completedAt: 24 * 60 * 60_000 })),
    ).toBe('24h 0m 0s')
  })

  it('handles boundary values', () => {
    expect(formatElapsed(base({ startedAt: 0, completedAt: 59_999 }))).toBe(
      '59s',
    )
    expect(formatElapsed(base({ startedAt: 0, completedAt: 60_000 }))).toBe(
      '1m 0s',
    )
    expect(
      formatElapsed(base({ startedAt: 0, completedAt: 59 * 60_000 })),
    ).toBe('59m 0s')
    expect(
      formatElapsed(base({ startedAt: 0, completedAt: 60 * 60_000 })),
    ).toBe('1h 0m 0s')
  })

  it('rounds down minutes', () => {
    expect(formatElapsed(base({ startedAt: 0, completedAt: 89_999 }))).toBe(
      '1m 29s',
    )
    expect(formatElapsed(base({ startedAt: 0, completedAt: 119_999 }))).toBe(
      '1m 59s',
    )
    expect(formatElapsed(base({ startedAt: 0, completedAt: 120_000 }))).toBe(
      '2m 0s',
    )
  })

  it('shows remainder seconds when >= 1 minute', () => {
    expect(
      formatElapsed(base({ startedAt: 0, completedAt: 5 * 60_000 + 30_000 })),
    ).toBe('5m 30s')
    expect(
      formatElapsed(base({ startedAt: 0, completedAt: 1 * 60_000 + 59_999 })),
    ).toBe('1m 59s')
  })

  it('shows remainder minutes and seconds when >= 1 hour', () => {
    expect(
      formatElapsed(
        base({
          startedAt: 0,
          completedAt: 2 * 60 * 60_000 + 5 * 60_000 + 30_000,
        }),
      ),
    ).toBe('2h 5m 30s')
    expect(
      formatElapsed(
        base({
          startedAt: 0,
          completedAt: 1 * 60 * 60_000 + 30 * 60_000 + 45_000,
        }),
      ),
    ).toBe('1h 30m 45s')
  })
})
