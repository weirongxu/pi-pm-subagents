import { describe, expect, it } from 'vitest'

import {
  isSubagentSpawnContext,
  runInSubagentSpawnContext,
  SUBAGENT_SESSION_ID_PREFIX,
} from './identity.js'

describe('subagent spawn context', () => {
  it('is false outside of spawn windows', () => {
    expect(isSubagentSpawnContext()).toBe(false)
  })

  it('keeps the stable session id prefix', () => {
    expect(SUBAGENT_SESSION_ID_PREFIX).toBe('pi-pm-subagents-subagent-')
  })

  it('is true inside a spawn window', async () => {
    await runInSubagentSpawnContext(7, async () => {
      expect(isSubagentSpawnContext()).toBe(true)
    })
    expect(isSubagentSpawnContext()).toBe(false)
  })

  it('propagates across await boundaries', async () => {
    await runInSubagentSpawnContext(3, async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(isSubagentSpawnContext()).toBe(true)
    })
  })
})
