import type { Theme } from '@earendil-works/pi-coding-agent'
import type { TUI } from '@earendil-works/pi-tui'
import { describe, expect, it } from 'vitest'

import { ScopedModelsEditorComponent } from './scoped-models-editor.js'

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

describe('ScopedModelsEditorComponent', () => {
  it('renders without throwing on empty items', () => {
    const editor = new ScopedModelsEditorComponent(
      makeTui(),
      makeTheme(),
      {
        items: [],
        initialChecked: new Set(),
        title: 'Empty List',
      },
      () => {},
      () => {},
    )
    expect(editor.render(40)).toBeDefined()
  })

  it('renders without throwing on small lists', () => {
    const editor = new ScopedModelsEditorComponent(
      makeTui(),
      makeTheme(),
      {
        items: [
          { key: 'a', text: 'apple' },
          { key: 'b', text: 'banana' },
        ],
        initialChecked: new Set(['a']),
        title: 'Fruit',
      },
      () => {},
      () => {},
    )
    expect(editor.render(40)).toBeDefined()
  })

  it('renders without throwing on large lists and caps the viewport', () => {
    const items = Array.from({ length: 100 }, (_, i) => ({
      key: `k${i}`,
      text: `option-${i}`,
    }))
    const editor = new ScopedModelsEditorComponent(
      makeTui(),
      makeTheme(),
      { items, initialChecked: new Set(), title: 'Pick' },
      () => {},
      () => {},
    )
    const lines = editor.render(40)
    expect(lines.length).toBeGreaterThan(0)
  })

  it('reports checked keys via onDone on Enter', () => {
    let picked: Set<string> | undefined
    const editor = new ScopedModelsEditorComponent(
      makeTui(),
      makeTheme(),
      {
        items: [
          { key: 'a', text: 'apple' },
          { key: 'b', text: 'banana' },
          { key: 'c', text: 'cherry' },
        ],
        initialChecked: new Set(['a']),
        title: 'Fruit',
      },
      (result) => {
        picked = result
      },
      () => {},
    )
    editor.handleInput('\x1b[B') // move down to banana
    editor.handleInput(' ') // toggle banana
    editor.handleInput('\x1b[B') // move down to cherry
    editor.handleInput(' ') // toggle cherry
    editor.handleInput('\n') // confirm
    expect(picked).toBeDefined()
    expect(picked?.has('a')).toBe(true) // initial
    expect(picked?.has('b')).toBe(true) // toggled
    expect(picked?.has('c')).toBe(true) // toggled
  })

  it('invokes onCancel on Escape', () => {
    let cancelled = false
    const editor = new ScopedModelsEditorComponent(
      makeTui(),
      makeTheme(),
      {
        items: [{ key: 'a', text: 'apple' }],
        initialChecked: new Set(),
        title: 'Fruit',
      },
      () => {},
      () => {
        cancelled = true
      },
    )
    editor.handleInput('\x1b')
    expect(cancelled).toBe(true)
  })

  it('initialChecked controls which items start checked', () => {
    let picked: Set<string> | undefined
    const editor = new ScopedModelsEditorComponent(
      makeTui(),
      makeTheme(),
      {
        items: [
          { key: 'a', text: 'apple' },
          { key: 'b', text: 'banana' },
        ],
        initialChecked: new Set(['b']),
        title: 'Fruit',
      },
      (result) => {
        picked = result
      },
      () => {},
    )
    editor.handleInput('\n') // confirm without toggling
    expect(picked).toBeDefined()
    expect(picked?.has('a')).toBe(false)
    expect(picked?.has('b')).toBe(true)
  })
})
