import type {
  ExtensionAPI,
  SessionEntry,
} from '@earendil-works/pi-coding-agent'

import type { ModesState, ModeType } from '../types.js'

export const STATE_KEY = 'modes'

export function createState(): ModesState {
  return { mode: undefined }
}

export function persist(pi: ExtensionAPI, state: ModesState): void {
  pi.appendEntry(STATE_KEY, {
    mode: state.mode,
    modeDiffTools: state.modeDiffTools,
    previousModel: state.previousModel,
    sessionSubagentModel: state.sessionSubagentModel,
  })
}

export function getLastModesState(
  entries: readonly SessionEntry[],
): Partial<ModesState> | undefined {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]
    if (!entry || entry.type !== 'custom' || entry.customType !== STATE_KEY)
      continue
    const data = entry.data as
      (Partial<ModesState> & { mode?: string }) | undefined
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

function sanitizeMode(mode: string | undefined): ModeType | undefined {
  return mode === 'coordinator' ? 'coordinator' : undefined
}
