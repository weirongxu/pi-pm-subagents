import type { Theme } from '@earendil-works/pi-coding-agent'
import type { TUI } from '@earendil-works/pi-tui'
import { describe, expect, it } from 'vitest'

import { CustomSelectComponent } from '../src/custom-select.js'

const DOWN = '\x1b[B'

const makeTui = (): TUI =>
  ({
    terminal: { rows: 30, columns: 80 },
    requestRender: () => {},
  }) as unknown as TUI

const makeTheme = (): Theme =>
  ({
    fg: (_color: string, text: string) => text,
    bold: (text: string) => text,
  }) as unknown as Theme

describe('CustomSelectComponent', () => {
  it('renders without throwing on small lists', () => {
    const picker = new CustomSelectComponent(
      makeTui(),
      makeTheme(),
      {
        items: [
          { key: 'a', text: 'apple' },
          { key: 'b', text: 'banana' },
        ],
        title: 'Fruit',
      },
      () => {},
      () => {},
    )
    expect(picker.render(40)).toBeDefined()
  })

  it('renders without throwing on large lists and caps the viewport', () => {
    const items = Array.from({ length: 100 }, (_, i) => ({
      key: `k${i}`,
      text: `option-${i}`,
    }))
    const picker = new CustomSelectComponent(
      makeTui(),
      makeTheme(),
      { items, title: 'Pick', maxVisible: 10 },
      () => {},
      () => {},
    )
    const lines = picker.render(40)
    expect(lines.length).toBeGreaterThan(0)
  })

  it('reports the selected key via onSelect', () => {
    let picked: string | undefined
    const picker = new CustomSelectComponent(
      makeTui(),
      makeTheme(),
      {
        items: [
          { key: 'a', text: 'apple' },
          { key: 'b', text: 'banana' },
        ],
        title: 'Fruit',
      },
      (key) => {
        picked = key
      },
      () => {},
    )
    picker.handleInput(DOWN) // move down
    picker.handleInput('\n') // confirm
    expect(picked).toBe('b')
  })

  it('invokes onCancel on escape', () => {
    let cancelled = false
    const picker = new CustomSelectComponent(
      makeTui(),
      makeTheme(),
      { items: [{ key: 'a', text: 'apple' }], title: 'Fruit' },
      () => {},
      () => {
        cancelled = true
      },
    )
    picker.handleInput('\x1b')
    expect(cancelled).toBe(true)
  })
})
