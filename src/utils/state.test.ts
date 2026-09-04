import type { UserMessage } from '@earendil-works/pi-ai'
import type { SessionEntry } from '@earendil-works/pi-coding-agent'
import { describe, expect, it } from 'vitest'

import { getLastPmSubagentState } from './state.js'

function user(text: string): UserMessage {
  return {
    role: 'user',
    content: [{ type: 'text', text }],
    timestamp: Date.now(),
  }
}

describe('getLastPmSubagentState', () => {
  it('returns undefined for empty entries array', () => {
    const result = getLastPmSubagentState([])
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
    const result = getLastPmSubagentState(entries)
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
    const result = getLastPmSubagentState(entries)
    expect(result).toBeUndefined()
  })

  it('returns pm-subagents state from the last matching custom entry', () => {
    const entries: SessionEntry[] = [
      {
        type: 'custom',
        id: '1',
        parentId: null,
        timestamp: new Date().toISOString(),
        customType: 'pm-subagents',
        data: {
          mode: 'coordinator',
        },
      },
      {
        type: 'custom',
        id: '2',
        parentId: null,
        timestamp: new Date().toISOString(),
        customType: 'pm-subagents',
        data: {
          mode: 'coordinator',
          modeDiffTools: { added: ['tool1'], removed: ['tool2'] },
        },
      },
    ]
    const result = getLastPmSubagentState(entries)
    expect(result).toEqual({
      mode: 'coordinator',
      modeDiffTools: { added: ['tool1'], removed: ['tool2'] },
    })
  })

  it('sanitizes stale mode to undefined', () => {
    const entries: SessionEntry[] = [
      {
        type: 'custom',
        id: '1',
        parentId: null,
        timestamp: new Date().toISOString(),
        customType: 'pm-subagents',
        data: {
          mode: 'plan',
          planMarkdown: 'stale plan',
        },
      },
    ]
    const result = getLastPmSubagentState(entries)
    expect(result).toEqual({ mode: undefined })
  })
})
