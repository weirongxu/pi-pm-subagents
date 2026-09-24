import type {
  ExtensionAPI,
  ExtensionContext,
} from '@earendil-works/pi-coding-agent'
import type { PromptDefinition, ReviewOnEnd } from '../utils/markdown.js'
import {
  buildReviewOptions,
  nextRevisedTitle,
  resolveReviewName,
  saveReviewFile,
} from './review-utils.js'
import type { PmSubagentState } from '../types.js'
import type { SpawnOptions } from './manager.js'
import { askHowToProceed } from '../ui/review-pager.js'
import { baseToolsOf } from '../pm-mode.js'
import { composeTools } from '../utils/tools.js'
import { requiredRuntime } from '../coordinator/runtime.js'
import { resolveSubagentModelForSpawn } from '../models-config/subagent-model-utils.js'

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
      if (!reviewName || !ctx.hasUI) {
        batcher.add(subagent, 'done', lastMessage)
        return
      }

      await askHowToProceed(
        ctx,
        buildReviewOptions({
          content: lastMessage,
          name: reviewName,
          send: (message) => {
            batcher.add(subagent, 'reviewed', message)
          },
          revise: async (fullPrompt) => {
            await manager.steer(subagent.record.id, fullPrompt, {
              title: nextRevisedTitle(subagent.record.title),
            })
            batcher.add(subagent, 'steer', fullPrompt)
          },
          save: async () => {
            try {
              const path = await saveReviewFile(
                ctx.cwd,
                reviewName,
                lastMessage,
              )
              ctx.ui.notify(`Saved to ${path}`, 'info')
            } catch (error) {
              ctx.ui.notify(
                error instanceof Error ? error.message : String(error),
                'error',
              )
            }
          },
        }),
      )
    },
  }
}
