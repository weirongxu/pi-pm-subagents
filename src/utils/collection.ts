// Group items into a Map keyed by keyOf; keys keep first-appearance order and items keep arrival order.
export function mapGroupBy<T, K>(
  items: readonly T[],
  keyOf: (item: T) => K,
): Map<K, T[]> {
  const groups = new Map<K, T[]>()
  for (const item of items) {
    const key = keyOf(item)
    const group = groups.get(key)
    if (group) group.push(item)
    else groups.set(key, [item])
  }
  return groups
}

export function countBy<T, K extends string>(
  items: readonly T[],
  keyOf: (item: T) => K,
): Record<K, number> {
  const counts = {} as Record<K, number>
  for (const item of items) {
    const key = keyOf(item)
    counts[key] = key in counts ? counts[key] + 1 : 1
  }
  return counts
}
