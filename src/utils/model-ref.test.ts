import { describe, expect, it } from 'vitest'

import { parseModelRef } from './model-ref.js'

describe('parseModelRef', () => {
  it('parses valid provider/id format', () => {
    expect(parseModelRef('openai/gpt-4')).toEqual({
      provider: 'openai',
      id: 'gpt-4',
    })
  })

  it('parses provider/id with dashes in id', () => {
    expect(parseModelRef('anthropic/claude-3-5-sonnet')).toEqual({
      provider: 'anthropic',
      id: 'claude-3-5-sonnet',
    })
  })

  it('returns undefined for missing id', () => {
    expect(parseModelRef('openai/')).toBeUndefined()
  })

  it('returns undefined for missing provider', () => {
    expect(parseModelRef('/gpt-4')).toBeUndefined()
  })

  it('returns undefined for no slashes', () => {
    expect(parseModelRef('gpt-4')).toBeUndefined()
  })

  it('returns undefined for empty string', () => {
    expect(parseModelRef('')).toBeUndefined()
  })

  it('parses provider with underscores', () => {
    expect(parseModelRef('my_provider/model-name')).toEqual({
      provider: 'my_provider',
      id: 'model-name',
    })
  })
})
