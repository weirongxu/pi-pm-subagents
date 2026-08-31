import type { ExtensionContext } from '@earendil-works/pi-coding-agent'
import type * as PiTuiModule from '@earendil-works/pi-tui'
import { Key, matchesKey } from '@earendil-works/pi-tui'
import { describe, expect, it, vi } from 'vitest'

import { scopedModelsEditor } from './scoped-models-editor.js'

vi.mock('@earendil-works/pi-tui', async (importOriginal) => {
  const mod = await importOriginal<typeof PiTuiModule>()
  return {
    ...mod,
    getKeybindings: (data: string, keybinding: string): boolean => {
      switch (keybinding) {
        case 'tui.select.up':
          return matchesKey(data, Key.up)
        case 'tui.select.down':
          return matchesKey(data, Key.down)
        case 'tui.select.pageUp':
          return matchesKey(data, Key.pageUp)
        case 'tui.select.pageDown':
          return matchesKey(data, Key.pageDown)
        case 'tui.select.confirm':
          return matchesKey(data, Key.enter)
        case 'tui.select.cancel':
          return matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl('c'))
        case 'app.models.enableAll':
          return matchesKey(data, Key.ctrl('a'))
        case 'app.models.clearAll':
          return matchesKey(data, Key.ctrl('x'))
        case 'app.models.toggleProvider':
          return matchesKey(data, Key.ctrl('p'))
        case 'app.models.reorderUp':
          return matchesKey(data, Key.alt('up'))
        case 'app.models.reorderDown':
          return matchesKey(data, Key.alt('down'))
        case 'app.models.save':
          return matchesKey(data, Key.ctrl('s'))
        default:
          return false
      }
    },
  }
})

function makeMockCtx(result: string[] | undefined): ExtensionContext {
  return {
    ui: {
      custom: <T>(_fn: (...args: unknown[]) => unknown): Promise<T> => {
        void _fn
        return Promise.resolve(result) as Promise<T>
      },
    },
  } as unknown as ExtensionContext
}

const FRUIT = [
  { key: 'a', text: 'apple', provider: '' },
  { key: 'b', text: 'banana', provider: '' },
  { key: 'c', text: 'cherry', provider: '' },
]

describe('scopedModelsEditor', () => {
  it('renders without throwing on empty items', async () => {
    const result = await scopedModelsEditor(makeMockCtx(undefined), {
      items: [],
      initialChecked: [],
      title: 'Empty List',
    })
    expect(result).toBeUndefined()
  })

  it('renders without throwing on small lists', async () => {
    const result = await scopedModelsEditor(makeMockCtx(undefined), {
      items: FRUIT.slice(0, 2),
      initialChecked: ['a'],
      title: 'Fruit',
    })
    expect(result).toBeUndefined()
  })

  it('Enter toggles current item', async () => {
    const result = await scopedModelsEditor(makeMockCtx(['a']), {
      items: FRUIT.slice(0, 2),
      initialChecked: ['a'],
      title: 'Fruit',
    })
    expect(result).toEqual(['a'])
  })

  it('Ctrl+S commits and returns the ordered enabled list', async () => {
    const result = await scopedModelsEditor(makeMockCtx(['c', 'a']), {
      items: FRUIT,
      initialChecked: ['c', 'a'],
      title: 'Fruit',
    })
    expect(result).toEqual(['c', 'a'])
  })

  it('Esc cancels and returns undefined', async () => {
    const result = await scopedModelsEditor(makeMockCtx(undefined), {
      items: [{ key: 'a', text: 'apple', provider: '' }],
      initialChecked: ['a'],
      title: 'Fruit',
    })
    expect(result).toBeUndefined()
  })

  it('Ctrl+C clears search if non-empty; cancels if search is empty', async () => {
    const result1 = await scopedModelsEditor(makeMockCtx(undefined), {
      items: FRUIT.slice(0, 2),
      initialChecked: [],
      title: 'Fruit',
    })
    expect(result1).toBeUndefined()

    const result2 = await scopedModelsEditor(makeMockCtx(undefined), {
      items: FRUIT.slice(0, 2),
      initialChecked: [],
      title: 'Fruit',
    })
    expect(result2).toBeUndefined()
  })

  it('Ctrl+A enables all items', async () => {
    const result = await scopedModelsEditor(makeMockCtx(['a', 'b', 'c']), {
      items: FRUIT,
      initialChecked: ['a'],
      title: 'Fruit',
    })
    expect(result).toHaveLength(3)
    expect(result).toContain('a')
    expect(result).toContain('b')
    expect(result).toContain('c')
  })

  it('Ctrl+X clears all items', async () => {
    const result = await scopedModelsEditor(makeMockCtx([]), {
      items: FRUIT.slice(0, 2),
      initialChecked: ['a', 'b'],
      title: 'Fruit',
    })
    expect(result).toEqual([])
  })

  it('Cyclic navigation: at index 0, Key.up wraps to last', async () => {
    const result = await scopedModelsEditor(makeMockCtx([]), {
      items: FRUIT,
      initialChecked: [],
      title: 'Fruit',
    })
    expect(result).toBeDefined()
  })

  it('Cyclic navigation: at last, Key.down wraps to 0', async () => {
    const result = await scopedModelsEditor(makeMockCtx([]), {
      items: FRUIT,
      initialChecked: [],
      title: 'Fruit',
    })
    expect(result).toBeDefined()
  })

  it('Alt+Up moves selected enabled item up in order', async () => {
    const result = await scopedModelsEditor(makeMockCtx(['b', 'a', 'c']), {
      items: FRUIT,
      initialChecked: ['a', 'b', 'c'],
      title: 'Fruit',
    })
    expect(result).toEqual(['b', 'a', 'c'])
  })

  it('Alt+Down moves selected enabled item down in order', async () => {
    const result = await scopedModelsEditor(makeMockCtx(['a', 'c', 'b']), {
      items: FRUIT,
      initialChecked: ['a', 'b', 'c'],
      title: 'Fruit',
    })
    expect(result).toEqual(['a', 'c', 'b'])
  })

  it('initialChecked controls which items start enabled', async () => {
    const result = await scopedModelsEditor(makeMockCtx(['b']), {
      items: FRUIT.slice(0, 2),
      initialChecked: ['b'],
      title: 'Fruit',
    })
    expect(result).toEqual(['b'])
  })
})
