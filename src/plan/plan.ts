import {
  type ExtensionAPI,
  type ExtensionContext,
  getMarkdownTheme,
} from '@earendil-works/pi-coding-agent'
import { Markdown, matchesKey, truncateToWidth } from '@earendil-works/pi-tui'

import { BorderView } from '../border-view.js'
import {
  enterCoordinatorMode,
  exitCoordinatorMode,
} from '../coordinator/index.js'
import {
  applyModeSetup,
  assertModeIdle,
  exitReadOnly,
} from '../mode-switcher.js'
import { ScrollView } from '../scroll-view.js'
import type { ModesState } from '../types.js'
import type { PromptDefinition } from '../utils/markdown.js'
import { lastAssistantText } from '../utils/messages.js'
import { persist } from '../utils/state.js'
import { setupPlanDemo } from './demo.js'

const PLAN_CHOICES = [
  'Execute directly',
  'Execute via subagents',
  'Update the plan',
  'Cancel',
] as const

/** Terminal-row percentage the plan overlay occupies. */
const VIEWPORT_HEIGHT_PCT = 80
/** Lines outside the scroll view: title + separator + choices + hint. */
const CHROME_LINES = PLAN_CHOICES.length + 3
/** Overlay width as a percentage of the terminal. */
const OVERLAY_WIDTH_PCT = '90%'
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
  await resumePlanMode(pi, state, ctx, def)
  ctx.ui.notify('Plan mode on — read-only. Produce a plan for review.', 'info')
  persist(pi, state)
}

