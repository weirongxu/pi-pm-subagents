import type { Theme } from '@earendil-works/pi-coding-agent'
import type { TUI } from '@earendil-works/pi-tui'
import { describe, expect, it } from 'vitest'

import { ScrollView } from '../src/scroll-view.js'

const UP = '\x1b[A'
const DOWN = '\x1b[B'
const HOME = '\x1b[H'
const END = '\x1b[F'
const PAGE_UP = '\x1b[5~'
const PAGE_DOWN = '\x1b[6~'
const CTRL_D = '\x04'
const CTRL_U = '\x15'

const theme = {
  fg: (color: string, text: string) => `[${color}]${text}`,
} as unknown as Theme

const makeTui = (rows = 30): TUI =>
  ({ terminal: { rows }, requestRender: () => {} }) as unknown as TUI

const flat = (lines: string[]) => lines.join('\n')

const many = (n: number) => Array.from({ length: n }, (_, i) => `l${i}`)

/** Build a scroll view wrapping fixed `content` with a fixed viewport height. */
const wrap = (content: string[], viewportHeight: number, autoFollow = false) =>
  new ScrollView(makeTui(), theme, {
    child: { render: () => content, invalidate: () => {} },
    viewportHeight: () => viewportHeight,
    autoFollow,
  })

describe('ScrollView render', () => {
  it('shows every line when content fits the viewport', () => {
    const v = wrap(['a', 'b', 'c'], 10)
    const out = v.render(20)
    expect(out).toHaveLength(3)
    expect(flat(out)).toContain('a')
    expect(flat(out)).toContain('c')
    expect(flat(out)).not.toContain('[muted]█')
  })

  it('caps the window at the viewport when content overflows', () => {
    const v = wrap(many(50), 5)
    const out = v.render(20)
    expect(out).toHaveLength(5)
    expect(flat(out)).toContain('l0')
    expect(flat(out)).not.toContain('l5')
  })

  it('truncates over-wide lines to width - 2', () => {
    const v = wrap(['x'.repeat(100)], 5)
    const body = v.render(20).find((l) => l.includes('x'))
    expect(body).toBeTruthy()
    expect(body).not.toContain('x'.repeat(19))
  })

  it('exposes offset / total / viewportHeight after rendering', () => {
    const v = wrap(many(50), 5)
    v.render(20)
    expect(v.total).toBe(50)
    expect(v.viewportHeight).toBe(5)
    expect(v.offset).toBe(0)
  })
})

describe('ScrollView scrolling', () => {
  it('scrolls line by line with j / k and arrows', () => {
    const v = wrap(many(50), 5)
    v.render(20)
    v.handleInput('j')
    expect(flat(v.render(20))).not.toContain('l0')
    v.handleInput('k')
    expect(flat(v.render(20))).toContain('l0')
    v.handleInput(DOWN)
    expect(flat(v.render(20))).not.toContain('l0')
    v.handleInput(UP)
    expect(flat(v.render(20))).toContain('l0')
  })

  it('jumps to top and bottom with g / G and home / end', () => {
    const v = wrap(many(50), 5)
    v.render(20)
    v.handleInput(END)
    expect(flat(v.render(20))).toContain('l49')
    v.handleInput(HOME)
    expect(flat(v.render(20))).toContain('l0')
    v.handleInput('G')
    expect(flat(v.render(20))).toContain('l49')
    v.handleInput('g')
    expect(flat(v.render(20))).toContain('l0')
  })

  it('pages with d / u, space, ctrl-d / ctrl-u and PgUp / PgDn', () => {
    const v = wrap(many(50), 5)
    v.render(20)
    v.handleInput('d')
    expect(flat(v.render(20))).not.toContain('l0')
    v.handleInput('u')
    expect(flat(v.render(20))).toContain('l0')
    v.handleInput(' ')
    expect(flat(v.render(20))).not.toContain('l0')
    v.handleInput(CTRL_U)
    expect(flat(v.render(20))).toContain('l0')
    v.handleInput(CTRL_D)
    v.handleInput(PAGE_UP)
    expect(flat(v.render(20))).toContain('l0')
    v.handleInput(PAGE_DOWN)
    expect(flat(v.render(20))).not.toContain('l0')
  })

  it('clamps at both ends', () => {
    const v = wrap(many(50), 5)
    v.render(20)
    v.handleInput(UP)
    expect(v.offset).toBe(0)
    v.handleInput('G')
    v.handleInput('j')
    expect(v.offset).toBe(45)
  })
})

describe('ScrollView input forwarding', () => {
  it('forwards non-scroll input to the child', () => {
    const received: string[] = []
    const v = new ScrollView(makeTui(), theme, {
      child: {
        render: () => [],
        invalidate: () => {},
        handleInput: (d: string) => {
          received.push(d)
        },
      },
      viewportHeight: () => 5,
    })
    v.render(20)
    v.handleInput('z')
    v.handleInput('\r')
    expect(received).toEqual(['z', '\r'])
  })

  it('keeps scroll keys for itself (not forwarded)', () => {
    const received: string[] = []
    const v = new ScrollView(makeTui(), theme, {
      child: {
        render: () => many(50),
        invalidate: () => {},
        handleInput: (d: string) => {
          received.push(d)
        },
      },
      viewportHeight: () => 5,
    })
    v.render(20)
    v.handleInput('j')
    v.handleInput('G')
    expect(received).toEqual([])
    expect(v.offset).toBe(45)
  })
})

describe('ScrollView auto-follow', () => {
  it('pins to the latest content while following', () => {
    const content = ['a', 'b']
    const v = new ScrollView(makeTui(), theme, {
      child: { render: () => content, invalidate: () => {} },
      viewportHeight: () => 5,
      autoFollow: true,
    })
    v.render(20)
    content.splice(0, content.length, ...many(50))
    expect(flat(v.render(20))).toContain('l49')
  })

  it('stops following once you scroll above the bottom', () => {
    const content = many(50)
    const v = new ScrollView(makeTui(), theme, {
      child: { render: () => content, invalidate: () => {} },
      viewportHeight: () => 5,
      autoFollow: true,
    })
    v.render(20)
    v.handleInput(UP)
    v.render(20)
    content.splice(0, content.length, ...many(80))
    expect(flat(v.render(20))).not.toContain('l79')
  })
})
