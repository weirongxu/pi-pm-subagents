import {
  type AgentToolResult,
  defineTool,
  type ExtensionAPI,
} from '@earendil-works/pi-coding-agent'
import { orderBy } from 'lodash-es'
import { Type } from 'typebox'

import { resolveSubagentModelForSpawn } from '../models-config/subagent-model-utils.js'
import { baseToolsOf } from '../pm-mode.js'
import { resolveRole, rolesDescription } from '../prompts/roles.js'
import type { PmSubagentState } from '../types.js'
import { askHowToProceed } from '../ui/review-pager.js'
import type { ReviewOnEnd } from '../utils/markdown.js'
import { composeTools, registerOptionalTools } from '../utils/tools.js'
import type { MessageBatcher } from './batcher.js'
import type { FleetList } from './fleet.js'
import type { LiveSubagent } from './manager.js'
import type { SubagentManager } from './manager.js'
import {
  formatSubagentSummary,
  MAX_CONCURRENCY_SUBAGENT,
  MAX_REUSE_FOLLOWUPS,
} from './manager.js'
import {
  buildReviewOptions,
  nextRevisedTitle,
  resolveReviewName,
} from './review-utils.js'

function toolResultFromError(error: unknown): AgentToolResult<unknown> {
  const message = error instanceof Error ? error.message : String(error)
  return { content: [{ type: 'text', text: message }], details: {} }
}

const stopSubagentOnAbort = (
  signal: AbortSignal | undefined,
  id: number,
  manager: SubagentManager,
): void => {
  if (!signal) return
  const stop = (): void => {
    void manager.abort(id)
  }
  if (signal.aborted) stop()
  else signal.addEventListener('abort', stop, { once: true })
}

export const SUBAGENT_TOOLS = {
  delegate: 'subagent_delegate',
  followup: 'subagent_followup',
  kill: 'subagent_kill',
  list: 'subagent_list',
} as const

const LIST_COOL_DOWN_MS = 1 * 60 * 1000

