import type {
  ExtensionAPI,
  SessionEntry,
} from '@earendil-works/pi-coding-agent'
import { Parse } from 'typebox/value'
import type { PmSubagentState } from '../types.js'
import { PmSubagentStateSchema } from '../types.js'
import type { SubagentManager } from '../subagent/manager.js'

export const PLUGIN_KEY = 'pm-subagents'

export function createState(): PmSubagentState {
  return { mode: undefined, maxSubagentId: 0 }
}

export function persist(pi: ExtensionAPI, state: PmSubagentState): void {
  const payload: PmSubagentState = {
    mode: state.mode,
    modeDiffTools: state.modeDiffTools,
    previousModel: state.previousModel,
    sessionSubagentModel: state.sessionSubagentModel,
    subagents: state.subagents,
    maxSubagentId: state.maxSubagentId,
  }
  pi.appendEntry(PLUGIN_KEY, structuredClone(payload))
}

export function persistSnapshot(
  pi: ExtensionAPI,
  state: PmSubagentState,
  manager: SubagentManager,
): void {
  state.subagents = manager.list().map(({ record }) => structuredClone(record))
  persist(pi, state)
}

export function getLastPmSubagentState(
  entries: readonly SessionEntry[],
): PmSubagentState | undefined {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]
    if (!entry || entry.type !== 'custom' || entry.customType !== PLUGIN_KEY)
      continue
    try {
      return Parse(PmSubagentStateSchema, entry.data)
    } catch {
      return undefined
    }
  }
  return undefined
}
