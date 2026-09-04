import type { UserMessage } from '@earendil-works/pi-ai'
import type { SessionEntry } from '@earendil-works/pi-coding-agent'
import { describe, expect, it } from 'vitest'

import { getLastModesState } from './state.js'

function user(text: string): UserMessage {
  return {
    role: 'user',
    content: [{ type: 'text', text }],
    timestamp: Date.now(),
  }
}

describe('getLastModesState', () => {
  it('returns undefined for empty entries array', () => {
    const result = getLastModesState([])
    expect(result).toBeUndefined()
  })

  it('returns undefined when entries contain no custom entries', () => {
    const entries: SessionEntry[] = [
      {
        type: 'message',
        id: '1',
        parentId: null,
        timestamp: new Date().toISOString(),
        message: user('task'),
      },
    ]
    const result = getLastModesState(entries)
    expect(result).toBeUndefined()
  })

  it('returns undefined when custom entries have different type', () => {
    const entries: SessionEntry[] = [
      {
        type: 'custom',
        id: '1',
        parentId: null,
        timestamp: new Date().toISOString(),
        customType: 'other-key',
        data: {},
      },
    ]
    const result = getLastModesState(entries)
    expect(result).toBeUndefined()
  })

  it('returns modes state from the last matching custom entry', () => {
    const entries: SessionEntry[] = [
      {
        type: 'custom',
        id: '1',
        parentId: null,
        timestamp: new Date().toISOString(),
        customType: 'modes',
        data: {
          mode: 'coordinator',
        },
      },
      {
        type: 'custom',
        id: '2',
        parentId: null,
        timestamp: new Date().toISOString(),
        customType: 'modes',
        data: {
          mode: 'coordinator',
          modeDiffTools: { added: ['tool1'], removed: ['tool2'] },
        },
      },
    ]
    const result = getLastModesState(entries)
    expect(result).toEqual({
      mode: 'coordinator',
      modeDiffTools: { added: ['tool1'], removed: ['tool2'] },
    })
  })

  it('sanitizes stale plan mode to undefined', () => {
    const entries: SessionEntry[] = [
      {
        type: 'custom',
        id: '1',
        parentId: null,
        timestamp: new Date().toISOString(),
        customType: 'modes',
        data: {
          mode: 'plan',
          planMarkdown: 'stale plan',
        },
      },
    ]
    const result = getLastModesState(entries)
    expect(result).toEqual({ mode: undefined })
  })
})
