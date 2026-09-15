import type {
  ExtensionAPI,
  SessionEntry,
} from '@earendil-works/pi-coding-agent'

import type { SubagentManager } from '../subagent/manager.js'
import type { PmMode, PmSubagentState, SubagentRecord } from '../types.js'

export const PLUGIN_KEY = 'pm-subagents'

export function createState(): PmSubagentState {
  return { mode: undefined, maxSubagentId: 0 }
}

export function persist(pi: ExtensionAPI, state: PmSubagentState): void {
  pi.appendEntry(PLUGIN_KEY, {
    mode: state.mode,
    modeDiffTools: state.modeDiffTools,
    previousModel: state.previousModel,
    sessionSubagentModel: state.sessionSubagentModel,
    subagents: state.subagents,
    maxSubagentId: state.maxSubagentId,
  })
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
    const data = entry.data as
      (Partial<PmSubagentState> & { mode?: string }) | undefined
    if (!data) return undefined
    return {
      mode: sanitizeMode(data.mode),
      modeDiffTools: data.modeDiffTools,
      previousModel: data.previousModel,
      sessionSubagentModel: data.sessionSubagentModel,
      subagents: sanitizeSubagents(data.subagents),
      maxSubagentId:
        typeof data.maxSubagentId === 'number' ? data.maxSubagentId : 0,
    }
  }
  return undefined
}

function sanitizeMode(mode: string | undefined): PmMode | undefined {
  return mode === 'coordinator' ? 'coordinator' : undefined
}

/** Drop legacy records that predate cwd/sessionFile — they cannot be restored. */
function sanitizeSubagents(
  subagents: SubagentRecord[] | undefined,
): SubagentRecord[] | undefined {
  if (!subagents) return undefined
  return subagents.filter((record) => record.cwd && record.sessionFile)
}
