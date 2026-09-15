import type { UserMessage } from '@earendil-works/pi-ai'
import type {
  ExtensionAPI,
  SessionEntry,
} from '@earendil-works/pi-coding-agent'
import { describe, expect, it, vi } from 'vitest'

import { type LiveSubagent, SubagentManager } from '../subagent/manager.js'
import type { SubagentRecord } from '../types.js'
import {
  createState,
  getLastPmSubagentState,
  persistSnapshot,
} from './state.js'

function customEntry(data: unknown): SessionEntry {
  return {
    type: 'custom',
    id: String(Math.random()),
    parentId: null,
    timestamp: new Date().toISOString(),
    customType: 'pm-subagents',
    data,
  }
}

function user(text: string): UserMessage {
  return {
    role: 'user',
    content: [{ type: 'text', text }],
    timestamp: Date.now(),
  }
}

describe('persistSnapshot', () => {
  it('snapshots the manager into state and persists', () => {
    const state = createState()
    const record: SubagentRecord = {
      id: 1,
      title: 'worker',
      prompt: 'do the thing',
      status: 'done',
      startedAt: 0,
      followUpCount: 0,
      activeTools: [],
      role: 'worker',
      cwd: '/tmp/proj',
      sessionFile: '/tmp/proj/sessions/x.jsonl',
      previousEntries: [],
    }
    const manager = new SubagentManager({ state })
    vi.spyOn(manager, 'list').mockReturnValue([{ record } as LiveSubagent])
    const appendEntry = vi.fn()
    const pi = { appendEntry } as unknown as ExtensionAPI

    persistSnapshot(pi, state, manager)

    expect(state.subagents).toEqual([record])

    expect(appendEntry).toHaveBeenCalledWith(
      'pm-subagents',
      expect.objectContaining({ mode: undefined, subagents: [record] }),
    )

    // Deep copies: mutating the snapshot must not affect the manager record.
    const snapshotted = state.subagents?.[0]
    if (!snapshotted) throw new Error('snapshot is empty')
    snapshotted.status = 'killed'
    expect(record.status).toBe('done')
  })
})

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
      maxSubagentId: 0,
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
    expect(result).toEqual({ mode: undefined, maxSubagentId: 0 })
  })

  it('returns valid subagents through a round-trip', () => {
    const subagents = [
      {
        id: 1,
        title: 'worker',
        prompt: 'do the thing',
        status: 'done',
        startedAt: 1,
        completedAt: 2,
        followUpCount: 0,
        activeTools: ['read'],
        role: 'worker',
        cwd: '/tmp/proj',
        sessionFile: '/tmp/proj/sessions/x.jsonl',
        previousEntries: [],
      },
    ]
    const result = getLastPmSubagentState([customEntry({ subagents })])
    expect(result?.subagents).toEqual(subagents)
  })

  it('filters out legacy subagents without cwd/sessionFile', () => {
    const result = getLastPmSubagentState([
      customEntry({
        subagents: [
          {
            id: 1,
            title: 'legacy',
            prompt: 'old record',
            status: 'done',
            startedAt: 1,
            followUpCount: 0,
            activeTools: [],
            role: 'worker',
            previousEntries: [],
          },
          {
            id: 2,
            title: 'fresh',
            prompt: 'new record',
            status: 'done',
            startedAt: 3,
            followUpCount: 0,
            activeTools: [],
            role: 'worker',
            cwd: '/tmp/proj',
            sessionFile: '/tmp/proj/sessions/x.jsonl',
            previousEntries: [],
          },
        ],
      }),
    ])

    expect(result?.subagents).toHaveLength(1)
    expect(result?.subagents?.[0]?.id).toBe(2)
  })

  it('round-trips a numeric maxSubagentId', () => {
    const result = getLastPmSubagentState([customEntry({ maxSubagentId: 5 })])
    expect(result?.maxSubagentId).toBe(5)
  })

  it('defaults a non-numeric maxSubagentId to 0', () => {
    const result = getLastPmSubagentState([customEntry({ maxSubagentId: '5' })])
    expect(result?.maxSubagentId).toBe(0)
  })
})