export function registerSubagentTools(
  pi: ExtensionAPI,
  state: PmSubagentState,
  manager: SubagentManager,
  fleet: FleetList,
  batcher: MessageBatcher,
): void {
  let lastListAt = Date.now()

  pi.on('session_start', () => {
    const tools = [
      defineTool({
        name: SUBAGENT_TOOLS.list,
        label: 'List Subagents',
        description: `List all background subagents, don't poll this tool to wait subagents complete, just wait silently`,
        parameters: Type.Object({}),
        async execute() {
          if (Date.now() - lastListAt < LIST_COOL_DOWN_MS)
            return {
              content: [
                {
                  type: 'text',
                  text: "Please don't poll for this tool, just wait silently",
                },
              ],
              details: {},
            }

          lastListAt = Date.now()

          const allSubagents = manager.list()
          if (allSubagents.length === 0) {
            return {
              content: [{ type: 'text', text: 'No subagents.' }],
              details: {},
            }
          }

          const sorted = orderBy(allSubagents, (it) => it.id, 'desc')
          const lines = [`Subagents (${allSubagents.length}):`]
          for (const subagent of sorted) {
            lines.push(formatSubagentSummary(subagent))
          }

          const hasRunning = sorted.some(
            (subagent) => subagent.status === 'running',
          )
          if (hasRunning)
            lines.push(
              '',
              `DO NOT POLL THIS TOOL TO WAIT FOR SUBAGENTS COMPLETION, JUST WAIT SILENTLY, YOU WILL BE NOTIFIED WHEN SUBAGENTS FINISH.`,
            )
          return {
            content: [
              {
                type: 'text',
                text: lines.join('\n'),
              },
            ],
            details: {},
          }
        },
      }),

      defineTool({
        name: SUBAGENT_TOOLS.delegate,
        label: 'Delegate Subagent',
        description: `Delegate task to background with full tool access. The tool returns immediately with a subagent id; I'll send you last message when subagent finishes. Max concurrency ${MAX_CONCURRENCY_SUBAGENT} running subagents\nAvailable roles:\n${rolesDescription(baseToolsOf(pi, state))}`,
        parameters: Type.Object({
          title: Type.String(),
          prompt: Type.String({
            description: 'Prompt of the subagent should do',
          }),
          role: Type.String({
            description: `Role of subagent`,
          }),
        }),
        async execute(
          _toolCallId,
          params,
          signal,
          _onUpdate,
          ctx,
        ): Promise<AgentToolResult<unknown>> {
          const role = resolveRole(params.role)
          const reviewOnEnd: ReviewOnEnd = role.fm.reviewOnEnd ?? false

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

          let subagent: LiveSubagent
          try {
            subagent = await manager.createNewSubagent(
              params.title,
              params.prompt,
              {
                cwd: ctx.cwd,
                model,
                thinkingLevel: role.fm.thinkingLevel ?? 'low',
                tools,
                systemPrompt: role.systemPrompt,
                role: params.role,
                onComplete: async (subagent, lastMessage) => {
                  if (state.mode !== 'coordinator') return
                  if (subagent.status === 'killed') return
                  if (!lastMessage) return
                  if (subagent.status === 'failed') {
                    batcher.add(subagent, 'done', lastMessage)
                    return
                  }
                  if (!reviewOnEnd || !ctx.hasUI) {
                    batcher.add(subagent, 'done', lastMessage)
                    return
                  }

                  await askHowToProceed(
                    pi,
                    ctx,
                    buildReviewOptions({
                      content: lastMessage,
                      name: resolveReviewName(reviewOnEnd),
                      actions: {
                        send(message) {
                          batcher.add(subagent, 'reviewed', message)
                        },
                        async revise(updatePrompt) {
                          await manager.followup(
                            subagent.id,
                            nextRevisedTitle(subagent.title),
                            updatePrompt,
                          )
                        },
                      },
                    }),
                  )
                },
              },
            )
            fleet.update()
          } catch (error) {
            return toolResultFromError(error)
          }

          stopSubagentOnAbort(signal, subagent.id, manager)

          return {
            content: [
              {
                type: 'text',
                text: `Subagent id #${subagent.id} running at background. I'll send you last message when it finishes.`,
              },
            ],
            details: { subagentId: subagent.id, status: subagent.status },
          }
        },
      }),

      defineTool({
        name: SUBAGENT_TOOLS.followup,
        label: 'Follow Up Subagent',
        description: `Continue working with an existing subagent. Max reuse ${MAX_REUSE_FOLLOWUPS} times.`,
        parameters: Type.Object({
          id: Type.Number(),
          title: Type.String(),
          prompt: Type.String({
            description: 'Prompt of the subagent should do',
          }),
        }),
        async execute(
          _toolCallId,
          params,
          signal,
        ): Promise<AgentToolResult<unknown>> {
          let subagent: LiveSubagent
          try {
            subagent = await manager.followup(
              params.id,
              params.title,
              params.prompt,
            )
          } catch (error) {
            return toolResultFromError(error)
          }

          stopSubagentOnAbort(signal, subagent.id, manager)

          return {
            content: [
              {
                type: 'text',
                text: `Subagent #${subagent.id} continued. I'll send you last message when it finishes.`,
              },
            ],
            details: { subagentId: subagent.id, status: subagent.status },
          }
        },
      }),

      defineTool({
        name: SUBAGENT_TOOLS.kill,
        label: 'Kill Subagent',
        description: 'Kill a running subagent by id.',
        parameters: Type.Object({
          id: Type.Number({ description: 'Subagent id to stop.' }),
        }),
        async execute(_toolCallId, params): Promise<AgentToolResult<unknown>> {
          const subagent = manager.get(params.id)
          if (!subagent) {
            return {
              content: [
                { type: 'text', text: `Subagent #${params.id} not found.` },
              ],
              details: {},
            }
          }
          try {
            const stopped = await manager.abort(params.id)
            const message = stopped
              ? `Subagent #${params.id} killed.`
              : `Subagent #${params.id} is not running (status: ${subagent.status}).`
            return {
              content: [{ type: 'text', text: message }],
              details: { subagentId: params.id, status: subagent.status },
            }
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error)
            return {
              content: [{ type: 'text', text: message }],
              details: { subagentId: params.id, status: subagent.status },
            }
          }
        },
      }),
    ]

    registerOptionalTools(pi, tools, true)
  })
}
