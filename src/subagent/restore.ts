import type {
  ExtensionAPI,
  ExtensionContext,
} from '@earendil-works/pi-coding-agent'

import { requiredRuntime } from '../coordinator/runtime.js'
import { EMPTY_ROLE, resolveRole } from '../prompts/roles.js'
import type { PmSubagentState, SubagentRecord } from '../types.js'
import { buildSpawnOptions } from './spawn-options.js'

export async function restoreSubagents(
  pi: ExtensionAPI,
  state: PmSubagentState,
  ctx: ExtensionContext,
  records: readonly SubagentRecord[] | undefined,
): Promise<number> {
  if (!records?.length) return 0
  const { manager } = requiredRuntime()
  let restored = 0
  let failed = 0

  for (const record of records) {
    const { systemPrompt, onComplete } = buildSpawnOptions(
      pi,
      state,
      ctx,
      resolveRole(record.role) ?? EMPTY_ROLE,
      record.role,
    )
    const result = await manager.restore(record, {
      systemPrompt,
      onComplete,
    })
    if (result === 'restored') restored++
    else if (result === 'failed') failed++
  }

  if (restored > 0 || failed > 0) {
    const parts: string[] = []
    if (restored > 0) parts.push(`restored ${restored}`)
    if (failed > 0) parts.push(`failed ${failed}`)
    ctx.ui.notify(
      `Subagent restore from previous session: ${parts.join(', ')}`,
      failed > 0 ? 'warning' : 'info',
    )
  }
  return restored
}
