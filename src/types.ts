import type { Static } from 'typebox'
import { Type } from 'typebox'

const ContextUsageSchema = Type.Object({
  tokens: Type.Union([Type.Number(), Type.Null()]),
  contextWindow: Type.Number(),
  percent: Type.Union([Type.Number(), Type.Null()]),
})

export const PmModeSchema = Type.Literal('coordinator')
export type PmMode = Static<typeof PmModeSchema>

export const SubagentStatusSchema = Type.Union([
  Type.Literal('running'),
  Type.Literal('done'),
  Type.Literal('failed'),
  Type.Literal('killed'),
])
export type SubagentStatus = Static<typeof SubagentStatusSchema>

export const SubagentBaseRecordSchema = Type.Object({
  title: Type.String(),
  status: SubagentStatusSchema,
  steerCount: Type.Number(),
  startedAt: Type.Number(),
  completedAt: Type.Optional(Type.Number()),
  contextUsage: Type.Optional(ContextUsageSchema),
})
export type SubagentBaseRecord = Static<typeof SubagentBaseRecordSchema>

export const SubagentRecordSchema = Type.Object({
  ...SubagentBaseRecordSchema.properties,
  id: Type.Number(),
  prompt: Type.String(),
  activeTools: Type.Array(Type.String()),
  role: Type.String(),
  cwd: Type.String(),
  sessionFile: Type.String(),
  previousEntries: Type.Array(SubagentBaseRecordSchema),
})
export type SubagentRecord = Static<typeof SubagentRecordSchema>

export const ModeToolsDiffSchema = Type.Object({
  added: Type.Array(Type.String()),
  removed: Type.Array(Type.String()),
})
export type ModeToolsDiff = Static<typeof ModeToolsDiffSchema>

export const PmSubagentStateSchema = Type.Object({
  mode: Type.Optional(PmModeSchema),
  modeDiffTools: Type.Optional(ModeToolsDiffSchema),
  /** Current model captured before entering a read-only mode, restored on exit. */
  previousModel: Type.Optional(Type.String()),
  /** Session-scoped subagent model. Source of truth for spawn. */
  sessionSubagentModel: Type.Optional(Type.String()),
  subagents: Type.Optional(Type.Array(SubagentRecordSchema)),
  maxSubagentId: Type.Number(),
})
export type PmSubagentState = Static<typeof PmSubagentStateSchema>
