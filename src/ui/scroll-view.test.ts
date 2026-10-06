import { describe, expect, it } from 'vitest'
import { ScrollView } from './scroll-view.js'
import type { TUI } from '@earendil-works/pi-tui'
import type { Theme } from '@earendil-works/pi-coding-agent'

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

const makeTui = (rows = 30): TUI => {
  const listeners: ((data: string) => unknown)[] = []
  return {
    terminal: { rows },
    requestRender: () => {},
    addInputListener: (listener: (data: string) => unknown) => {
      listeners.push(listener)
      return () => {
        const index = listeners.indexOf(listener)
        if (index >= 0) listeners.splice(index, 1)
      }
    },
  } as unknown as TUI
}

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

  it('pages half a screen with d / u / e, space, ctrl-d / ctrl-u and PgUp / PgDn', () => {
    const v = wrap(many(50), 5)
    v.render(20)
    v.handleInput('d')
    expect(v.offset).toBe(2)
    v.handleInput('u')
    expect(v.offset).toBe(0)
    v.handleInput(' ')
    expect(v.offset).toBe(2)
    v.handleInput('e')
    expect(v.offset).toBe(0)
    v.handleInput(CTRL_D)
    expect(v.offset).toBe(2)
    v.handleInput(CTRL_U)
    expect(v.offset).toBe(0)
    v.handleInput(PAGE_DOWN)
    expect(v.offset).toBe(2)
    v.handleInput(PAGE_UP)
    expect(v.offset).toBe(0)
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

describe('ScrollView wheel', () => {
  const makeScrollTui = () => {
    const listeners: ((data: string) => unknown)[] = []
    const tui = {
      terminal: { rows: 30 },
      requestRender: () => {},
      addInputListener: (listener: (data: string) => unknown) => {
        listeners.push(listener)
        return () => {
          const i = listeners.indexOf(listener)
          if (i >= 0) listeners.splice(i, 1)
        }
      },
    }
    return {
      tui: tui as unknown as TUI,
      wheel: (d: string) => listeners[0]?.(d),
    }
  }

  const wrapWheel = (content: string[], viewportHeight: number) => {
    const { tui, wheel } = makeScrollTui()
    const v = new ScrollView(tui, theme, {
      child: { render: () => content, invalidate: () => {} },
      viewportHeight: () => viewportHeight,
    })
    v.render(20)
    return { v, wheel }
  }

  it('scrolls one line per wheel event', () => {
    const { v, wheel } = wrapWheel(many(50), 5)
    expect(wheel('\x1b[<65;10;5M')).toEqual({ consume: true })
    expect(v.offset).toBe(1)
    expect(wheel('\x1b[<64;10;5M')).toEqual({ consume: true })
    expect(v.offset).toBe(0)
  })

  it('disables autoFollow on wheel-up and re-enables at the bottom', () => {
    const content = many(50)
    const { tui, wheel } = makeScrollTui()
    const v = new ScrollView(tui, theme, {
      child: { render: () => content, invalidate: () => {} },
      viewportHeight: () => 5,
      autoFollow: true,
    })
    v.render(20)
    wheel('\x1b[<64;10;5M')
    v.render(20)
    content.splice(0, content.length, ...many(80))
    expect(flat(v.render(20))).not.toContain('l79')
    content.splice(0, content.length, ...many(50))
    v.render(20)
    wheel('\x1b[<65;10;5M')
    expect(v.offset).toBe(45)
    v.render(20)
    content.splice(0, content.length, ...many(80))
    expect(flat(v.render(20))).toContain('l79')
  })

  it('ignores wheel release and non-wheel clicks', () => {
    const { v, wheel } = wrapWheel(many(50), 5)
    expect(wheel('\x1b[<64;10;5m')).toBeUndefined()
    expect(wheel('\x1b[<0;10;5M')).toBeUndefined()
    expect(v.offset).toBe(0)
  })

  it('stops consuming after dispose', () => {
    const { tui, wheel } = makeScrollTui()
    const v = new ScrollView(tui, theme, {
      child: { render: () => many(50), invalidate: () => {} },
      viewportHeight: () => 5,
    })
    v.render(20)
    v.dispose()
    expect(wheel('\x1b[<64;10;5M')).toBeUndefined()
    expect(v.offset).toBe(0)
  })

  it('moves five lines with Alt held (button bit 8)', () => {
    const { v, wheel } = wrapWheel(many(50), 5)
    wheel('\x1b[<73;10;5M')
    expect(v.offset).toBe(5)
    wheel('\x1b[<72;10;5M')
    expect(v.offset).toBe(0)
  })

  it('accelerates same-direction consecutive events', () => {
    const { v, wheel } = wrapWheel(many(200), 5)
    const steps: number[] = []
    let prev = 0
    for (let i = 0; i < 6; i++) {
      wheel('\x1b[<65;10;5M')
      const delta = v.offset - prev
      steps.push(delta)
      prev = v.offset
    }
    for (let i = 0; i < steps.length; i++) {
      expect(steps[i]).toBeGreaterThanOrEqual(1)
      if (i > 0) expect(steps[i]).toBeGreaterThanOrEqual(steps[i - 1] ?? 0)
    }
  })
})
