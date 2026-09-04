import type {
  ExtensionAPI,
  SessionEntry,
} from '@earendil-works/pi-coding-agent'

import type { PmMode, PmSubagentState } from '../types.js'

export const PLUGIN_KEY = 'pm-subagents'

export function createState(): PmSubagentState {
  return { mode: undefined }
}

export function persist(pi: ExtensionAPI, state: PmSubagentState): void {
  pi.appendEntry(PLUGIN_KEY, {
    mode: state.mode,
    modeDiffTools: state.modeDiffTools,
    previousModel: state.previousModel,
    sessionSubagentModel: state.sessionSubagentModel,
  })
}

export function getLastPmSubagentState(
  entries: readonly SessionEntry[],
): Partial<PmSubagentState> | undefined {
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
    }
  }
  return undefined
}

function sanitizeMode(mode: string | undefined): PmMode | undefined {
  return mode === 'coordinator' ? 'coordinator' : undefined
}
