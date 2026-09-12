import type { Theme } from '@earendil-works/pi-coding-agent'
import { Editor, type TUI } from '@earendil-works/pi-tui'

const CURSOR_SEQ = '\x1b[7m'

export const EDITOR_LINES_BEFORE = 4
export const EDITOR_LINES_AFTER = 3
export const EDITOR_BORDER_LINES = 2
export const EDITOR_WINDOW_LINES = EDITOR_LINES_BEFORE + 1 + EDITOR_LINES_AFTER
export const EDITOR_MAX_LINES = EDITOR_WINDOW_LINES + EDITOR_BORDER_LINES

/**
 * Assumes editor.render() output is [topBorder, ...content, bottomBorder];
 * this editor never sets an autocomplete provider, so no trailing list lines.
 * `formatHidden` counts hidden lines among the rendered output only (Editor
 * already self-truncates to its own max visible lines, so it may undercount
 * the editor's real buffer size).
 */
export function capEditorLines(
  lines: string[],
  formatHidden: (hidden: number) => string,
): string[] {
  if (lines.length <= EDITOR_MAX_LINES) return lines
  const topBorder = lines[0] ?? ''
  const bottomBorder = lines[lines.length - 1] ?? ''
  const content = lines.slice(1, -1)
  const windowSize = EDITOR_WINDOW_LINES
  const cursor = content.findIndex((line) => line.includes(CURSOR_SEQ))
  if (cursor === -1) {
    const capped = [
      ...content.slice(0, windowSize - 1),
      formatHidden(content.length - (windowSize - 1)),
    ]
    return [topBorder, ...capped, bottomBorder]
  }
  const start = Math.max(
    0,
    Math.min(cursor - EDITOR_LINES_BEFORE, content.length - windowSize),
  )
  const capped = content.slice(start, start + windowSize)
  if (start > 0) capped[0] = formatHidden(start)
  if (start + windowSize < content.length)
    capped[capped.length - 1] = formatHidden(
      content.length - (start + windowSize),
    )
  return [topBorder, ...capped, bottomBorder]
}

type InlineEditorOptions = ConstructorParameters<typeof Editor>[1]

function createInlineEditorTheme(theme: Theme): InlineEditorOptions {
  return {
    borderColor: (str) => theme.fg('borderMuted', str),
    selectList: {
      selectedPrefix: (text) => theme.fg('accent', text),
      selectedText: (text) => theme.fg('accent', text),
      description: (text) => theme.fg('muted', text),
      scrollInfo: (text) => theme.fg('dim', text),
      noMatch: (text) => theme.fg('warning', text),
    },
  }
}

export function createInlineEditor(tui: TUI, theme: Theme): Editor {
  return new Editor(tui, createInlineEditorTheme(theme))
}
