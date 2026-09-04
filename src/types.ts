export type ModeType = 'coordinator'

export interface ModeToolsDiff {
  added: string[]
  removed: string[]
}

export interface ModesState {
  mode: ModeType | undefined
  modeDiffTools?: ModeToolsDiff
  /** Current model captured before entering a read-only mode, restored on exit. */
  previousModel?: string
  /** Session-scoped subagent model. Source of truth for spawn. */
  sessionSubagentModel?: string
}
