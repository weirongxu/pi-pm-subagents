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
