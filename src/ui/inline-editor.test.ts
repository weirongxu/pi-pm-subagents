import { describe, expect, it } from 'vitest'

import { capEditorLines } from './inline-editor.js'

describe('capEditorLines', () => {
  const TOP = '╭─'
  const BOTTOM = '╰─'
  const hidden = (n: number) => `… +${n} hidden`
  // Window = 4 before + cursor + 3 after + 2 borders.
  const MAX = 10
  const content = (n: number, cursorAt: number) =>
    Array.from({ length: n }, (_, i) =>
      i === cursorAt ? `line${i}\x1b[7m` : `line${i}`,
    )

  it('returns short output untouched', () => {
    const lines = [TOP, 'a', 'b', BOTTOM]
    expect(capEditorLines(lines, hidden)).toBe(lines)
  })

  it('keeps top/bottom borders when truncating', () => {
    const out = capEditorLines([TOP, ...content(20, 10), BOTTOM], hidden)
    expect(out).toHaveLength(MAX)
    expect(out[0]).toBe(TOP)
    expect(out[out.length - 1]).toBe(BOTTOM)
  })

  it('slides a 4/cursor/3 window around a mid cursor', () => {
    const out = capEditorLines([TOP, ...content(20, 8), BOTTOM], hidden)
    // Content window: lines 4..11 (cursor at 8); hidden markers replace the edge lines
    expect(out.slice(1, -1)).toEqual([
      hidden(4),
      'line5',
      'line6',
      'line7',
      'line8\x1b[7m',
      'line9',
      'line10',
      hidden(8),
    ])
  })

  it('clamps the window at the top edge', () => {
    const out = capEditorLines([TOP, ...content(20, 1), BOTTOM], hidden)
    expect(out[1]).toBe('line0')
    expect(out[2]).toBe('line1\x1b[7m')
    // Window hugs the top; only the bottom hides lines
    expect(out.slice(1, -1)).toEqual([
      'line0',
      'line1\x1b[7m',
      'line2',
      'line3',
      'line4',
      'line5',
      'line6',
      hidden(12),
    ])
  })

  it('clamps the window at the bottom edge and marks hidden lines above', () => {
    const out = capEditorLines([TOP, ...content(20, 18), BOTTOM], hidden)
    expect(out[1]).toBe(hidden(12))
    expect(out[out.length - 2]).toBe('line19')
    expect(out[out.length - 3]).toBe('line18\x1b[7m')
  })

  it('counts hidden lines correctly for a cursor near the top', () => {
    const out = capEditorLines([TOP, ...content(20, 5), BOTTOM], hidden)
    expect(out.slice(1, -1)).toEqual([
      hidden(1),
      'line2',
      'line3',
      'line4',
      'line5\x1b[7m',
      'line6',
      'line7',
      hidden(11),
    ])
  })

  it('falls back to top truncation when no cursor line exists', () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line${i}`)
    const out = capEditorLines([TOP, ...lines, BOTTOM], hidden)
    expect(out).toHaveLength(MAX)
    expect(out[1]).toBe('line0')
    expect(out[out.length - 2]).toBe(hidden(13))
  })

  it('shows 7 real lines before the cursor when it sits on the last content line', () => {
    const out = capEditorLines([TOP, ...content(20, 19), BOTTOM], hidden)
    expect(out[1]).toBe(hidden(12))
    expect(out[out.length - 2]).toBe('line19\x1b[7m')
    // Bottom-clamped window: top hidden marker, nothing hidden below
    expect(out.slice(2, -2)).toEqual([
      'line13',
      'line14',
      'line15',
      'line16',
      'line17',
      'line18',
    ])
    expect(out[out.length - 1]).toBe(BOTTOM)
  })
})
