import type { ContextUsage } from '@earendil-works/pi-coding-agent'
import { visibleWidth } from '@earendil-works/pi-tui'

import { truncateText } from './truncate.js'

export function strInline(s: string): string {
  return s.split('\n').join('⮒ ')
}

export function rightAlign(left: string, right: string, width: number): string {
  const rightW = visibleWidth(right)
  const maxLeft = Math.max(0, width - rightW - 1)
  const leftClamped = truncateText(left, maxLeft)
  const gap = Math.max(1, width - visibleWidth(leftClamped) - rightW)
  return truncateText(leftClamped + ' '.repeat(gap) + right, width)
}

export function formatTokens(count: number): string {
  if (count < 1000) return count.toString()
  if (count < 10000) return `${(count / 1000).toFixed(1)}k`
  if (count < 1000000) return `${Math.round(count / 1000)}k`
  if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`
  return `${Math.round(count / 1000000)}M`
}

export function formatContextUsage(usage: ContextUsage | undefined): string {
  if (
    usage === undefined ||
    usage.contextWindow === 0 ||
    usage.tokens === null
  ) {
    return '?'
  }
  return `${formatTokens(usage.tokens)}/${formatTokens(usage.contextWindow)}`
}

export function formatElapsed(item: {
  startedAt: number
  completedAt?: number
}): string {
  const end = item.completedAt ?? Date.now()
  const ms = Math.max(0, end - item.startedAt)
  return formatElapsedMs(ms)
}

export function formatElapsedMs(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  if (minutes < 60) return `${minutes}m${remainingSeconds}s`
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  return `${hours}h${remainingMinutes}m${remainingSeconds}s`
}

export function truncateToBytes(
  text: string,
  maxBytes: number,
  suffix = '\n\n[Output truncated.]',
): string {
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return text
  const suffixBytes = Buffer.byteLength(suffix, 'utf8')
  const budget = Math.max(0, maxBytes - suffixBytes)
  const head = Buffer.from(text, 'utf8').subarray(0, budget).toString('utf8')
  return `${head}${suffix}`
}
