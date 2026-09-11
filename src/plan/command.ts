import type {
  ExtensionAPI,
  ExtensionContext,
} from '@earendil-works/pi-coding-agent'

import { notifyAgentMessage } from '../utils/messages.js'
import { escapeXml } from '../utils/xml.js'

export function buildPlanRequestMessage(prompt: string): string {
  return [
    "Use the subagent tool with role 'planner' to create an implementation plan for the request below. Once the plan is ready, delegate implementation to other subagents.",
    '<request>',
    escapeXml(prompt),
    '</request>',
  ].join('\n')
}

export async function runPlanCommand(
  pi: ExtensionAPI,
  state: { mode: 'coordinator' | undefined },
  args: string,
  ctx: ExtensionContext,
  enterCoordinator: () => Promise<void>,
): Promise<void> {
  let prompt = args.trim()
  if (!prompt && ctx.hasUI) {
    prompt = (await ctx.ui.editor('Enter the request to plan:', '')) ?? ''
  }
  if (!prompt.trim()) return
  if (state.mode !== 'coordinator') {
    try {
      await enterCoordinator()
    } catch (error) {
      ctx.ui.notify(
        error instanceof Error ? error.message : String(error),
        'error',
      )
      return
    }
  }
  notifyAgentMessage(pi, buildPlanRequestMessage(prompt))
}
