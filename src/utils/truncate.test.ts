import { describe, expect, it } from 'vitest'

import { truncateText } from './truncate.js'

describe('truncateText', () => {
  it('returns plain ASCII unchanged when it fits', () => {
    expect(truncateText('hello', 10)).toBe('hello')
    expect(truncateText('hello', 5)).toBe('hello')
  })

  it('truncates plain ASCII with ellipsis when too wide', () => {
    expect(truncateText('hello world', 8)).toBe('hello...')
  })

  it('preserves ANSI codes when truncating colored text', () => {
    const colored = '\x1b[31mhello world\x1b[0m'
    const result = truncateText(colored, 8)
    expect(result).toBe('\x1b[31mhello\x1b[0m...')
    expect(result).toContain('\x1b[31m')
  })

  it('pads to exactly maxWidth when pad is true', () => {
    expect(truncateText('hi', 5, '...', true)).toBe('hi   ')
    expect(truncateText('hello world', 8, '...', true)).toBe('hello...')
  })

  it('counts emoji as width 2', () => {
    expect(truncateText('👍👍', 4)).toBe('👍👍')
    expect(truncateText('👍👍👍', 5)).toBe('👍...')
  })

  it('pads empty text with spaces when pad is true', () => {
    expect(truncateText('', 4, '...', true)).toBe('    ')
    expect(truncateText('', 4)).toBe('')
  })

  it('returns empty string when maxWidth <= 0', () => {
    expect(truncateText('hello', 0)).toBe('')
    expect(truncateText('hello', -1)).toBe('')
  })
})
