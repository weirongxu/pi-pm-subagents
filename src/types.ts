import type { ContextUsage } from '@earendil-works/pi-coding-agent'

export type SubagentStatus = 'running' | 'done' | 'failed' | 'killed'

export interface SubagentBaseRecord {
  title: string
  status: SubagentStatus
  followUpCount: number
  startedAt: number
  completedAt?: number
  contextUsage?: ContextUsage
}

export interface SubagentRecord extends SubagentBaseRecord {
  id: number
  prompt: string
  activeTools: string[]
  role: string
  cwd: string
  sessionFile: string
  previousEntries: SubagentBaseRecord[]
}

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
  subagents?: SubagentRecord[]
  maxSubagentId: number
}
