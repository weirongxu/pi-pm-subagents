import type {
  ExtensionAPI,
  ExtensionContext,
} from '@earendil-works/pi-coding-agent'

import { requiredRuntime } from '../coordinator/runtime.js'
import { resolveSubagentModelForSpawn } from '../models-config/subagent-model-utils.js'
import { baseToolsOf } from '../pm-mode.js'
import type { PmSubagentState } from '../types.js'
import { askHowToProceed } from '../ui/review-pager.js'
import type { PromptDefinition, ReviewOnEnd } from '../utils/markdown.js'
import { composeTools } from '../utils/tools.js'
import type { SpawnOptions } from './manager.js'
import {
  buildReviewOptions,
  createReviewedActions,
  nextRevisedTitle,
  resolveReviewName,
} from './review-utils.js'

export function buildSpawnOptions(
  pi: ExtensionAPI,
  state: PmSubagentState,
  ctx: ExtensionContext,
  role: PromptDefinition,
  roleName: string,
): SpawnOptions {
  const { manager, batcher } = requiredRuntime()
  const reviewOnEnd: ReviewOnEnd = role.fm.reviewOnEnd ?? false
  const reviewName = resolveReviewName(reviewOnEnd)

  const tools = composeTools(baseToolsOf(pi, state), {
    tools: role.fm.tools,
    extraTools: role.fm.extraTools,
    removeTools: role.fm.removeTools,
  })

  const model = resolveSubagentModelForSpawn(
    ctx,
    role.fm.model,
    state.sessionSubagentModel,
  )

  return {
    cwd: ctx.cwd,
    model,
    thinkingLevel: role.fm.thinkingLevel ?? 'low',
    tools,
    systemPrompt: role.systemPrompt,
    role: roleName,
    onComplete: async (subagent, lastMessage) => {
      if (state.mode !== 'coordinator') return
      if (subagent.record.status === 'killed') return
      if (!lastMessage) return
      if (subagent.record.status === 'failed') {
        batcher.add(subagent, 'done', lastMessage)
        return
      }
      if (!reviewOnEnd || !ctx.hasUI) {
        batcher.add(subagent, 'done', lastMessage)
        return
      }

      const actions = createReviewedActions({
        send: (message, corrections) => {
          batcher.addReviewed(subagent, message, corrections)
        },
        revise: (fullPrompt) =>
          manager.followup(
            subagent.record.id,
            nextRevisedTitle(subagent.record.title),
            fullPrompt,
          ),
      })
      await askHowToProceed(
        pi,
        ctx,
        buildReviewOptions({
          content: lastMessage,
          name: reviewName,
          actions,
        }),
      )
    },
  }
}
