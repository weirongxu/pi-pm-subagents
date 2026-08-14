export type ModeUserType = 'plan' | 'coordinator'

export interface ModesState {
  mode: ModeUserType | undefined
  planMarkdown?: string
  /** Active tools captured before entering a read-only mode, restored on exit. */
  toolsBackup?: string[]
}
