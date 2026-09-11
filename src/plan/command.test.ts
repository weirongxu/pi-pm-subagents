import type {
  ExtensionAPI,
  ExtensionContext,
} from '@earendil-works/pi-coding-agent'
import { describe, expect, it, vi } from 'vitest'

import { buildPlanRequestMessage, runPlanCommand } from './command.js'

function fakePi(): ExtensionAPI & { sent: string[] } {
  const sent: string[] = []
  const pi = {
    sendMessage: (message: { content: string }) => {
      sent.push(message.content)
    },
  }
  return Object.assign(pi as unknown as ExtensionAPI, { sent })
}

function fakeCtx(options: {
  hasUI: boolean
  editorResult?: string | undefined
}): ExtensionContext & {
  editor: ReturnType<typeof vi.fn>
  notify: ReturnType<typeof vi.fn>
} {
  const editor = vi.fn(async () => options.editorResult)
  const notify = vi.fn()
  const ctx = {
    hasUI: options.hasUI,
    ui: { editor, notify },
  }
  return Object.assign(ctx as unknown as ExtensionContext, { editor, notify })
}

const okEnter = async () => {}

describe('buildPlanRequestMessage', () => {
  it('wraps the prompt in a closed request tag', () => {
    const message = buildPlanRequestMessage('add dark mode')
    expect(message).toContain('<request>')
    expect(message).toContain('</request>')
    expect(message).toContain("role 'planner'")
    expect(message).not.toContain('<plan-request>')
  })

  it('escapes XML special characters in the prompt', () => {
    const message = buildPlanRequestMessage('a<b && c>d')
    expect(message).toContain('a&lt;b &amp;&amp; c&gt;d')
  })
})

describe('runPlanCommand', () => {
  it('enters coordinator mode and sends the request when idle', async () => {
    const pi = fakePi()
    const state = { mode: undefined }
    const enter = vi.fn(okEnter)

    await runPlanCommand(
      pi,
      state,
      'build a parser',
      fakeCtx({ hasUI: false }),
      enter,
    )

    expect(enter).toHaveBeenCalledOnce()
    expect(state.mode).toBeUndefined()
    expect(pi.sent).toHaveLength(1)
    expect(pi.sent[0]).toContain('build a parser')
    expect(pi.sent[0]).toContain('</request>')
  })

  it('does not re-enter when already in coordinator mode', async () => {
    const pi = fakePi()
    const state = { mode: 'coordinator' as const }
    const enter = vi.fn(okEnter)

    await runPlanCommand(
      pi,
      state,
      'build a parser',
      fakeCtx({ hasUI: false }),
      enter,
    )

    expect(enter).not.toHaveBeenCalled()
    expect(pi.sent).toHaveLength(1)
  })

  it('does not enter mode or send a message on an empty request without UI', async () => {
    const pi = fakePi()
    const state = { mode: undefined }
    const enter = vi.fn(okEnter)
    const ctx = fakeCtx({ hasUI: false })

    await runPlanCommand(pi, state, '   ', ctx, enter)

    expect(enter).not.toHaveBeenCalled()
    expect(ctx.editor).not.toHaveBeenCalled()
    expect(pi.sent).toHaveLength(0)
  })

  it('does not enter mode or send a message when the editor is cancelled', async () => {
    const pi = fakePi()
    const state = { mode: undefined }
    const enter = vi.fn(okEnter)
    const ctx = fakeCtx({ hasUI: true, editorResult: undefined })

    await runPlanCommand(pi, state, '', ctx, enter)

    expect(ctx.editor).toHaveBeenCalledOnce()
    expect(enter).not.toHaveBeenCalled()
    expect(pi.sent).toHaveLength(0)
  })

  it('notifies an error and does not send a message when entering mode throws', async () => {
    const pi = fakePi()
    const state = { mode: undefined }
    const enter = vi.fn(async () => {
      throw new Error('mode busy')
    })
    const ctx = fakeCtx({ hasUI: false })

    await runPlanCommand(pi, state, 'build a parser', ctx, enter)

    expect(ctx.notify).toHaveBeenCalledWith('mode busy', 'error')
    expect(pi.sent).toHaveLength(0)
  })
})
