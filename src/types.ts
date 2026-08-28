export type ModeType = 'plan' | 'coordinator'

export interface ModesState {
  mode: ModeType | undefined
  planMarkdown?: string
  /** Active tools captured before entering a read-only mode, restored on exit. */
  previousActiveTools?: string[]
  /** Current model captured before entering a read-only mode, restored on exit. */
  previousModel?: string
  /** Session-scoped subagent model. Source of truth for spawn. */
  sessionSubagentModel?: string
  /** Transient: filter out planning context on the next LLM call. */
  clearContextOnNextTurn?: boolean
}
