import { describe, expect, it } from 'vitest'

import { countBy } from './collection.js'

describe('countBy', () => {
  it('returns an empty object for empty items', () => {
    expect(countBy([], (x) => x)).toEqual({})
  })

  it('accumulates counts for repeated keys', () => {
    expect(countBy(['a', 'b', 'a'], (x) => x)).toEqual({ a: 2, b: 1 })
  })

  it('counts by a key extracted from generic objects', () => {
    expect(countBy([{ s: 'x' }, { s: 'y' }, { s: 'x' }], (o) => o.s)).toEqual({
      x: 2,
      y: 1,
    })
  })

  it('supports non-identity key functions', () => {
    const items = [
      { id: 1, role: 'worker' },
      { id: 2, role: 'reviewer' },
      { id: 3, role: 'worker' },
      { id: 4, role: 'worker' },
    ]
    expect(countBy(items, (item) => item.role)).toEqual({
      worker: 3,
      reviewer: 1,
    })
  })
})
