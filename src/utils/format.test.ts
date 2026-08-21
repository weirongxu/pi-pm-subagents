import { describe, expect, it } from 'vitest'

import { truncateToBytes } from './format.js'

describe('truncateToBytes', () => {
  const defaultSuffix =
    '\n\n[Output truncated. Verify remaining details with read-only tools.]'

  it('returns original text when under byte limit', () => {
    const text = 'Hello world'
    const result = truncateToBytes(text, 100)
    expect(result).toBe(text)
  })

  it('truncates text when over byte limit and adds suffix', () => {
    const text = 'a'.repeat(100)
    const result = truncateToBytes(text, 50)
    const suffixBytes = Buffer.byteLength(defaultSuffix, 'utf8')
    const budget = Math.max(0, 50 - suffixBytes)
    expect(result.length).toBe(budget + defaultSuffix.length)
    expect(result.endsWith(defaultSuffix)).toBe(true)
  })

  it('truncates text to budget bytes when limit is small', () => {
    const text = 'Hello world'
    const maxBytes = 5
    const suffixBytes = Buffer.byteLength(defaultSuffix, 'utf8')
    const budget = Math.max(0, maxBytes - suffixBytes)
    const result = truncateToBytes(text, maxBytes)
    expect(result.length).toBe(budget + defaultSuffix.length)
    expect(result.endsWith(defaultSuffix)).toBe(true)
  })

  it('handles multibyte characters correctly', () => {
    const text = '你好世界你好世界你好世界你好世界你好世界'
    const maxBytes = 30
    const suffixBytes = Buffer.byteLength(defaultSuffix, 'utf8')
    const result = truncateToBytes(text, maxBytes)
    expect(result.endsWith(defaultSuffix)).toBe(true)
    const headBytes = Buffer.byteLength(
      result.slice(0, result.length - defaultSuffix.length),
      'utf8',
    )
    expect(headBytes).toBe(Math.max(0, maxBytes - suffixBytes))
  })

  it('handles mixed ASCII and multibyte characters', () => {
    const text = 'Hello你好World你好Test你好Data'
    const maxBytes = 20
    const suffixBytes = Buffer.byteLength(defaultSuffix, 'utf8')
    const result = truncateToBytes(text, maxBytes)
    expect(result.endsWith(defaultSuffix)).toBe(true)
    const headBytes = Buffer.byteLength(
      result.slice(0, result.length - defaultSuffix.length),
      'utf8',
    )
    expect(headBytes).toBe(Math.max(0, maxBytes - suffixBytes))
  })

  it('uses custom suffix', () => {
    const text = 'a'.repeat(100)
    const customSuffix = ' [truncated]'
    const result = truncateToBytes(text, 50, customSuffix)
    expect(result).toContain(customSuffix)
    expect(result).not.toContain(defaultSuffix)
  })

  it('handles empty string', () => {
    expect(truncateToBytes('', 100)).toBe('')
  })

  it('handles budget exactly zero when suffix bytes exceed limit', () => {
    const text = 'Hello'
    const result = truncateToBytes(text, 1)
    expect(result).toBe(defaultSuffix)
  })
})
