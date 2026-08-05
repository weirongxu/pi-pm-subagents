import {
  type ExtensionAPI,
  type ExtensionContext,
  getMarkdownTheme,
} from '@earendil-works/pi-coding-agent'
import { Markdown, matchesKey, truncateToWidth } from '@earendil-works/pi-tui'

import { lastAssistantText, type ModesState, persist } from './helper.js'
import { enterManagerMode, exitManagerMode } from './manager.js'
import {
  applyModeSetup,
  assertModeIdle,
  exitReadOnly,
} from './mode-switcher.js'
import { readPrompt } from './prompts.js'
import { ScrollView } from './scroll-view.js'

const PLAN_CHOICES = [
  'Execute directly',
  'Execute via manager',
  'Refine the plan',
  'Cancel',
] as const

/** Terminal-row percentage the plan overlay occupies. */
const VIEWPORT_HEIGHT_PCT = 80
/** Lines outside the scroll view: title + separator + choices + hint. */
const CHROME_LINES = PLAN_CHOICES.length + 3
/** Overlay width as a percentage of the terminal. */
const OVERLAY_WIDTH_PCT = '90%'

export function renderPlanBanner(
  ctx: ExtensionContext,
  state: ModesState,
): void {
  if (state.mode !== 'plan') {
    ctx.ui.setWidget('plan-mode', undefined)
    return
  }
  ctx.ui.setWidget('plan-mode', [
    ctx.ui.theme.fg('warning', ctx.ui.theme.bold('📋 PLAN MODE — read-only')),
  ])
}

export async function enterPlanMode(
  pi: ExtensionAPI,
  state: ModesState,
  ctx: ExtensionContext,
): Promise<void> {
  assertModeIdle(state, 'plan')
  state.mode = 'plan'
  state.planMarkdown = undefined
  await resumePlanMode(pi, state, ctx)
  ctx.ui.notify('Plan mode on — read-only. Produce a plan for review.', 'info')
  persist(pi, state)
}

export async function resumePlanMode(
  pi: ExtensionAPI,
  state: ModesState,
  ctx: ExtensionContext,
): Promise<void> {
  await applyModeSetup(pi, state, 'plan', ctx, {
    color: 'warning',
    render: renderPlanBanner,
  })
}

export async function exitPlanMode(
  pi: ExtensionAPI,
  state: ModesState,
  ctx: ExtensionContext,
  options: { restoreModel?: boolean; clearMarkdown?: boolean } = {},
): Promise<void> {
  const restoreModel = options.restoreModel ?? true
  const clearMarkdown = options.clearMarkdown ?? true
  state.mode = undefined
  if (clearMarkdown) state.planMarkdown = undefined
  renderPlanBanner(ctx, state)
  await exitReadOnly(pi, state, ctx, 'plan', { restoreModel })
}

async function renderPlanPager(
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
              CHROME_LINES,
          ),
      })

      return {
        render(width: number) {
          const rows = scroll.render(width)
          const start = scroll.offset
          const last = Math.min(start + scroll.viewportHeight, scroll.total)
          return [
            theme.fg('accent', theme.bold('📋 Plan')),
            ...rows,
            theme.fg('muted', '─'.repeat(width)),
            ...choices.map((choice, index) =>
              index === selected
                ? theme.fg('accent', `→ ${choice}`)
                : `  ${choice}`,
            ),
            theme.fg(
              'dim',
              truncateToWidth(
                `${start + 1}-${last}/${scroll.total}  ·  ↑↓ or 1-${choices.length} select  ·  j/k d/u scroll  ·  Enter  ·  q cancel`,
                width,
              ),
            ),
          ]
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
): Promise<void> {
  const plan = state.planMarkdown
  if (!plan) return

  ctx.ui.setWorkingVisible(false)
  try {
    const choice = await renderPlanPager(ctx, plan)
    const planBlock = `<plan>\n${plan}\n</plan>`

    switch (choice) {
      case 'Execute directly': {
        await exitPlanMode(pi, state, ctx)
        pi.sendUserMessage(`Execute the plan below.${planBlock}`, {
          deliverAs: 'followUp',
        })
        break
      }
      case 'Execute via manager':
        await exitPlanMode(pi, state, ctx, { restoreModel: true })
        await enterManagerMode(pi, state, planBlock, ctx)
        break
      case 'Refine the plan': {
        const refinement = await ctx.ui.editor('Refine the plan:', '')
        if (refinement?.trim()) {
          pi.sendUserMessage(
            `Update the plan based on:\n\n${refinement.trim()}`,
            {
              deliverAs: 'followUp',
            },
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
): Promise<void> {
  let reviewInFlight = false
  const planPrompt = await readPrompt('plan')

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
        await askHowToProceed(pi, state, ctx)
        return
      }
      if (state.mode === 'plan') {
        await exitPlanMode(pi, state, ctx)
        ctx.ui.notify('Plan mode off.', 'info')
        return
      }
      if (state.mode === 'manager') await exitManagerMode(pi, state, ctx)
      await enterPlanMode(pi, state, ctx)
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
      await askHowToProceed(pi, state, ctx)
    } finally {
      reviewInFlight = false
    }
  })
}
