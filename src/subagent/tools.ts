import {
  type AgentToolResult,
  defineTool,
  type ExtensionAPI,
} from '@earendil-works/pi-coding-agent'
import { orderBy } from 'lodash-es'
import { Type } from 'typebox'

import { requiredRuntime } from '../coordinator/runtime.js'
import { baseToolsOf } from '../pm-mode.js'
import { listRoles, resolveRole, rolesDescription } from '../prompts/roles.js'
import type { PmSubagentState } from '../types.js'
import { registerOptionalTools } from '../utils/tools.js'
import type { LiveSubagent } from './manager.js'
import type { SubagentManager } from './manager.js'
import {
  formatSubagentSummary,
  MAX_CONCURRENCY_SUBAGENT,
  MAX_REUSE_FOLLOWUPS,
} from './manager.js'
import { buildSpawnOptions } from './spawn-options.js'

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
  steer: 'subagent_steer',
  kill: 'subagent_kill',
  list: 'subagent_list',
} as const

const LIST_COOL_DOWN_MS = 1 * 60 * 1000

export function registerSubagentTools(
  pi: ExtensionAPI,
  state: PmSubagentState,
): void {
  let lastListAt = Date.now()

  pi.on('session_start', () => {
    const { manager, fleet } = requiredRuntime()
    const tools = [
      defineTool({
        name: SUBAGENT_TOOLS.list,
        label: 'List Subagents',
        description: `List all background subagents. For inspection only (user asks, or you suspect a stall) — never to wait for completion. After delegating, just end your turn; completions arrive automatically.`,
        parameters: Type.Object({}),
        async execute() {
          if (Date.now() - lastListAt < LIST_COOL_DOWN_MS)
            return {
              content: [
                {
                  type: 'text',
                  text: 'End your turn now — completions are delivered automatically.',
                },
              ],
              details: {},
              terminate: true,
            }

          lastListAt = Date.now()

          const allSubagents = manager.list()
          if (allSubagents.length === 0) {
            return {
              content: [{ type: 'text', text: 'No subagents.' }],
              details: {},
            }
          }

          const sorted = orderBy(allSubagents, (it) => it.record.id, 'desc')
          const lines = [`Subagents (${allSubagents.length}):`]
          for (const subagent of sorted) {
            lines.push(formatSubagentSummary(subagent))
          }

          const hasRunning = sorted.some(
            (subagent) => subagent.record.status === 'running',
          )
          if (hasRunning)
            lines.push(
              '',
              `Don't poll after this — end your turn; you'll be notified when subagents finish.`,
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
        description: `Delegate task to background with full tool access. Returns immediately with a subagent id; end your turn after delegating — the subagent's final message is delivered automatically. Never poll subagent_list or send status-check followups. Max concurrency ${MAX_CONCURRENCY_SUBAGENT} running subagents\n\nAvailable roles:\n${rolesDescription(baseToolsOf(pi, state))}`,
        promptGuidelines: [
          'Call subagent_delegate alone in a single tool batch, as the last action of your turn — its result ends the turn and subagent results are delivered automatically.',
        ],
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
          if (!role) {
            return toolResultFromError(
              new Error(
                `Role "${params.role}" not found. Available roles: ${listRoles().join(', ')}`,
              ),
            )
          }
          let subagent: LiveSubagent
          try {
            subagent = await manager.createNewSubagent(
              params.title,
              params.prompt,
              buildSpawnOptions(pi, state, ctx, role, params.role),
            )
            fleet.update()
          } catch (error) {
            return toolResultFromError(error)
          }

          stopSubagentOnAbort(signal, subagent.record.id, manager)

          return {
            content: [
              {
                type: 'text',
                text: `Subagent id #${subagent.record.id} is running in background. End your turn now; its final message will arrive automatically. Do not poll.`,
              },
            ],
            details: {
              subagentId: subagent.record.id,
              status: subagent.record.status,
            },
            terminate: true,
          }
        },
      }),

      defineTool({
        name: SUBAGENT_TOOLS.steer,
        label: 'Steer Subagent',
        description: `Continue working with an existing subagent (new instructions or feedback only — never status checks). Max reuse ${MAX_REUSE_FOLLOWUPS} times.`,
        promptGuidelines: [
          "Call subagent_steer alone in a single tool batch, as the last action of your turn — its result ends the turn and the subagent's final message is delivered automatically.",
        ],
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
            subagent = await manager.steerWithTitle(
              params.id,
              params.title,
              params.prompt,
            )
          } catch (error) {
            return toolResultFromError(error)
          }

          stopSubagentOnAbort(signal, subagent.record.id, manager)

          return {
            content: [
              {
                type: 'text',
                text: `Subagent #${subagent.record.id} continued. End your turn now; its final message will arrive automatically. Do not poll.`,
              },
            ],
            details: {
              subagentId: subagent.record.id,
              status: subagent.record.status,
            },
            terminate: true,
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
              : `Subagent #${params.id} is not running (status: ${subagent.record.status}).`
            return {
              content: [{ type: 'text', text: message }],
              details: {
                subagentId: params.id,
                status: subagent.record.status,
              },
            }
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error)
            return {
              content: [{ type: 'text', text: message }],
              details: {
                subagentId: params.id,
                status: subagent.record.status,
              },
            }
          }
        },
      }),
    ]

    registerOptionalTools(pi, tools, true)
  })
}
