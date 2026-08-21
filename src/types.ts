export type ModeType = 'plan' | 'coordinator'

export interface ModesState {
  mode: ModeType | undefined
  planMarkdown?: string
  /** Active tools captured before entering a read-only mode, restored on exit. */
  previousActiveTools?: string[]
  /** Current model captured before entering a read-only mode, restored on exit. */
  previousModel?: string
}
