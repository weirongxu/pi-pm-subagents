export type ModeUserType = 'plan' | 'manager'

export interface ModesState {
  mode: ModeUserType | undefined
  planMarkdown?: string
  /** Active tools captured before entering a read-only mode, restored on exit. */
  toolsBackup?: string[]
}
