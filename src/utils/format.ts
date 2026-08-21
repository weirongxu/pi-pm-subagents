import { truncateToWidth, visibleWidth } from '@earendil-works/pi-tui'

export function strInline(s: string): string {
  return s.split('\n').join('⮒ ')
}

export function rightAlign(left: string, right: string, width: number): string {
  const rightW = visibleWidth(right)
  const maxLeft = Math.max(0, width - rightW - 1)
  const leftClamped = truncateToWidth(left, maxLeft)
  const gap = Math.max(1, width - visibleWidth(leftClamped) - rightW)
  return truncateToWidth(leftClamped + ' '.repeat(gap) + right, width)
}

export function formatElapsed(item: {
  startedAt: number
  completedAt?: number
}): string {
  const end = item.completedAt ?? Date.now()
  const seconds = Math.max(0, Math.floor((end - item.startedAt) / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  return `${hours}h ${remainingMinutes}m ${remainingSeconds}s`
}

export function truncateToBytes(
  text: string,
  maxBytes: number,
  suffix = '\n\n[Output truncated. Verify remaining details with read-only tools.]',
): string {
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return text
  const suffixBytes = Buffer.byteLength(suffix, 'utf8')
  const budget = Math.max(0, maxBytes - suffixBytes)
  const head = Buffer.from(text, 'utf8').subarray(0, budget).toString('utf8')
  return `${head}${suffix}`
}