export async function resumePlanMode(
  pi: ExtensionAPI,
  state: ModesState,
  ctx: ExtensionContext,
  def: PromptDefinition,
): Promise<void> {
  await applyModeSetup(pi, state, 'plan', ctx, {
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
  state.planMarkdown = undefined
  ctx.ui.setWidget(PLAN_MODE_WIDGET_KEY, undefined)
  await exitReadOnly(pi, state, ctx, 'plan')
}

export function renderPlanPager(
  ctx: ExtensionContext,
  plan: string,
): Promise<string | undefined> {
  return ctx.ui.custom<string | undefined>(
    (tui, theme, _keybindings, done) => {
      const choices = PLAN_CHOICES
      let selected = 0
      const markdown = new Markdown(plan, 0, 0, getMarkdownTheme())

      const scroll = new ScrollView(tui, theme, {
        child: markdown,
        // title + separator + choices + hint live outside the scroll view
        viewportHeight: () =>
          Math.max(
            3,
            Math.floor((tui.terminal.rows * VIEWPORT_HEIGHT_PCT) / 100) -
              CHROME_LINES -
              3,
          ),
      })

      const component = {
        render(width: number) {
          const rows = scroll.render(width)
          return [
            theme.fg('accent', theme.bold('📋 Plan')),
            ...rows,
            theme.fg('muted', '─'.repeat(width)),
            ...choices.map((choice, index) =>
              index === selected
                ? theme.fg('accent', `→ ${choice}`)
                : `  ${choice}`,
            ),
            theme.fg('muted', '─'.repeat(width)),
            this.footerLine(width),
          ]
        },
        footerLine(width: number) {
          const th = theme
          const sep = th.fg('dim', ' · ')
          const keys: [string, string][] = []

          keys.push(
            ['↑↓', 'select'],
            [`1-${choices.length}`, 'jump'],
            ['j/k line', 'line'],
            ['u/d ␣', 'PageUp/Dn page'],
            ['g/G', 'Home/End jump'],
            ['Enter', 'confirm'],
            ['q/esc', 'cancel'],
          )
          return truncateToWidth(
            keys
              .map(
                ([key, desc]) =>
                  `${th.fg('syntaxKeyword', key)} ${th.fg('success', desc)}`,
              )
              .join(sep),
            width,
          )
        },
        handleInput(data: string) {
          const index = /^[1-9]$/.test(data) ? Number(data) - 1 : -1
          if (index >= 0 && choices[index]) {
            done(choices[index])
            return
          }
          if (matchesKey(data, 'up')) {
            selected = Math.max(0, selected - 1)
            tui.requestRender()
            return
          }
          if (matchesKey(data, 'down')) {
            selected = Math.min(choices.length - 1, selected + 1)
            tui.requestRender()
            return
          }
          if (matchesKey(data, 'enter')) {
            done(choices[selected])
            return
          }
          if (matchesKey(data, 'escape') || data === 'q') {
            done(undefined)
            return
          }
          scroll.handleInput(data)
        },
        invalidate() {
          scroll.invalidate()
        },
      }

      return new BorderView(theme, { child: component })
    },
    {
      overlay: true,
      overlayOptions: {
        anchor: 'center',
        width: OVERLAY_WIDTH_PCT,
        maxHeight: `${VIEWPORT_HEIGHT_PCT}%`,
      },
    },
  )
}

async function askHowToProceed(
  pi: ExtensionAPI,
  state: ModesState,
  ctx: ExtensionContext,
  coordinatorDef: PromptDefinition,
): Promise<void> {
  const plan = state.planMarkdown
  if (!plan) return

  ctx.ui.setWorkingVisible(false)
  try {
    const choice = await renderPlanPager(ctx, plan)
    const planBlock = `<plan>\n${plan}\n</plan>`
    const executePlan = `Execute the plan below.${planBlock}`

    switch (choice) {
      case 'Execute directly': {
        await exitPlanMode(pi, state, ctx)
        pi.sendUserMessage(executePlan, {
          deliverAs: 'followUp',
        })
        break
      }
      case 'Execute via subagents': {
        await exitPlanMode(pi, state, ctx)
        await enterCoordinatorMode(pi, state, executePlan, ctx, coordinatorDef)
        break
      }
      case 'Update the plan': {
        const updatePrompt = await ctx.ui.editor('Update the plan:', '')
        if (updatePrompt?.trim()) {
          pi.sendUserMessage(
            `Update the plan based on:\n\n${updatePrompt.trim()}`,
            { deliverAs: 'steer' },
          )
        }
        break
      }
      case 'Cancel':
        await exitPlanMode(pi, state, ctx)
        break
    }
  } finally {
    ctx.ui.setWorkingVisible(true)
  }
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
  let reviewInFlight = false
  const planPrompt = planDefinition.systemPrompt

  pi.on('before_agent_start', async (event) => {
    if (state.mode !== 'plan') return
    return { systemPrompt: `${event.systemPrompt}\n\n${planPrompt}` }
  })

  pi.registerCommand('plan', {
    description:
      'Plan mode (read-only planning, then review). Subcommands: /plan [toggle] · /plan show · /plan <request>',
    getArgumentCompletions: (prefix: string) => {
      const subs = ['show', 'toggle']
      const items = subs
        .filter((s) => s.startsWith(prefix))
        .map((s) => ({ value: s, label: s }))
      return items.length > 0 ? items : null
    },
    handler: async (args, ctx) => {
      const request = args.trim()
      if (request === 'show') {
        await askHowToProceed(pi, state, ctx, coordinatorDefinition)
        return
      }
      if (state.mode === 'plan') {
        await exitPlanMode(pi, state, ctx)
        ctx.ui.notify('Plan mode off.', 'info')
        return
      }
      if (state.mode === 'coordinator')
        await exitCoordinatorMode(pi, state, ctx)
      await enterPlanMode(pi, state, ctx, planDefinition)
      if (request && request !== 'toggle')
        pi.sendUserMessage(request, { deliverAs: 'followUp' })
    },
  })

  // When the plan lands, open a review pager and dispatch the chosen action.
  pi.on('agent_end', async (event, ctx) => {
    if (state.mode !== 'plan' || reviewInFlight || !ctx.hasUI) return
    const plan = lastAssistantText(event.messages)
    if (!plan) return

    state.planMarkdown = plan
    reviewInFlight = true

    try {
      await askHowToProceed(pi, state, ctx, coordinatorDefinition)
    } finally {
      reviewInFlight = false
    }
  })

  if (demoEnabled) {
    setupPlanDemo(pi)
  }
}
