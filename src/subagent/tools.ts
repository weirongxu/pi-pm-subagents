import {
  type AgentToolResult,
  defineTool,
  type ExtensionAPI,
} from '@earendil-works/pi-coding-agent'
import { orderBy } from 'lodash-es'
import { Type } from 'typebox'

import { getPiModesConfig, resolveModelRef } from '../models-config.js'
import { registerOptionalTools } from '../pi-utils.js'
import { composeTools } from '../prompts/core.js'
import { resolveRole, rolesDescription } from '../prompts/roles.js'
import type { ModesState } from '../types.js'
import type { FleetList } from './fleet.js'
import type { SubagentManager } from './manager.js'
import {
  formatSubagentSummary,
  type LiveSubagent,
  MAX_CONCURRENCY_SUBAGENT,
  MAX_REUSE_FOLLOWUPS,
} from './manager.js'

export const SUBAGENT_TOOLS = {
  delegate: 'subagent_delegate',
  kill: 'subagent_kill',
  list: 'subagent_list',
} as const

export function registerSubagentTools(
  pi: ExtensionAPI,
  state: ModesState,
  manager: SubagentManager,
  fleet: FleetList,
): void {
  const tools = [
    defineTool({
      name: SUBAGENT_TOOLS.list,
      label: 'List Subagents',
      description: `List all background subagents, don't use ${SUBAGENT_TOOLS.list} to wait subagents finished just idle`,
      parameters: Type.Object({}),
      async execute() {
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
            `DO NOT POLL ${SUBAGENT_TOOLS.list} TO WAIT FOR COMPLETION, JUST IDLE, YOU WILL BE NOTIFIED WHEN SUBAGENTS FINISH.`,
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
      description: `Delegate task to background with full tool access. The tool returns immediately with a subagent id; I'll send you last message when subagent finishes. Max concurrency ${MAX_CONCURRENCY_SUBAGENT} running subagents\nAvailable roles:\n${rolesDescription()}`,
      parameters: Type.Object({
        title: Type.String(),
        prompt: Type.String({
          description:
            'A self-contained description of the subagent should do.',
        }),
        role: Type.String({
          description: `Role of subagent`,
        }),
        followupOf: Type.Optional(
          Type.Number({
            description: `Reuse subagent id to follow up. Omit for a fresh task. Max reuse ${MAX_REUSE_FOLLOWUPS} times`,
          }),
        ),
      }),
      async execute(_toolCallId, params, signal, _onUpdate, ctx) {
        const subagentRef = getPiModesConfig().subagentDefaultModel
        const subagentModel = resolveModelRef(ctx, subagentRef) ?? ctx.model
        const role = resolveRole(params.role)

        const tools = composeTools(state.previousActiveTools ?? [], {
          tools: role.tools,
          extraTools: role.extraTools,
          removeTools: role.removeTools,
        })

        let systemPrompt: string | undefined = undefined
        let model = subagentModel

        if (role.systemPrompt) systemPrompt = role.systemPrompt
        if (role.model) {
          const roleModel = resolveModelRef(ctx, role.model)
          if (roleModel) model = roleModel
        }

        let subagent: LiveSubagent
        try {
          subagent = await manager.spawn(params.title, params.prompt, {
            cwd: ctx.cwd,
            model,
            thinkingLevel: ctx.thinkingLevel,
            tools,
            systemPrompt,
            followupOf: params.followupOf,
            role: params.role,
          })
          fleet.update()
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          return {
            content: [{ type: 'text', text: message }],
            details: {},
          }
        }

        if (signal) {
          const stop = (): void => {
            void manager.abort(subagent.id)
          }
          if (signal.aborted) stop()
          else signal.addEventListener('abort', stop, { once: true })
        }

        return {
          content: [
            {
              type: 'text',
              text: `Subagent id #${subagent.id} background. I'll send you last message when it finishes.`,
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
          const message = error instanceof Error ? error.message : String(error)
          return {
            content: [{ type: 'text', text: message }],
            details: { subagentId: params.id, status: subagent.status },
          }
        }
      },
    }),
  ]

  registerOptionalTools(pi, tools)
}
