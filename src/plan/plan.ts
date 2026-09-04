import type {
  ExtensionAPI,
  ExtensionContext,
} from '@earendil-works/pi-coding-agent'

import { enterCoordinatorMode } from '../coordinator/coordinator.js'
import { applyModeFor, assertModeIdle, exitModeFor } from '../mode-switcher.js'
import type { ModesState } from '../types.js'
import { askHowToProceed, type ReviewChoice } from '../ui/review-pager.js'
import type { PromptDefinition } from '../utils/markdown.js'
import { lastAssistantText } from '../utils/messages.js'
import { setupPlanDemo } from './demo.js'

const PLAN_MODE_WIDGET_KEY = 'pi-modes:plan-mode'

export async function enterPlanMode(
  pi: ExtensionAPI,
  state: ModesState,
  ctx: ExtensionContext,
  def: PromptDefinition,
): Promise<void> {
  assertModeIdle(state, 'plan')
  state.mode = 'plan'
  state.planMarkdown = undefined
  await applyPlanMode(pi, state, ctx, def)
  ctx.ui.notify('Plan mode on — read-only. Produce a plan for review.', 'info')
}

export async function applyPlanMode(
  pi: ExtensionAPI,
  state: ModesState,
  ctx: ExtensionContext,
  def: PromptDefinition,
): Promise<void> {
  await applyModeFor(pi, state, 'plan', ctx, {
    promptDefinition: def,
    color: 'warning',
  })
  ctx.ui.setWidget(PLAN_MODE_WIDGET_KEY, [
    ctx.ui.theme.fg('warning', ctx.ui.theme.bold('📋 PLAN MODE ')),
  ])
}

export async function exitPlanMode(
  pi: ExtensionAPI,
  state: ModesState,
  ctx: ExtensionContext,
): Promise<void> {
  state.mode = undefined
  ctx.ui.setWidget(PLAN_MODE_WIDGET_KEY, undefined)
  await exitModeFor(pi, state, ctx, 'plan')
}

export async function setupPlan(
  pi: ExtensionAPI,
  state: ModesState,
  {
    demoEnabled,
    planDefinition,
    coordinatorDefinition,
  }: {
    demoEnabled: boolean
    planDefinition: PromptDefinition
    coordinatorDefinition: PromptDefinition
  },
): Promise<void> {
  const planPrompt = planDefinition.systemPrompt

  pi.on('before_agent_start', async (event) => {
    if (state.mode !== 'plan') return
    return { systemPrompt: `${event.systemPrompt}\n\n${planPrompt}` }
  })

  pi.registerCommand('plan', {
    description:
      'Toggle plan mode, or /plan <request> in pm mode to delegate a planner subagent. Usage: /plan · /plan <request>',
    handler: async (args, ctx) => {
      const request = args.trim()
      if (state.mode === 'plan') {
        await exitPlanMode(pi, state, ctx)
        ctx.ui.notify('Plan mode off.', 'info')
        return
      }
      if (state.mode === 'coordinator') {
        let requestInput: string | undefined = request
        if (!requestInput) {
          requestInput = await ctx.ui.editor('Enter the request to plan:', '')
        }
        if (!requestInput?.trim()) {
          return
        }
        const planBlock = `<planRequest>${requestInput}</planRequest>`
        pi.sendUserMessage(
          [planBlock, "Use role 'planner' to create a plan."].join('\n'),
          { deliverAs: 'followUp' },
        )
        return
      }
      await enterPlanMode(pi, state, ctx, planDefinition)
      if (request) pi.sendUserMessage(request, { deliverAs: 'followUp' })
    },
  })

  pi.on('agent_end', async (event, ctx) => {
    if (state.mode !== 'plan' || !ctx.hasUI) return
    const plan = lastAssistantText(event.messages)
    if (!plan) return

    state.planMarkdown = plan

    const planChoices: readonly ReviewChoice[] = [
      {
        id: 'execute-directly',
        label: 'Execute directly',
        action: async () => {
          await exitPlanMode(pi, state, ctx)
          const planBlock = `<plan>${state.planMarkdown ?? ''}</plan>`
          pi.sendUserMessage(
            [planBlock, 'Now you exit plan mode, execute it'].join('\n'),
            { deliverAs: 'followUp' },
          )
        },
      },
      {
        id: 'execute-via-subagents',
        label: 'Execute via subagents',
        action: async () => {
          await exitPlanMode(pi, state, ctx)
          const planBlock = `<plan>${state.planMarkdown ?? ''}</plan>`
          await enterCoordinatorMode(
            pi,
            state,
            planBlock,
            ctx,
            coordinatorDefinition,
          )
        },
      },
      {
        id: 'update-the-plan',
        label: 'Update the plan',
        action: async () => {
          const updatePrompt = await ctx.ui.editor('Update the plan:', '')
          if (updatePrompt?.trim()) {
            pi.sendUserMessage(
              `Update the plan based on:\n\n${updatePrompt.trim()}`,
              { deliverAs: 'steer' },
            )
          }
        },
      },
      {
        id: 'cancel',
        label: 'Cancel',
        action: async () => {
          await exitPlanMode(pi, state, ctx)
        },
      },
    ]

    await askHowToProceed(ctx, {
      title: '📋 Plan',
      plan,
      choices: planChoices,
    })
  })

  if (demoEnabled) {
    setupPlanDemo(pi)
  }
}
