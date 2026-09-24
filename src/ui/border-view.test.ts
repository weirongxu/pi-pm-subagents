import { describe, expect, it } from 'vitest'
import { BorderView } from './border-view.js'
import type { Component } from '@earendil-works/pi-tui'
import type { Theme } from '@earendil-works/pi-coding-agent'

const makeTheme = (): Theme =>
  ({ fg: (_color: string, text: string) => text }) as unknown as Theme

const makeChild = (lines: string[]): Component => ({
  render: (width: number) => lines.map((line) => line.slice(0, width)),
  handleInput: () => {},
  invalidate: () => {},
})

describe('BorderView', () => {
  it('renders a border around the child content', () => {
    const view = new BorderView(makeTheme(), { child: makeChild(['hello']) })
    expect(view.render(10)).toEqual(['┌────────┐', '│hello   │', '└────────┘'])
  })

  it('does not throw when render is detached from the instance', () => {
    const view = new BorderView(makeTheme(), { child: makeChild(['hi']) })
    const { render } = view
    expect(() => render(40)).not.toThrow()
    expect(render(40).join('')).toContain('│hi')
  })
})
