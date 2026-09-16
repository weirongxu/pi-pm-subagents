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
  persist,
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
      steerCount: 0,
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
      expect.objectContaining({
        mode: undefined,
        subagents: [record],
      }),
    )

    // Deep copies: mutating the persisted payload must not affect the record.
    const payload = appendEntry.mock.calls[0]?.[1] as {
      subagents?: SubagentRecord[]
    }
    const persisted = payload.subagents?.[0]
    if (!persisted) throw new Error('persisted payload is empty')
    persisted.status = 'killed'
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
          maxSubagentId: 0,
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
          maxSubagentId: 0,
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

  it('drops payloads with a stale mode value', () => {
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
    expect(result).toBeUndefined()
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
        steerCount: 0,
        activeTools: ['read'],
        role: 'worker',
        cwd: '/tmp/proj',
        sessionFile: '/tmp/proj/sessions/x.jsonl',
        previousEntries: [],
      },
    ]
    const result = getLastPmSubagentState([
      customEntry({ subagents, maxSubagentId: 0 }),
    ])
    expect(result?.subagents).toEqual(subagents)
  })

  it('reads nested previousEntries steerCount directly', () => {
    const result = getLastPmSubagentState([
      customEntry({
        subagents: [
          {
            id: 1,
            title: 'worker',
            prompt: 'p',
            status: 'done',
            startedAt: 1,
            steerCount: 3,
            activeTools: [],
            role: 'worker',
            cwd: '/tmp/proj',
            sessionFile: '/tmp/proj/sessions/x.jsonl',
            previousEntries: [
              {
                title: 'older',
                status: 'done',
                startedAt: 0,
                completedAt: 1,
                steerCount: 2,
              },
            ],
          },
        ],
        maxSubagentId: 1,
      }),
    ])

    expect(result?.subagents?.[0]).toMatchObject({
      steerCount: 3,
      previousEntries: [{ steerCount: 2, title: 'older' }],
    })
  })

  it('abandons legacy payloads whose subagents only carry followUpCount', () => {
    // Breaking migration: records written before the steerCount rename are
    // no longer restorable; the whole entry is dropped.
    const result = getLastPmSubagentState([
      customEntry({
        subagents: [
          {
            id: 1,
            title: 'worker',
            prompt: 'p',
            status: 'done',
            startedAt: 1,
            followUpCount: 1,
            activeTools: [],
            role: 'worker',
            cwd: '/tmp/proj',
            sessionFile: '/tmp/proj/sessions/x.jsonl',
          },
        ],
      }),
    ])

    expect(result).toBeUndefined()
  })

  it('drops payloads with malformed subagent rows without throwing', () => {
    const result = getLastPmSubagentState([
      customEntry({
        subagents: [
          'not-an-object',
          null,
          {
            id: 1,
            title: 'no count',
            prompt: 'p',
            status: 'done',
            startedAt: 1,
            activeTools: [],
            role: 'worker',
            cwd: '/tmp/proj',
            sessionFile: '/tmp/proj/sessions/x.jsonl',
          },
          {
            id: 2,
            title: 'bad count type',
            prompt: 'p',
            status: 'done',
            startedAt: 1,
            followUpCount: 'many',
            activeTools: [],
            role: 'worker',
            cwd: '/tmp/proj',
            sessionFile: '/tmp/proj/sessions/x.jsonl',
          },
          {
            id: 3,
            title: 'valid',
            prompt: 'p',
            status: 'done',
            startedAt: 1,
            followUpCount: 4,
            activeTools: [],
            role: 'worker',
            cwd: '/tmp/proj',
            sessionFile: '/tmp/proj/sessions/x.jsonl',
          },
        ],
      }),
    ])

    // A single malformed row invalidates the whole payload.
    expect(result).toBeUndefined()
  })

  it('keeps steerCount on the disk payload when persisting', () => {
    const appendEntry = vi.fn()
    const pi = { appendEntry } as unknown as ExtensionAPI
    const state = getLastPmSubagentState([
      customEntry({
        subagents: [
          {
            id: 1,
            title: 'worker',
            prompt: 'p',
            status: 'done',
            startedAt: 1,
            steerCount: 7,
            activeTools: [],
            role: 'worker',
            cwd: '/tmp/proj',
            sessionFile: '/tmp/proj/sessions/x.jsonl',
            previousEntries: [],
          },
        ],
        maxSubagentId: 1,
      }),
    ])
    if (!state) throw new Error('state is missing')

    persist(pi, state)

    const payload = appendEntry.mock.calls[0]?.[1] as {
      subagents?: { steerCount?: number }[]
    }
    expect(payload.subagents?.[0]?.steerCount).toBe(7)
    expect(JSON.stringify(appendEntry.mock.calls[0]?.[1])).not.toContain(
      'followUpCount',
    )
  })

  it('abandons the whole payload when a fresh subagent is mixed with a legacy one', () => {
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

    expect(result).toBeUndefined()
  })

  it('round-trips a numeric maxSubagentId', () => {
    const result = getLastPmSubagentState([customEntry({ maxSubagentId: 5 })])
    expect(result?.maxSubagentId).toBe(5)
  })

  it('drops payloads with a non-numeric maxSubagentId', () => {
    const result = getLastPmSubagentState([customEntry({ maxSubagentId: '5' })])
    expect(result).toBeUndefined()
  })
})
