export type ModeUserType = 'plan' | 'manager'

export type ModeRole = ModeUserType | 'subagent'

export interface ModesState {
  mode: ModeUserType | undefined
  planMarkdown?: string
  /** Active tools captured before entering a read-only mode, restored on exit. */
  toolsBackup?: string[]
  /** Main-session model ref captured before switching to a role model, restored on exit. */
  modelBackup?: string
}
