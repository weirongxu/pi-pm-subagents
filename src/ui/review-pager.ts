import {
  type ExtensionContext,
  getMarkdownTheme,
} from '@earendil-works/pi-coding-agent'
import { Markdown, matchesKey } from '@earendil-works/pi-tui'

import { truncateText } from '../utils/truncate.js'
import { BorderView } from './border-view.js'
import { ScrollView } from './scroll-view.js'

const VIEWPORT_HEIGHT_PCT = 80
const OVERLAY_WIDTH_PCT = '90%'

export interface ReviewChoice {
  readonly id: string
  readonly label: string
  readonly action: () => Promise<void> | void
}

export interface ReviewPagerOptions {
  readonly title: string
  readonly plan: string
  readonly choices: readonly ReviewChoice[]
}

export function renderReviewPager(
  ctx: ExtensionContext,
  options: ReviewPagerOptions,
): Promise<string | undefined> {
  return ctx.ui.custom<string | undefined>(
    (tui, theme, _keybindings, done) => {
      const { title, plan, choices } = options
      const chromeLines = choices.length + 3
      let selected = 0
      const markdown = new Markdown(plan, 0, 0, getMarkdownTheme())

      const scroll = new ScrollView(tui, theme, {
        child: markdown,
        viewportHeight: () =>
          Math.max(
            3,
            Math.floor((tui.terminal.rows * VIEWPORT_HEIGHT_PCT) / 100) -
              chromeLines -
              3,
          ),
      })

      const component = {
        render(width: number) {
          const rows = scroll.render(width)
          return [
            theme.fg('accent', theme.bold(title)),
            ...rows,
            theme.fg('muted', '─'.repeat(width)),
            ...choices.map((choice, index) =>
              index === selected
                ? theme.fg('accent', `→ ${choice.label}`)
                : `  ${choice.label}`,
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
            ['u/e/d ␣', 'PgUp/Dn ½page'],
            ['g/G', 'Home/End jump'],
            ['Enter', 'confirm'],
            ['q/esc', 'cancel'],
          )
          return truncateText(
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
          if (index >= 0 && choices[index] !== undefined) {
            done(choices[index].id)
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
            const chosen = choices[selected]
            if (chosen) done(chosen.id)
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

export async function askHowToProceed(
  ctx: ExtensionContext,
  options: ReviewPagerOptions,
): Promise<void> {
  ctx.ui.setWorkingVisible(false)
  try {
    const choiceId = await renderReviewPager(ctx, options)
    const choice = options.choices.find((c) => c.id === choiceId)
    if (choice) {
      await choice.action()
    }
  } finally {
    ctx.ui.setWorkingVisible(true)
  }
}
