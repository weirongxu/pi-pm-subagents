export type PmMode = 'coordinator'

export interface ModeToolsDiff {
  added: string[]
  removed: string[]
}

export interface PmSubagentState {
  mode: PmMode | undefined
  modeDiffTools?: ModeToolsDiff
  /** Current model captured before entering a read-only mode, restored on exit. */
  previousModel?: string
  /** Session-scoped subagent model. Source of truth for spawn. */
  sessionSubagentModel?: string
}
