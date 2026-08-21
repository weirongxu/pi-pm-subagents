import type {
  ExtensionAPI,
  SessionEntry,
} from '@earendil-works/pi-coding-agent'

import type { ModesState } from '../types.js'

export const STATE_KEY = 'modes'

export function createState(): ModesState {
  return { mode: undefined }
}

export function persist(pi: ExtensionAPI, state: ModesState): void {
  pi.appendEntry(STATE_KEY, {
    mode: state.mode,
    planMarkdown: state.planMarkdown,
    previousActiveTools: state.previousActiveTools,
    previousModel: state.previousModel,
  })
}

export function getLastModesState(
  entries: readonly SessionEntry[],
): Partial<ModesState> | undefined {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]
    if (!entry || entry.type !== 'custom' || entry.customType !== STATE_KEY)
      continue
    return entry.data as Partial<ModesState> | undefined
  }
  return undefined
}

export function restoreTools(pi: ExtensionAPI, state: ModesState): void {
  if (state.previousActiveTools) pi.setActiveTools(state.previousActiveTools)
  state.previousActiveTools = undefined
}
