import { countBy, mapGroupBy } from './collection.js'
import { describe, expect, it } from 'vitest'

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

describe('mapGroupBy', () => {
  it('returns an empty map for empty items', () => {
    expect(mapGroupBy([], (x) => x)).toEqual(new Map())
  })

  it('groups items by the keyOf function', () => {
    expect(mapGroupBy(['a', 'b', 'a'], (x) => x)).toEqual(
      new Map([
        ['a', ['a', 'a']],
        ['b', ['b']],
      ]),
    )
  })

  it('keeps keys in first-appearance order', () => {
    const groups = mapGroupBy(['b', 'a', 'b'], (x) => x)
    expect([...groups.keys()]).toEqual(['b', 'a'])
  })

  it('keeps arrival order within each group', () => {
    const groups = mapGroupBy(
      [
        { k: 'x', n: 1 },
        { k: 'y', n: 2 },
        { k: 'x', n: 3 },
      ],
      (item) => item.k,
    )
    expect(groups.get('x')).toEqual([
      { k: 'x', n: 1 },
      { k: 'x', n: 3 },
    ])
  })
})
